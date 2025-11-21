import json
import sys
from pathlib import Path
print(f"Sys importing {str(Path(__file__).parent )}")
sys.path.insert(0, str(Path(__file__).parent ))

from openai.types.beta.realtime import (InputAudioBufferAppendEvent, SessionUpdateEvent)
from openai.types.beta.realtime.session_update_event import Session, SessionTurnDetection
from typing import Any, Literal, Optional
from tools import Tool
import json
import os

# Load session configuration from root directory
_config_path = Path(__file__).parent.parent.parent / "session_config.json"
with open(_config_path, 'r') as f:
    SESSION_CONFIG = json.load(f)

def transform_acs_to_openai_format(msg_data: Any, 
                                   model: Optional[str], 
                                   tools: dict[str, Tool], 
                                   system_message: Optional[str], 
                                   temperature: Optional[float], 
                                   max_tokens: Optional[int], 
                                   disable_audio: Optional[bool], 
                                   voice: str,
                                   use_voicelive_for_acs: bool = False) -> InputAudioBufferAppendEvent | SessionUpdateEvent | Any | None:
    """
    Transforms websocket message data from Azure Communication Services (ACS) to the OpenAI Realtime API format.
    Args:
        msg_data_json (str): The JSON string containing the ACS message data.
    Returns:
        Optional[str]: The transformed message in the OpenAI Realtime API format
    This is needed to plug the Azure Communication Services audio stream into the OpenAI Realtime API.
    Both APIs have different message formats, so this function acts as a bridge between them.
    This method decides, if the given message is relevant for the OpenAI Realtime API, and if so, it is transformed to the OpenAI Realtime API format.
    """
    oai_message: Any = None

    # Initial message from Azure Communication Services.
    # Set the initial configuration for the OpenAI Realtime API by sending a session.update message.
    try:
        if msg_data["kind"] == "AudioMetadata":
            # Load base configuration from session_config.json
            config_key = "voicelive" if use_voicelive_for_acs else "realtime"
            session_data = json.loads(json.dumps(SESSION_CONFIG[config_key]))  # Deep copy
            
            # Add tools configuration
            session_data["tool_choice"] = "auto" if len(tools) > 0 else "none"
            session_data["tools"] = [tool.schema for tool in tools.values()]
            
            # Add system instructions if provided
            if system_message is not None:
                session_data["instructions"] = system_message
            
            # Override optional parameters if provided (these may already be in config with null values)
            if temperature is not None:
                session_data["temperature"] = temperature
            if max_tokens is not None:
                session_data["max_response_output_tokens"] = max_tokens
            if disable_audio is not None:
                session_data["disable_audio"] = disable_audio
            
            # Remove null values from session_data
            session_data = {k: v for k, v in session_data.items() if v is not None}
            
            oai_message = {
                "type": "session.update",
                "session": session_data
            }

        # Message from Azure Communication Services with audio data.
        # Transform the message to the OpenAI Realtime API format.
        elif msg_data["kind"] == "AudioData":
            oai_message = {
                "type": "input_audio_buffer.append",
                "audio": msg_data["audioData"]["data"]
            }
    except Exception as e:
        print(f"Error transforming ACS to OpenAI format: {str(msg_data)}")

    return oai_message

def transform_openai_to_acs_format(msg_data: Any) -> Optional[Any]:
    """
    Transforms websocket message data from the OpenAI Realtime API format into the Azure Communication Services (ACS) format.
    Args:
        msg_data_json (str): The JSON string containing the message data from the OpenAI Realtime API.
    Returns:
        Optional[str]: A JSON string containing the transformed message in ACS format, or None if the message type is not handled.
    This is needed to plug the OpenAI Realtime API audio stream into Azure Communication Services.
    Both APIs have different message formats, so this function acts as a bridge between them.
    This method decides, if the given message is relevant for the ACS, and if so, it is transformed to the ACS format.
    """
    acs_message = None

    # print("msg_data", msg_data)

    # Message from the OpenAI Realtime API with audio data.
    # Transform the message to the Azure Communication Services format.
    if (msg_data["type"] == "response.output_audio.delta") or (msg_data["type"] == "response.audio.delta"):
        acs_message = {
            "kind": "AudioData",
            "audioData": {
                "data": msg_data["delta"]
            }
        }

    # Message from the OpenAI Realtime API detecting, that the user starts speaking and interrupted the AI.
    # In this case, we don't want to send the unplayed audio buffer to the client anymore and clear the buffer audio.
    # Buffered audio is audio data that has been sent to Azure Communication Services, but not yet played by the client.
    if msg_data["type"] == "input_audio_buffer.speech_started":
        acs_message = {
            "kind": "StopAudio",
            "audioData": None,
            "stopAudio": {}
        }


    # print("acs_message", acs_message)
    return acs_message




def load_prompt_from_markdown(file_path):
    with open(file_path, 'r', encoding='utf-8') as file:
        prompt = file.read()
    return prompt
