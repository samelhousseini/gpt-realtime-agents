"""FastAPI backend for Azure Communication Services (ACS) phone call integration.

This module provides WebSocket-only routes for handling PSTN phone calls through ACS,
bridging them to Azure OpenAI Realtime API over WebSocket.

Architecture: Phone ↔ WebSocket ↔ ACS ↔ Python ↔ WebSocket ↔ AI Model
"""
import os
import sys
import json
import logging
import aiohttp
import asyncio
from pathlib import Path
from typing import Optional, Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from dotenv import load_dotenv
from azure.core.credentials import AzureKeyCredential
from rich.console import Console

# Add acs directory to path for imports
print(f"Sys importing {str(Path(__file__).parent )}")
sys.path.insert(0, str(Path(__file__).parent ))

from acs.acs import AcsCaller
from acs.rtmt import RTMiddleTier
from acs.callback_server import EventHandler
from acs.helpers import load_prompt_from_markdown
from acs.tools import *

from tools_registry import *


load_dotenv()
console = Console()
logger = logging.getLogger(__name__)

# Initialize router for ACS routes
router = APIRouter(prefix="", tags=["ACS Phone Calls"])

# Environment variables - matching .env file
llm_endpoint_ws = os.environ.get("AZURE_OPENAI_ENDPOINT_WS")
llm_deployment = os.environ.get("AZURE_OPENAI_MODEL_NAME")
llm_key = os.environ.get("AZURE_OPENAI_API_KEY")
acs_source_number = os.environ.get("ACS_PHONE_NUMBER")
acs_connection_string = os.environ.get("AZURE_ACS_CONN_KEY")
acs_callback_path = os.environ.get("CALLBACK_EVENTS_URI")
acs_media_streaming_websocket_host = os.environ.get("CALLBACK_URI_HOST")


print("LLM Endpoint WS:", llm_endpoint_ws)
print("LLM Deployment:", llm_deployment)
print("LLM Key:", llm_key)
print("ACS Source Number:", acs_source_number)
print("ACS Connection String:", acs_connection_string)
print("ACS Callback Path:", acs_callback_path)
print("ACS Media Streaming WebSocket Host:", acs_media_streaming_websocket_host)


llm_credential = AzureKeyCredential(llm_key) if llm_key else None

# Global instances (initialized on startup)
caller: Optional[AcsCaller] = None
rtmt: Optional[RTMiddleTier] = None
event_handler: Optional[EventHandler] = None


class PhoneCallRequest(BaseModel):
    """Request model for initiating outbound calls"""
    number: str


# ============================================================================
# FastAPI WebSocket Adapter for RTMiddleTier
# ============================================================================
class FastAPIWebSocketAdapter:
    """
    Adapter to make FastAPI WebSocket compatible with aiohttp WebSocketResponse API.
    
    This adapter allows RTMiddleTier (which expects aiohttp WebSocketResponse) to work 
    seamlessly with FastAPI WebSocket without any modifications to RTMiddleTier code.
    """
    
    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.headers = {}  # FastAPI WebSocket doesn't expose headers the same way
        self._closed = False
    
    async def send_str(self, data: str):
        """Send text data to the WebSocket"""
        if not self._closed:
            try:
                await self.websocket.send_text(data)
            except Exception as e:
                console.log(f"[ADAPTER] Error sending text: {e}")
                self._closed = True
    
    async def send_json(self, data: dict):
        """Send JSON data to the WebSocket"""
        if not self._closed:
            try:
                await self.websocket.send_json(data)
            except Exception as e:
                console.log(f"[ADAPTER] Error sending JSON: {e}")
                self._closed = True
    
    def __aiter__(self):
        """Return self as async iterator"""
        return self
    
    async def __anext__(self):
        """Async iterator for receiving messages - mimics aiohttp.WSMsgType"""
        try:
            # Receive message from FastAPI WebSocket
            raw_message = await self.websocket.receive()
            
            # Handle different message types
            if "text" in raw_message:
                # Create an aiohttp-compatible message object with .type and .data attributes
                ws_message = type('WSMessage', (), {
                    'type': aiohttp.WSMsgType.TEXT,
                    'data': raw_message["text"]
                })()
                return ws_message
            elif "bytes" in raw_message:
                ws_message = type('WSMessage', (), {
                    'type': aiohttp.WSMsgType.BINARY,
                    'data': raw_message["bytes"]
                })()
                return ws_message
            elif raw_message.get("type") == "websocket.disconnect":
                self._closed = True
                raise StopAsyncIteration
            else:
                # Unknown message type, continue iteration
                return await self.__anext__()
                
        except WebSocketDisconnect:
            self._closed = True
            raise StopAsyncIteration
        except Exception as e:
            console.log(f"[ADAPTER] Error receiving message: {e}")
            self._closed = True
            raise StopAsyncIteration


# ============================================================================
# Initialization Function
# ============================================================================
async def initialize_acs_components():
    """Initialize ACS components with configuration"""
    global caller, rtmt, event_handler
    
    console.log("[ACS INIT] Initializing ACS phone call components...")
    
    # Initialize ACS caller
    print("Initialize ACS caller", acs_source_number, acs_connection_string, acs_callback_path, acs_media_streaming_websocket_host)

    if acs_source_number and acs_connection_string and acs_callback_path and acs_media_streaming_websocket_host:
        acs_media_streaming_websocket_path = f"{acs_media_streaming_websocket_host}/api/realtime-acs"
        caller = AcsCaller(
            source_number=acs_source_number,
            acs_connection_string=acs_connection_string,
            acs_callback_path=acs_callback_path,
            acs_media_streaming_websocket_path=acs_media_streaming_websocket_path
        )
        console.log("[ACS INIT] ✅ ACS Caller initialized")
    else:
        console.log("[ACS INIT] ⚠️  ACS Caller not configured (missing environment variables)")
    
    # Load system prompt
    system_prompt = None
    system_prompt_path = Path(__file__).parent.parent / "prompts" / "system_prompt.txt"

    if system_prompt_path.exists():
        system_prompt = await load_prompt_from_markdown(str(system_prompt_path))
        console.log(f"[ACS INIT] ✅ System prompt loaded from: {system_prompt_path}")
    else:
        # Try alternative location
        system_prompt_path = Path(__file__).parent / "system_prompt.md"
        if system_prompt_path.exists():
            system_prompt = await load_prompt_from_markdown(str(system_prompt_path))
            console.log(f"[ACS INIT] ✅ System prompt loaded from: {system_prompt_path}")
        else:
            console.log("[ACS INIT] ⚠️  System prompt not found, using default")
            system_prompt = "You are a helpful AI assistant handling phone calls."
    
    # Initialize RTMiddleTier (WebSocket-based middle tier for ACS)
    if llm_endpoint_ws and llm_deployment and llm_credential:
        rtmt = RTMiddleTier(llm_endpoint_ws, llm_deployment, llm_credential)
        rtmt.system_message = system_prompt
        
        # Add example tool (can be customized)
        _weather_tool_schema = {
            "type": "function",
            "name": "get_weather_today",
            "description": "Retrieve today's weather at a specified location.",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "The location to get weather information for."
                    }
                },
                "required": ["location"],
                "additionalProperties": False
            }
        }
        
        async def _report_weather_tool(args):
            location = args.get("location", "Seattle")
            weather = f"The weather in {location} is raining with a high of 35°F and a low of 15°F."
            console.log(f"[FUNCTION CALL] Reporting weather for {location}: {weather}")
            # return ToolResult({"weather_info": weather}, ToolResultDirection.TO_SERVER)
            return {"weather_info": weather}
        
        rtmt.tools["get_weather_today"] = Tool(
            target=_report_weather_tool,
            schema=_weather_tool_schema
        )

        # Register all tools at once
        register_tools_from_registry(rtmt, TOOLS_REGISTRY)
        
        console.log("[ACS INIT] ✅ RTMiddleTier (WebSocket) initialized")
    else:
        console.log("[ACS INIT] ⚠️  RTMiddleTier not configured (missing Azure OpenAI settings)")
    
    # Initialize event handler
    if caller:
        event_handler = EventHandler(caller)
        console.log("[ACS INIT] ✅ Event handler initialized")
    
    console.log("[ACS INIT] 🚀 ACS phone integration ready")


# ============================================================================
# Route: Initiate Outbound Call
# ============================================================================
@router.post("/api/call")
async def acs_initiate_outbound_call(request: PhoneCallRequest):
    """Initiate an outbound phone call via ACS"""
    console.log(f"[ACS] Initiating outbound call to: {request.number}")
    
    if caller is None:
        console.log("[ACS] ❌ Outbound calling is not configured")
        return JSONResponse(
            content={"error": "Outbound calling is not configured"},
            status_code=503
        )
    
    try:
        await caller.initiate_call(request.number)
        console.log(f"[ACS] ✅ Outbound call initiated to: {request.number}")
        return {"message": "Created outbound call", "number": request.number}
    except Exception as e:
        console.log(f"[ACS] ❌ Error initiating call: {e}")
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )


# ============================================================================
# Route: Get Source Phone Number
# ============================================================================
@router.get("/api/source-phone-number")
async def acs_get_source_phone_number():
    """Get the ACS source phone number"""
    phone_number = os.environ.get("ACS_PHONE_NUMBER")
    console.log(f"[ACS] Returning source phone number: {phone_number}")
    return {"phoneNumber": phone_number}


# ============================================================================
# Route: ACS WebSocket Bridge (PSTN to AI)
# ============================================================================
@router.websocket("/api/realtime-acs")
async def acs_bridge_handler(websocket: WebSocket):
    """
    WebSocket endpoint for Azure Communication Services phone calls.
    
    This is the bridge that connects:
    Phone ↔ WebSocket ↔ ACS ↔ Python ↔ WebSocket ↔ Azure OpenAI Realtime API
    
    This endpoint handles the audio stream from ACS and forwards it to the AI model.
    """
    await websocket.accept()
    console.log("[ACS-BRIDGE] 🔌 Azure Communication Services connected to WebSocket")
    
    if rtmt is None:
        console.log("[ACS-BRIDGE] ❌ RTMiddleTier not initialized")
        await websocket.close(code=1011, reason="RTMiddleTier not configured")
        return
    
    try:
        console.log("[ACS-BRIDGE] Using WebSocket path: ACS → WebSocket → Python → WebSocket → Azure OpenAI")
        
        # Create adapter to make FastAPI WebSocket compatible with aiohttp API
        adapter = FastAPIWebSocketAdapter(websocket)
        
        # Forward messages using WebSocket-only path (is_acs_audio_stream=True)
        await rtmt.forward_messages(adapter, is_acs_audio_stream=True)
        
        console.log("[ACS-BRIDGE] WebSocket connection closed normally")
    except WebSocketDisconnect:
        console.log("[ACS-BRIDGE] Client disconnected")
    except Exception as e:
        console.log(f"[ACS-BRIDGE] ❌ Error in WebSocket handler: {e}")
        import traceback
        console.log(f"[ACS-BRIDGE] Traceback: {traceback.format_exc()}")
        try:
            await websocket.close(code=1011, reason="Internal error")
        except:
            pass


# ============================================================================
# Route: ACS Outbound Call Handler (CloudEvents)
# ============================================================================
@router.post("/api/acs")
async def acs_outbound_call_handler(request: Request):
    """
    Handle ACS outbound call events (CloudEvents format).
    
    This endpoint receives call status updates from ACS when initiating outbound calls,
    including call connection, disconnection, and other telephony events.
    """
    if caller is None:
        console.log("[ACS] ⚠️  Caller not configured")
        return JSONResponse(content={"error": "ACS not configured"}, status_code=503)
    
    try:
        from azure.core.messaging import CloudEvent
        
        cloudevent_list = await request.json()
        console.log(f"[ACS] Received outbound call CloudEvents")
        
        # Process each CloudEvent in the array
        for event_dict in cloudevent_list:
            event = CloudEvent.from_dict(event_dict)
            
            if event.data is None:
                continue
            
            call_connection_id = event.data.get('callConnectionId')
            console.log(f"[ACS] {event.type} event received for call connection: {call_connection_id}")
            
            if event.type == "Microsoft.Communication.CallConnected":
                console.log("[ACS] ✅ Call connected")
                await caller.call_connected_handler(event)
            elif event.type == "Microsoft.Communication.CallDisconnected":
                console.log("[ACS] 📞 Call disconnected")
                await caller.call_disconnected_handler(event)
        
        return JSONResponse(content={}, status_code=200)
    except Exception as e:
        console.log(f"[ACS] ❌ Error handling outbound call event: {e}")
        import traceback
        console.log(f"[ACS] Traceback: {traceback.format_exc()}")
        return JSONResponse(content={"error": str(e)}, status_code=500)


# ============================================================================
# Route: ACS Callbacks Handler (Event Grid)
# ============================================================================
@router.post("/api/callbacks")
async def acs_callbacks_handler(request: Request):
    """
    Handle ACS callback events (Event Grid format).
    
    This endpoint processes various ACS events including:
    - Microsoft.Communication.IncomingCall (inbound calls)
    - Microsoft.Communication.CallConnected (call established)
    - Microsoft.Communication.CallDisconnected (call ended)
    - Microsoft.Communication.ParticipantsUpdated (participants changed)
    - Microsoft.EventGrid.SubscriptionValidationEvent (Event Grid subscription validation)
    """
    if event_handler is None:
        console.log("[ACS] ⚠️  Event handler not configured")
        return JSONResponse(content={"error": "Event handler not configured"}, status_code=503)
    
    try:
        EVENT_GRID_VALIDATION_EVENT_TYPE = "Microsoft.EventGrid.SubscriptionValidationEvent"
        
        events_data = await request.json()
        console.log("[ACS CALLBACK] Processing Event Grid callback")
        
        # Handle both single event dict and array of events
        if isinstance(events_data, dict):
            events = [events_data]
        else:
            events = events_data or []
        
        for event in events:
            if not isinstance(event, dict):
                console.log(f"[ACS CALLBACK] ⚠️ Skipping unsupported event payload: {event}")
                continue
            
            event_type = (event.get("type") or event.get("eventType") or "").strip()
            console.log(f"[ACS CALLBACK] 📨 Processing event: {event_type}")
            
            # Handle Event Grid subscription validation
            if event_type == EVENT_GRID_VALIDATION_EVENT_TYPE:
                data = event.get("data") or {}
                validation_code = data.get("validationCode")
                validation_url = data.get("validationUrl")
                
                if validation_url and not validation_code:
                    console.log("[ACS CALLBACK] ⚠️ Validation URL received but code missing")
                
                if validation_code:
                    console.log(f"[ACS CALLBACK] ✅ Responding to Event Grid validation")
                    return JSONResponse(
                        content={"validationResponse": validation_code},
                        status_code=200
                    )
                
                console.log("[ACS CALLBACK] ⚠️ Validation event missing code; continuing")
                continue
            
            # Handle incoming call
            if event_type == "Microsoft.Communication.IncomingCall":
                console.log("[ACS CALLBACK] 📞 Incoming call event")
                try:
                    incoming_call_context = event['data']['incomingCallContext']
                    await caller.answer_inbound_call(incoming_call_context)
                    console.log("[ACS CALLBACK] ✅ Incoming call answered")
                except Exception as e:
                    console.log(f"[ACS CALLBACK] ❌ Error handling inbound call: {e}")
            
            # Handle call connected
            elif event_type == "Microsoft.Communication.CallConnected":
                console.log("[ACS CALLBACK] ✅ Call connected event")
                await caller.call_connected_handler(event)
            
            # Handle participants updated
            elif event_type == "Microsoft.Communication.ParticipantsUpdated":
                data = event.get("data") or {}
                call_connection_id = data.get("callConnectionId")
                participants = data.get("participants", [])
                console.log(f"[ACS CALLBACK] 👥 Participants updated for call {call_connection_id}. Count: {len(participants)}")
                for participant in participants:
                    identifier = participant.get("identifier") if isinstance(participant, dict) else participant
                    console.log(f"[ACS CALLBACK]    → {identifier}")
            
            # Handle call disconnected
            elif event_type == "Microsoft.Communication.CallDisconnected":
                console.log("[ACS CALLBACK] 📴 Call disconnected event")
                await caller.call_disconnected_handler(event)
            
            else:
                console.log(f"[ACS CALLBACK] ⚠️ Unhandled event type: {event_type}")
        
        return JSONResponse(content={}, status_code=200)
        
    except Exception as e:
        console.log(f"[ACS CALLBACK] ❌ Error processing callback: {e}")
        import traceback
        console.log(f"[ACS CALLBACK] Traceback: {traceback.format_exc()}")
        return JSONResponse(content={"error": str(e)}, status_code=500)


# ============================================================================
# Startup Hook
# ============================================================================
async def startup_event():
    """Initialize ACS components on startup"""
    await initialize_acs_components()
