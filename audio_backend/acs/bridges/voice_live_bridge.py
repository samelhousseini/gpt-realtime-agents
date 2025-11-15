"""ACS bridge placeholder for Azure Voice Live API."""

from __future__ import annotations

from fastapi import WebSocket

from common.config import VoiceLiveConfig

from .base import BaseAcsBridge


class VoiceLiveBridge(BaseAcsBridge):
    """Routes ACS audio toward the Azure Voice Live WebSocket API.

    NOTE: This class currently acts as a placeholder that documents the
    Voice Live integration point. Refer to `do_not_commit/voice-live-quickstart.py`
    for a full client example that should be adapted here.
    """

    def __init__(self, config: VoiceLiveConfig):
        self._config = config

    async def handle(self, websocket: WebSocket) -> None:
        await websocket.close(code=1011, reason="Voice Live bridge not yet implemented")
