"""Shared configuration helpers for browser and ACS backends."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Optional


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


@dataclass(frozen=True)
class BrowserRealtimeConfig:
    realtime_session_url: str
    webrtc_url: str
    default_deployment: str
    default_voice: str
    azure_api_key: Optional[str]


@dataclass(frozen=True)
class VoiceLiveConfig:
    endpoint: str
    api_key: str
    default_model: str
    default_voice: str
    region: str
    api_version: str

@dataclass(frozen=True)
class AcsConfig:
    source_number: Optional[str]
    connection_string: Optional[str]
    callback_path: Optional[str]
    media_stream_host: Optional[str]
    system_prompt_path: Optional[str]


@lru_cache(maxsize=1)
def get_browser_realtime_config() -> BrowserRealtimeConfig:
    return BrowserRealtimeConfig(
        realtime_session_url=_clean_env("AZURE_GPT_REALTIME_URL"),
        webrtc_url=_clean_env("WEBRTC_URL"),
        default_deployment=_clean_env("AZURE_GPT_REALTIME_DEPLOYMENT", default="gpt-realtime"),
        default_voice=_clean_env("AZURE_GPT_REALTIME_VOICE", default="verse"),
        azure_api_key=_optional_env("AZURE_GPT_REALTIME_KEY"),
    )


@lru_cache(maxsize=1)
def get_voice_live_config() -> VoiceLiveConfig:
    endpoint = _clean_env("AZURE_VOICELIVE_ENDPOINT")
    api_key = _clean_env("AZURE_VOICELIVE_API_KEY")
    default_model = _clean_env("AZURE_VOICELIVE_MODEL", default="gpt-realtime")
    default_voice = _clean_env("AZURE_VOICELIVE_VOICE", default="en-US-Ava:DragonHDLatestNeural")
    region = _clean_env("AZURE_VOICELIVE_REGION", default="swedencentral")
    api_version = _clean_env("AZURE_VOICELIVE_API_VERSION", default="2025-05-01-preview")
    return VoiceLiveConfig(
        endpoint=endpoint.rstrip("/"),
        api_key=api_key,
        default_model=default_model,
        default_voice=default_voice,
        region=region,
        api_version=api_version
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
