import sys
from pathlib import Path
print(f"Sys importing {str(Path(__file__).parent )}")
sys.path.insert(0, str(Path(__file__).parent ))

from unittest import case
import aiohttp
import asyncio
import json
from typing import Any, Optional, Dict
from aiohttp import ClientWebSocketResponse, web
from azure.identity import DefaultAzureCredential, AzureDeveloperCliCredential, get_bearer_token_provider
from azure.core.credentials import AzureKeyCredential
from tools import *
from helpers import transform_acs_to_openai_format, transform_openai_to_acs_format
from rich.console import Console
console = Console()



class RTMiddleTier:
    endpoint: str
    deployment: str
    key: Optional[str] = None
    selected_voice: str = "alloy"

    # Tools are server-side only for now, though the case could be made for client-side tools
    # in addition to server-side tools that are invisible to the client
    tools: dict[str, Tool] = {}

    # Server-enforced configuration, if set, these will override the client's configuration
    # Typically at least the model name and system message will be set by the server
    model: Optional[str] = None
    system_message: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    disable_audio: Optional[bool] = None

    _tools_pending: dict[str, RTToolCall] = {}
    _token_provider = None

    def __init__(
        self,
        endpoint: str,
        deployment: str,
        credentials: AzureKeyCredential | AzureDeveloperCliCredential | DefaultAzureCredential,
        *,
        realtime_path: str = "/openai/v1/realtime",
        extra_query_params: Optional[Dict[str, str]] = None,
    ):
        self.endpoint = endpoint
        self.deployment = deployment
        if isinstance(credentials, AzureKeyCredential):
            self.key = credentials.key
        else:
            self._token_provider = get_bearer_token_provider(credentials, "https://cognitiveservices.azure.com/.default")
            self._token_provider() # Warm up during startup so we have a token cached when the first request arrives
        self._realtime_path = realtime_path if realtime_path.startswith("/") else f"/{realtime_path}"
        self._extra_query_params = extra_query_params or {}
        self.use_voicelive_for_acs = self._extra_query_params.get("useVoiceLiveForAcs", False)



    async def _process_message_to_client(self, message: Any, client_ws: web.WebSocketResponse, server_ws: ClientWebSocketResponse, is_acs_audio_stream: bool):
        # This method basically follows a 3-step process:
        # 1. Check if we need to react to the message (e.g. a function call needs to me made)
        # 2. Check if we need to transform the message to a different format (e.g. when we use Azure Communication Services)
        # 3. Send the transformed message to the client (Web App or Phone via ACS), if required

        if message is not None:
            match message["type"]:
                case "error":
                    console.log("[RECEIVED FROM SERVER  - MODEL] error:", message)

                case "session.created":
                    session = message["session"]
                    session["instructions"] = ""
                    session["tools"] = []
                    session["tool_choice"] = "none"
                    session["max_response_output_tokens"] = None

                case "session.updated":
                    await server_ws.send_json({
                        "type": "response.create"
                    })

                case "response.output_item.added":
                    console.log("[RECEIVED FROM SERVER  - MODEL] response.output_item.added")
                    if "item" in message and message["item"]["type"] == "function_call":
                        message = None

                case "conversation.item.added":
                    console.log("[RECEIVED FROM SERVER  - MODEL] conversation.item.created")
                    if "item" in message and message["item"]["type"] == "function_call":
                        item = message["item"]
                        console.log(f"[SERVER EVENT] conversation.item.created::Function call initiated: {item.get('name', 'unknown')} (call_id: {item.get('call_id', 'unknown')})")
                        if item["call_id"] not in self._tools_pending:
                            self._tools_pending[item["call_id"]] = RTToolCall(item["call_id"], message["previous_item_id"])
                        message = None
                    elif "item" in message and message["item"]["type"] == "function_call_output":
                        console.log(f"[SERVER EVENT] Function call output received (call_id: {message['item'].get('call_id', 'unknown')})")
                        message = None

                case "response.function_call_arguments.delta":
                    # console.log("[SERVER EVENT] Function call arguments streaming...")
                    message = None

                case "response.function_call_arguments.done":
                    console.log("[SERVER EVENT] Function call arguments complete", message)
                    message = None

                case "response.output_item.done":
                    console.log("[RECEIVED FROM SERVER  - MODEL] response.output_item.done")
                    if "item" in message and message["item"]["type"] == "function_call":
                        item = message["item"]
                        console.log(f"[SERVER EVENT] Function call initiated: {item.get('name', 'unknown')} (call_id: {item.get('call_id', 'unknown')})")
                        tool_call = self._tools_pending[message["item"]["call_id"]]
                        tool = self.tools[item["name"]]
                        args = item["arguments"]
                        console.log(f"[SERVER EVENT] Executing function: {item['name']} with args: {args}")
                        result = await tool.target(json.loads(args))
                        console.log(result)

                        console.log({
                            "type": "conversation.item.create",
                            "item": {
                                "type": "function_call_output",
                                "call_id": item["call_id"],
                                "output": str(result)
                            }
                        })

                        console.log(f"[CLIENT EVENT] Sending function_call_output to server (call_id: {item['call_id']})")
                        await server_ws.send_json({
                            "type": "conversation.item.create",
                            "item": {
                                "type": "function_call_output",
                                "call_id": item["call_id"],
                                "output": str(result)
                            }
                        })

                        message = None

                case "response.done":
                    console.log("[RECEIVED FROM SERVER  - MODEL] response.done")
                    if len(self._tools_pending) > 0:
                        console.log(f"[CLIENT EVENT] Function calls completed ({len(self._tools_pending)} tools), requesting new response from model")
                        self._tools_pending.clear() # Any chance tool calls could be interleaved across different outstanding responses?
                        await server_ws.send_json({
                            "type": "response.create"
                        })

                    if "response" in message:
                        replace = False
                        outputs = message["response"]["output"]
                        for output in reversed(outputs):
                            if output["type"] == "function_call":
                                outputs.remove(output)
                                replace = True
                        if replace:
                            message = json.loads(json.dumps(message)) # TODO: This is a hack to make the message a dict again. Find out, what 'replace' does

                case "input_audio_buffer.speech_started":
                    console.log("[RECEIVED FROM SERVER  - MODEL] input_audio_buffer.speech_started")

                case "input_audio_buffer.speech_stopped":
                    console.log("[RECEIVED FROM SERVER  - MODEL] input_audio_buffer.speech_stopped")

                case "input_audio_buffer.committed":
                    console.log("[RECEIVED FROM SERVER  - MODEL] input_audio_buffer.committed")

                case "input_audio_buffer.cleared":
                    console.log("[RECEIVED FROM SERVER  - MODEL] input_audio_buffer.cleared")

                case "conversation.item.input_audio_transcription.completed":
                    console.log("[RECEIVED FROM SERVER  - MODEL] conversation.item.input_audio_transcription.completed:", message.get("transcript", ""))

                case "conversation.item.input_audio_transcription.failed":
                    console.log("[RECEIVED FROM SERVER  - MODEL] conversation.item.input_audio_transcription.failed:", message)

                case "conversation.item.added":
                    console.log("[RECEIVED FROM SERVER  - MODEL] conversation.item.added")

                case "conversation.item.done":
                    console.log(f"[RECEIVED FROM SERVER  - MODEL] conversation.item.done {message}")
                    
                case "response.created":
                    console.log("[RECEIVED FROM SERVER  - MODEL] response.created")

                case "response.output_item.added":
                    console.log("[RECEIVED FROM SERVER  - MODEL] response.output_item.added")

                case "response.content_part.added":
                    console.log("[RECEIVED FROM SERVER  - MODEL] response.content_part.added")

                case "response.output_audio_transcript.delta":
                    # console.log("[RECEIVED FROM SERVER  - MODEL] response.output_audio_transcript.delta:", message.get("delta", ""))
                    pass

                case "response.output_audio_transcript.done":
                    console.log("[RECEIVED FROM SERVER  - MODEL] response.output_audio_transcript.done:", message.get("transcript", ""))

                case "response.output_audio.delta":
                    # console.log("[RECEIVED FROM SERVER  - MODEL] response.output_audio.delta")
                    pass

                case "response.output_audio.done":
                    console.log("[RECEIVED FROM SERVER  - MODEL] response.output_audio.done")

                case "response.output_text.delta":
                    pass
                    # console.log("[RECEIVED FROM SERVER  - MODEL] response.output_text.delta:", message.get("delta", ""))

                case "response.content_part.done":
                    console.log("[RECEIVED FROM SERVER  - MODEL] response.content_part.done", message.get("transcript", ""))

                case "response.output_audio.delta":
                    console.log("[RECEIVED FROM SERVER  - MODEL] response.output_audio.delta")

                case "response.output_text.done":
                    console.log("[RECEIVED FROM SERVER  - MODEL] response.output_text.done:", message.get("text", ""))

                case "rate_limits.updated":
                    console.log("[RECEIVED FROM SERVER  - MODEL] rate_limits.updated")

                case _:
                    print("_process_message_to_client::Unhandled message type:", message)

        # Transform the message to the Azure Communication Services format,
        # if it comes from the OpenAI realtime stream.
        if is_acs_audio_stream and message is not None:
            message = transform_openai_to_acs_format(message)

        if message is not None:
            await client_ws.send_str(json.dumps(message))

    async def _process_message_to_server(self, data: Any, ws: web.WebSocketResponse, server_ws: ClientWebSocketResponse, is_acs_audio_stream: bool):
        # If the message comes from the Azure Communication Services audio stream, transform it to the OpenAI Realtime API format first
        if (is_acs_audio_stream):
            data = transform_acs_to_openai_format(data, 
                                                  self.model, 
                                                  self.tools, 
                                                  self.system_message, 
                                                  self.temperature, 
                                                  self.max_tokens, 
                                                  self.disable_audio, 
                                                  self.selected_voice, 
                                                  self.use_voicelive_for_acs)

        if data is not None:
            match data["type"]:
                case "session.update":
                    session = data.get("session", {})
                    session["instructions"] = self.system_message
                    session["tool_choice"] = "auto" if len(self.tools) > 0 else "none"
                    session["tools"] = [tool.schema for tool in self.tools.values()]
                    session["type"] = "realtime"
                    data["session"] = session
                    console.log("[RECEIVED FROM CLIENT - ACS] session.update", data)

                case "input_audio_buffer.commit":
                    console.log("[RECEIVED FROM CLIENT - ACS] input_audio_buffer.commit")

                case "input_audio_buffer.clear":
                    console.log("[RECEIVED FROM CLIENT - ACS] input_audio_buffer.clear")

                case "conversation.item.create":
                    console.log("[RECEIVED FROM CLIENT - ACS] conversation.item.create")

                case "conversation.item.truncate":
                    console.log("[RECEIVED FROM CLIENT - ACS] conversation.item.truncate")

                case "conversation.item.added":
                    console.log("[RECEIVED FROM CLIENT - ACS] conversation.item.added")

                case "conversation.item.done":
                    console.log("[RECEIVED FROM CLIENT - ACS] conversation.item.done")

                case "conversation.item.delete":
                    console.log("[RECEIVED FROM CLIENT - ACS] conversation.item.delete")

                case "response.create":
                    console.log("[RECEIVED FROM CLIENT - ACS] response.create")

                case "response.cancel":
                    console.log("[RECEIVED FROM CLIENT - ACS] response.cancel")

                case _:
                    if data["type"] != "input_audio_buffer.append": 
                        console.log(f"[RECEIVED FROM CLIENT - ACS] Unhandled: {data['type']}")

            await server_ws.send_str(json.dumps(data))

    async def forward_messages(self, ws: web.WebSocketResponse, is_acs_audio_stream: bool):
        async with aiohttp.ClientSession(base_url=self.endpoint) as session:
            params = {}
            if self.deployment:
                params["model"] = self.deployment
            params.update(self._extra_query_params)

            headers = {}
            if "x-ms-client-request-id" in ws.headers:
                headers["x-ms-client-request-id"] = ws.headers["x-ms-client-request-id"]

            # Setup authentication headers for the OpenAI Realtime API WebSocket connection
            if self.key is not None:
                headers = { "api-key": self.key }
            else:
                if self._token_provider is not None:
                    headers = { "Authorization": f"Bearer {self._token_provider()}" } 
                else:
                    raise ValueError("No token provider available")

            # console.log("Connecting to OpenAI Realtime API WebSocket...")
            # console.log(f"Headers: {headers}")
            # console.log(f"Params: {params}")
            # console.log(f"Endpoint: {self.endpoint}/openai/v1/realtime")

            
            # Connect to the OpenAI Realtime API WebSocket
            async with session.ws_connect(self._realtime_path, headers=headers, params=params) as target_ws:
                async def from_client_to_server():
                    # Messages from Azure Communication Services or the Web Frontend are forwarded to the OpenAI Realtime API
                    async for msg in ws:
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            data = json.loads(msg.data)
                            await self._process_message_to_server(data, ws, target_ws, is_acs_audio_stream)
                        else:
                            print("Error: unexpected message type:", msg.type)

                async def from_server_to_client():
                    # Messages from the OpenAI Realtime API are forwarded to the Azure Communication Services or the Web Frontend
                    async for msg in target_ws:
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            data = json.loads(msg.data)
                            await self._process_message_to_client(data, ws, target_ws, is_acs_audio_stream)
                        else:
                            print("Error: unexpected message type:", msg.type)

                try:
                    await asyncio.gather(from_client_to_server(), from_server_to_client())
                except ConnectionResetError:
                    # Ignore the errors resulting from the client disconnecting the socket
                    pass
