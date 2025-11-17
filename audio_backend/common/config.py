"""Shared configuration helpers for browser and ACS backends."""

from __future__ import annotations

import os
import json
from pathlib import Path
from dataclasses import dataclass
from functools import lru_cache
from typing import Optional, Literal, get_args


# Load session configuration from root directory
_config_path = Path(__file__).parent.parent.parent / "session_config.json"
with open(_config_path, 'r') as f:
    SESSION_CONFIG = json.load(f)


print("Loaded SESSION_CONFIG:", SESSION_CONFIG)

def _clean_env(name: str, *, default: Optional[str] = None) -> str:
    raw = os.getenv(name, default)
    if raw is None:
        raise RuntimeError(f"Environment variable {name} must be set")
    return raw.strip().strip("\"").strip("'")


def _optional_env(name: str, *, default: Optional[str] = None) -> Optional[str]:
    raw = os.getenv(name, default)
    if raw is None:
        return None
    raw = raw.strip().strip("\"").strip("'")
    return raw or None


# Dynamically create Literal types from session_config.json
_selections = SESSION_CONFIG.get("selections", {})
_gpt_realtime_voices = tuple(_selections.get("gptRealtimeVoices", ["verse"]))
_voice_live_voices = tuple(_selections.get("voiceLiveVoices", ["en-US-Ava:DragonHDLatestNeural"]))
_gpt_realtime_models = tuple(_selections.get("gptRealtimeModels", ["gpt-realtime"]))
_voice_live_models = tuple(_selections.get("voiceLiveModels", ["gpt-realtime"]))

GPTRealtimeVoiceSelection = Literal[_gpt_realtime_voices[0], *_gpt_realtime_voices[1:]] if len(_gpt_realtime_voices) > 1 else Literal[_gpt_realtime_voices[0]]
VoiceLiveVoiceSelection = Literal[_voice_live_voices[0], *_voice_live_voices[1:]] if len(_voice_live_voices) > 1 else Literal[_voice_live_voices[0]]
GPTRealtimeModelSelection = Literal[_gpt_realtime_models[0], *_gpt_realtime_models[1:]] if len(_gpt_realtime_models) > 1 else Literal[_gpt_realtime_models[0]]
VoiceLiveConfigModelSelection = Literal[_voice_live_models[0], *_voice_live_models[1:]] if len(_voice_live_models) > 1 else Literal[_voice_live_models[0]]


@dataclass(frozen=True)
class BrowserRealtimeConfig:
    realtime_session_url: str
    webrtc_url: str
    default_deployment: str
    azure_api_key: Optional[str]
    default_voice: GPTRealtimeVoiceSelection = "verse"
    


@dataclass(frozen=True)
class VoiceLiveConfig:
    endpoint: str
    api_key: str
    default_model: str
    region: str
    api_version: str
    use_voicelive_for_acs: bool = False
    default_voice: VoiceLiveVoiceSelection = "en-US-Ava:DragonHDLatestNeural" 
    
    

@dataclass(frozen=True)
class AcsConfig:
    source_number: Optional[str]
    connection_string: Optional[str]
    callback_path: Optional[str]
    media_stream_host: Optional[str]
    system_prompt_path: Optional[str]


@lru_cache(maxsize=1)
def get_browser_realtime_config() -> BrowserRealtimeConfig:
    # Read default_deployment from session_config.json
    default_deployment = SESSION_CONFIG.get("realtime", {}).get("model", "gpt-realtime")
    
    return BrowserRealtimeConfig(
        realtime_session_url=_clean_env("AZURE_GPT_REALTIME_URL"),
        webrtc_url=_clean_env("WEBRTC_URL"),
        default_deployment=default_deployment,
        default_voice=_clean_env("AZURE_GPT_REALTIME_VOICE", default="verse"),
        azure_api_key=_optional_env("AZURE_GPT_REALTIME_KEY"),
    )


@lru_cache(maxsize=1)
def get_voice_live_config() -> VoiceLiveConfig:
    endpoint = _clean_env("AZURE_VOICELIVE_ENDPOINT")
    api_key = _clean_env("AZURE_VOICELIVE_API_KEY")
    # Read default_model from session_config.json
    default_model = SESSION_CONFIG.get("voicelive", {}).get("model", "gpt-realtime")
    default_voice = _clean_env("AZURE_VOICELIVE_VOICE", default="en-US-Ava:DragonHDLatestNeural")
    region = _clean_env("AZURE_VOICELIVE_REGION", default="swedencentral")
    api_version = _clean_env("AZURE_VOICELIVE_API_VERSION", default="2025-05-01-preview")
    use_voicelive_for_acs = _clean_env("USE_VOICELIVE_FOR_ACS", default="false").lower() == "true"
    return VoiceLiveConfig(
        endpoint=endpoint.rstrip("/"),
        api_key=api_key,
        default_model=default_model,
        default_voice=default_voice,
        region=region,
        api_version=api_version,
        use_voicelive_for_acs=use_voicelive_for_acs,
    )


@lru_cache(maxsize=1)
def get_acs_config() -> AcsConfig:
    prompt_override = _optional_env("ACS_SYSTEM_PROMPT_PATH")
    default_prompt = os.path.join(
        os.path.dirname(os.path.dirname(__file__)),
        "prompts",
        "system_prompt.txt",
    )
    return AcsConfig(
        source_number=_optional_env("ACS_PHONE_NUMBER"),
        connection_string=_optional_env("AZURE_ACS_CONN_KEY"),
        callback_path=_optional_env("CALLBACK_EVENTS_URI"),
        media_stream_host=_optional_env("CALLBACK_URI_HOST"),
        system_prompt_path=prompt_override or default_prompt,
    )


def get_voice_and_model_selections() -> dict:
    """Return voice and model selections directly from session config for frontend consumption."""
    return SESSION_CONFIG.get("selections", {
        "gptRealtimeVoices": [],
        "voiceLiveVoices": [],
        "gptRealtimeModels": [],
        "voiceLiveModels": [],
    })

