"""Shared ACS bridge utilities."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, AsyncIterator, Dict

from aiohttp import WSMsgType
from fastapi import WebSocket, WebSocketDisconnect


class FastAPIWebSocketAdapter:
    """Adapter to mimic aiohttp.WebSocketResponse for RTMiddleTier."""

    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.headers: Dict[str, str] = {}
        self._closed = False

    async def send_str(self, data: str) -> None:
        if self._closed:
            return
        await self.websocket.send_text(data)

    async def send_json(self, data: Dict[str, Any]) -> None:
        if self._closed:
            return
        await self.websocket.send_json(data)

    def __aiter__(self) -> AsyncIterator[Any]:
        return self

    async def __anext__(self) -> Any:
        try:
            raw = await self.websocket.receive()
            if "text" in raw:
                return type("WSMessage", (), {"type": WSMsgType.TEXT, "data": raw["text"]})()
            if "bytes" in raw:
                return type("WSMessage", (), {"type": WSMsgType.BINARY, "data": raw["bytes"]})()
            if raw.get("type") == "websocket.disconnect":
                self._closed = True
                raise StopAsyncIteration
            return raw
        except WebSocketDisconnect:
            self._closed = True
            raise StopAsyncIteration

    async def close(self, *, code: int = 1000, reason: str | None = None) -> None:
        if not self._closed:
            self._closed = True
            await self.websocket.close(code=code, reason=reason or "")


class BaseAcsBridge(ABC):
    """Interface for ACS ↔ AI bridges."""

    @abstractmethod
    async def handle(self, websocket: WebSocket) -> None:
        """Handle a FastAPI WebSocket originating from ACS."""
        raise NotImplementedError
