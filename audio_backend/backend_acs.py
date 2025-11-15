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
from common.config import get_voice_live_config, VoiceLiveConfig
from acs.bridges.gpt_realtime_bridge import GptRealtimeBridge
from acs.bridges.voice_live_bridge import VoiceLiveBridge

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
llm_endpoint_ws = os.environ.get("AZURE_OPENAI_ENDPOINT_WS").replace('"', '').replace("'", "")
llm_deployment = os.environ.get("AZURE_OPENAI_MODEL_NAME").replace('"', '').replace("'", "")
llm_key = os.environ.get("AZURE_OPENAI_API_KEY").replace('"', '').replace("'", "")
acs_source_number = os.environ.get("ACS_PHONE_NUMBER").replace('"', '').replace("'", "")
acs_connection_string = os.environ.get("AZURE_ACS_CONN_KEY").replace('"', '').replace("'", "")
acs_callback_path = os.environ.get("CALLBACK_EVENTS_URI").replace('"', '').replace("'", "")
acs_media_streaming_websocket_host = os.environ.get("CALLBACK_URI_HOST").replace('"', '').replace("'", "")


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
voice_live_rtmt: Optional[RTMiddleTier] = None
event_handler: Optional[EventHandler] = None
gpt_bridge: Optional[GptRealtimeBridge] = None
voice_live_bridge: Optional[VoiceLiveBridge] = None


class PhoneCallRequest(BaseModel):
    """Request model for initiating outbound calls"""
    number: str


# ============================================================================
# Initialization Function
# ============================================================================
async def initialize_acs_components():
    """Initialize ACS components with configuration"""
    global caller, rtmt, voice_live_rtmt, event_handler, gpt_bridge, voice_live_bridge
    
    console.log("[ACS INIT] Initializing ACS phone call components...")
    
    # Initialize ACS caller
    print("Initialize ACS caller", acs_source_number, acs_connection_string, acs_callback_path, acs_media_streaming_websocket_host)

    
    # Load system prompt
    system_prompt_path = Path(__file__).parent.parent / "prompts" / "system_prompt.txt"
    if not system_prompt_path.exists():
        system_prompt_path = Path(__file__).parent / "system_prompt.md"
    else:
        system_prompt = "You are a helpful AI assistant handling phone calls."
        console.log("[ACS INIT] ⚠️  System prompt not found, using default")
    
    # Initialize RTMiddleTier (WebSocket-based middle tier for ACS)
    if llm_endpoint_ws and llm_deployment and llm_credential:
        rtmt = RTMiddleTier(
            llm_endpoint_ws, 
            llm_deployment, 
            llm_credential,
            realtime_path="openai/v1/realtime",
            extra_query_params={
                "useVoiceLiveForAcs": voice_live_config.use_voicelive_for_acs
            },
        )
        rtmt.system_message = system_prompt
        gpt_bridge = GptRealtimeBridge(rtmt)

        # Register all tools at once
        register_tools_from_registry(rtmt, TOOLS_REGISTRY)
        
        console.log("[ACS INIT] ✅ RTMiddleTier (WebSocket) initialized")
    else:
        console.log("[ACS INIT] ⚠️  RTMiddleTier not configured (missing Azure OpenAI settings)")
    
    # Setup placeholder Voice Live bridge if configuration is available
    voice_live_config = VoiceLiveConfig()
    try:
        voice_live_config = get_voice_live_config()
        voice_live_rtmt = RTMiddleTier(
            voice_live_config.endpoint,
            voice_live_config.default_model,
            AzureKeyCredential(voice_live_config.api_key),
            realtime_path="/voice-live/realtime",
            extra_query_params={
                "api-version": voice_live_config.api_version,
                "region": voice_live_config.region,
                "useVoiceLiveForAcs": voice_live_config.use_voicelive_for_acs
            },
        )
        voice_live_rtmt.selected_voice = voice_live_config.default_voice
        voice_live_rtmt.system_message = system_prompt
        register_tools_from_registry(voice_live_rtmt, TOOLS_REGISTRY)
        voice_live_bridge = VoiceLiveBridge(voice_live_rtmt)
        console.log("[ACS INIT] ✅ Voice Live bridge configured")
    except Exception as exc:
        console.log(f"[ACS INIT] ⚠️ Voice Live config unavailable: {exc}")



    if acs_source_number and acs_connection_string and acs_callback_path and acs_media_streaming_websocket_host:

        if not voice_live_config.use_voicelive_for_acs:
            acs_media_streaming_websocket_path = f"{acs_media_streaming_websocket_host}/api/realtime-acs"
        else:
            acs_media_streaming_websocket_path = f"{acs_media_streaming_websocket_host}/api/voice-live-acs"
                
        caller = AcsCaller(
            source_number=acs_source_number,
            acs_connection_string=acs_connection_string,
            acs_callback_path=acs_callback_path,
            acs_media_streaming_websocket_path=acs_media_streaming_websocket_path
        )
        console.log("[ACS INIT] ✅ ACS Caller initialized")
    else:
        console.log("[ACS INIT] ⚠️  ACS Caller not configured (missing environment variables)")


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
    
    if gpt_bridge is None:
        console.log("[ACS-BRIDGE] ❌ GPT bridge not initialized")
        await websocket.close(code=1011, reason="Bridge not configured")
        return
    
    try:
        console.log("[ACS-BRIDGE] Using WebSocket path: ACS → WebSocket → Python → WebSocket → Azure OpenAI")
        await gpt_bridge.handle(websocket)
        
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


@router.websocket("/api/voice-live-acs")
async def voice_live_bridge_handler(websocket: WebSocket):
    """WebSocket endpoint for ACS calls routed through Voice Live."""
    await websocket.accept()
    console.log("[VOICE-LIVE BRIDGE] 🔌 ACS connected to Voice Live route")

    if voice_live_bridge is None:
        console.log("[VOICE-LIVE BRIDGE] ❌ Voice Live bridge not configured")
        await websocket.close(code=1011, reason="Voice Live not configured")
        return

    try:
        await voice_live_bridge.handle(websocket)
    except WebSocketDisconnect:
        console.log("[VOICE-LIVE BRIDGE] Client disconnected")
    except Exception as exc:
        console.log(f"[VOICE-LIVE BRIDGE] ❌ Error: {exc}")
        try:
            await websocket.close(code=1011, reason="Voice Live bridge error")
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
