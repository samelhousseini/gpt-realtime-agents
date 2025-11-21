"""ACS bridge for Azure Voice Live API."""

from __future__ import annotations

from fastapi import WebSocket

from acs.rtmt import RTMiddleTier

from .base import BaseAcsBridge, FastAPIWebSocketAdapter


class VoiceLiveBridge(BaseAcsBridge):
    """Routes ACS audio toward the Azure Voice Live WebSocket API."""

    def __init__(self, rt_middle_tier: RTMiddleTier):
        self._rt_middle_tier = rt_middle_tier

    async def handle(self, websocket: WebSocket) -> None:
        adapter = FastAPIWebSocketAdapter(websocket)
        await self._rt_middle_tier.forward_messages(adapter, is_acs_audio_stream=True)
