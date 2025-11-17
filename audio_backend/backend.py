"""FastAPI backend for Azure OpenAI Realtime function calling demos.

This service exposes two responsibilities:
- issue short-lived ephemeral keys for WebRTC sessions with Azure OpenAI Realtime.
- execute function-calling callbacks (currently a horoscope generator) on behalf of the browser client.

The design keeps the function registry generic so new tools can be added in a single place
without touching the frontend. Each tool definition mirrors the OpenAI Realtime schema.
"""
from __future__ import annotations


import os
import json
import logging
import sys
import random
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Literal

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

try:
    from azure.identity.aio import DefaultAzureCredential, get_bearer_token_provider
except ModuleNotFoundError as exc:  # pragma: no cover - module provided via dependencies
    raise RuntimeError(
        "azure-identity must be installed to run the backend service"
    ) from exc

from dotenv import load_dotenv
import inspect
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.json import JSON as RichJSON


sys.path.insert(0, str(Path(__file__).parent ))


from tools_registry import *
from common.config import (
    get_browser_realtime_config,
    get_voice_live_config,
    get_voice_and_model_selections,
)
from services.browser_session_service import (
    BrowserSession,
    ConnectionMode,
    create_browser_session,
)


console = Console()

load_dotenv()

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Realtime Function Calling Backend", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # demo purposes only; tighten for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


browser_realtime_config = get_browser_realtime_config()
voice_live_config = get_voice_live_config()


FRONTEND_DIST_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"
FRONTEND_BACKEND_BASE_URL = os.getenv("VITE_BACKEND_BASE_URL", "http://localhost:8080/api")

print("REALTIME_SESSION_URL", browser_realtime_config.realtime_session_url)
print("WEBRTC_URL", browser_realtime_config.webrtc_url)
print("DEFAULT_DEPLOYMENT", browser_realtime_config.default_deployment)
print("DEFAULT_VOICE", browser_realtime_config.default_voice)
print("AZURE_API_KEY", browser_realtime_config.azure_api_key is not None)



credential = DefaultAzureCredential(exclude_interactive_browser_credential=False)
token_provider = get_bearer_token_provider(credential, "https://cognitiveservices.azure.com/.default")


class SessionRequest(BaseModel):
    deployment: str | None = Field(default=None, description="Azure OpenAI deployment name")
    voice: str | None = Field(default=None, description="Voice to request in the session")
    connection_mode: ConnectionMode | None = Field(
        default="webrtc",
        description="Connection mode for the browser client",
    )


class SessionResponse(BaseModel):
    session_id: str = Field(..., description="Azure OpenAI WebRTC session id")
    ephemeral_key: str = Field(..., description="Ephemeral client secret for WebRTC auth")
    realtimeUrl: str = Field(..., description="Regional WebRTC entry point")
    deployment: str = Field(..., description="Deployment used when requesting the session")
    voice: str = Field(..., description="Voice registered with the session")


class FunctionCallRequest(BaseModel):
    name: str = Field(..., description="Function/tool name requested by the model")
    call_id: str = Field(..., description="Unique call id supplied by Azure Realtime")
    arguments: Dict[str, Any] | str = Field(
        default_factory=dict,
        description="Arguments supplied by the model; may be JSON string or dict",
    )


class FunctionCallResponse(BaseModel):
    call_id: str
    output: Dict[str, Any]


ToolExecutor = Callable[[Dict[str, Any]], Awaitable[Dict[str, Any]] | Dict[str, Any]]


async def _get_auth_headers(connection_mode: ConnectionMode) -> Dict[str, str]:
    headers = {"Content-Type": "application/json"}
    
    if connection_mode == "webrtc":
        if browser_realtime_config.azure_api_key:
            headers["api-key"] = browser_realtime_config.azure_api_key
            return headers
    else:
        if voice_live_config.api_key:
            headers["api-key"] = voice_live_config.api_key
            return headers

    # Prefer managed identity / Azure AD tokens when available
    token = await token_provider()
    headers["Authorization"] = f"Bearer {token}"
    return headers


def _parse_arguments(arguments: Dict[str, Any] | str) -> Dict[str, Any]:
    if isinstance(arguments, dict):
        return arguments
    try:
        return json.loads(arguments)
    except json.JSONDecodeError as exc:  # pragma: no cover - invalid payloads are rare
        raise HTTPException(status_code=400, detail=f"Unable to parse arguments JSON: {exc}")



@app.get("/api/tools")
async def list_tools() -> Dict[str, Any]:
    """Return tool definitions for the frontend to register with the realtime session."""
    return {
        "tools": [tool["definition"] for tool in TOOLS_REGISTRY.values()],
        "tool_choice": "auto",
    }


@app.post("/api/session", response_model=SessionResponse)
async def create_session(request: SessionRequest) -> SessionResponse:
    """Issue an ephemeral key suitable for establishing a WebRTC session."""
    
    console.log(f"[create_session] Received session creation request: {request.model_dump_json()}")
    connection_mode: ConnectionMode = request.connection_mode or "webrtc"
    
    if connection_mode == "voice-live":
        deployment = request.deployment or voice_live_config.default_model
        voice = request.voice or voice_live_config.default_voice
    else:
        deployment = request.deployment or browser_realtime_config.default_deployment
        voice = request.voice or browser_realtime_config.default_voice
    
    console.log(f"[create_session] deployment={deployment}, voice={voice}, connection_mode={connection_mode}")

    realtime_headers: Dict[str, str] | None = None
    realtime_headers = await _get_auth_headers(connection_mode)
    print("Realtime Headers:", realtime_headers)

    try:
        session: BrowserSession = await create_browser_session(
            connection_mode=connection_mode,
            deployment=deployment,
            voice=voice,
            realtime_headers=realtime_headers,
        )
        
        console.log("[create_session] Created session:", session)
    except httpx.HTTPStatusError as exc:
        logger.exception("Failed to create realtime session: %s", exc)
        raise HTTPException(status_code=exc.response.status_code, detail=exc.response.text)
    except Exception as exc:
        logger.exception("Failed to create realtime session: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))

    return SessionResponse(
        session_id=session.session_id,
        ephemeral_key=session.ephemeral_key,
        realtimeUrl=session.realtime_url,
        deployment=session.deployment,
        voice=session.voice,
    )


@app.post("/api/function-call", response_model=FunctionCallResponse)
async def execute_function(request: FunctionCallRequest) -> FunctionCallResponse:
    """Execute a tool requested by the model, return its structured output, and
    display a rich debug pane (if 'rich' is installed) with name, arguments, and result.
    """
    tool = TOOLS_REGISTRY.get(request.name)
    if not tool:
        raise HTTPException(status_code=404, detail=f"Unknown function '{request.name}'")

    arguments = _parse_arguments(request.arguments)
    executor: ToolExecutor = tool["executor"]

    result = executor(arguments)
    if inspect.isawaitable(result):
        result = await result

    if not isinstance(result, dict):
        raise HTTPException(status_code=500, detail="Function executor must return a dict")

    # Rich debug output (best-effort; falls back silently if rich not available)
    try:

        console = Console()

        table = Table.grid(padding=(0, 1))
        table.add_column(justify="right", style="bold cyan")
        table.add_column(style="white")

        table.add_row("Function:", request.name)
        table.add_row("Call ID:", request.call_id)

        # Arguments block
        try:
            args_json = RichJSON.from_data(arguments)
        except Exception:
            args_json = str(arguments)

        # Result block
        try:
            result_json = RichJSON.from_data(result)
        except Exception:
            result_json = str(result)

        console.print(
            Panel.fit(
                table,
                title="Function Call",
                border_style="magenta",
            )
        )
        console.print(Panel(args_json, title="Arguments", border_style="cyan"))
        console.print(Panel(result_json, title="Result", border_style="green"))
    except Exception as e:
        # Swallow any rich / rendering errors to avoid impacting API behavior
        console.print(f"Exception: {e}")

    return FunctionCallResponse(call_id=request.call_id, output=result)


@app.get("/healthz")
async def healthcheck() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/runtime-config.js", response_class=PlainTextResponse)
async def runtime_config() -> PlainTextResponse:
    print("[BROWSER INIT] Serving runtime config with backendBaseUrl =", FRONTEND_BACKEND_BASE_URL)
    
    # Get voice and model selections from config
    selections = get_voice_and_model_selections()
    
    payload = json.dumps({
        "backendBaseUrl": FRONTEND_BACKEND_BASE_URL,
        "voiceSelections": {
            "gptRealtime": selections["gptRealtimeVoices"],
            "voiceLive": selections["voiceLiveVoices"],
        },
        "modelSelections": {
            "gptRealtime": selections["gptRealtimeModels"],
            "voiceLive": selections["voiceLiveModels"],
        },
    })
    script = f"window.__APP_CONFIG__ = Object.freeze({payload});"
    return PlainTextResponse(content=script, media_type="application/javascript")


@app.on_event("shutdown")
async def shutdown_event() -> None:
    await credential.close()


# ============================================================================
# ACS Phone Integration (WebSocket only: Phone ↔ ACS ↔ AI Model)
# ============================================================================
try:
    from backend_acs import router as acs_router, startup_event as acs_startup
    app.include_router(acs_router)
    app.on_event("startup")(acs_startup)
    logger.info("✅ ACS Phone integration routes mounted at /acs-phone/*")
except ImportError as e:
    logger.warning("⚠️  ACS Phone integration not available: %s", e)


if FRONTEND_DIST_DIR.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST_DIR, html=True), name="frontend")
else:
    logger.warning("Frontend build directory not found at %s; React app will not be served.", FRONTEND_DIST_DIR)
