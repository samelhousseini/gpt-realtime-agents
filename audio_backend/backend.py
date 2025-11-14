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
from typing import Any, Awaitable, Callable, Dict, List

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


def _clean_env(name: str, default: str | None = None) -> str:
    raw = os.getenv(name, default)
    if raw is None:
        raise RuntimeError(f"Environment variable {name} must be set")
    return raw.strip().strip('"').strip("'")


REALTIME_SESSION_URL = _clean_env("AZURE_GPT_REALTIME_URL").replace('"', '').replace("'", "")
WEBRTC_URL = _clean_env("WEBRTC_URL").replace('"', '').replace("'", "")
DEFAULT_DEPLOYMENT = os.getenv("AZURE_GPT_REALTIME_DEPLOYMENT", "gpt-realtime").replace('"', '').replace("'", "")
DEFAULT_VOICE = os.getenv("AZURE_GPT_REALTIME_VOICE", "verse").replace('"', '').replace("'", "")
AZURE_API_KEY = os.getenv("AZURE_GPT_REALTIME_KEY").replace('"', '').replace("'", "")


def _optional_env(name: str, default: str) -> str:
    raw = os.getenv(name, default)
    if not raw:
        return default
    return raw.strip().strip('"').strip("'")

FRONTEND_DIST_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"
FRONTEND_BACKEND_BASE_URL = _optional_env("VITE_BACKEND_BASE_URL", "http://localhost:8080/api")

print("REALTIME_SESSION_URL", REALTIME_SESSION_URL)
print("WEBRTC_URL", WEBRTC_URL)
print("DEFAULT_DEPLOYMENT", DEFAULT_DEPLOYMENT)
print("DEFAULT_VOICE", DEFAULT_VOICE)
print("AZURE_API_KEY", AZURE_API_KEY is not None)



credential = DefaultAzureCredential(exclude_interactive_browser_credential=False)
token_provider = get_bearer_token_provider(credential, "https://cognitiveservices.azure.com/.default")


class SessionRequest(BaseModel):
    deployment: str | None = Field(default=None, description="Azure OpenAI deployment name")
    voice: str | None = Field(default=None, description="Voice to request in the session")


class SessionResponse(BaseModel):
    session_id: str = Field(..., description="Azure OpenAI WebRTC session id")
    ephemeral_key: str = Field(..., description="Ephemeral client secret for WebRTC auth")
    webrtc_url: str = Field(..., description="Regional WebRTC entry point")
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


async def _get_auth_headers() -> Dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if AZURE_API_KEY:
        headers["api-key"] = AZURE_API_KEY
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
    deployment = request.deployment or DEFAULT_DEPLOYMENT
    voice = request.voice or DEFAULT_VOICE

    payload = {"model": deployment, "voice": voice}
    headers = await _get_auth_headers()

    print("Creating realtime session with payload:")
    print("===================================")
    print("REALTIME_SESSION_URL:", REALTIME_SESSION_URL)
    print("HEADERS:", headers)
    print("PAYLOAD:", payload)
    
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(REALTIME_SESSION_URL, headers=headers, json=payload)
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:  # pragma: no cover - network specific
            logger.exception("Failed to create realtime session: %s", exc)
            raise HTTPException(status_code=exc.response.status_code, detail=exc.response.text)

    data = response.json()
    ephemeral_key = data.get("client_secret", {}).get("value")
    session_id = data.get("id")
    if not ephemeral_key or not session_id:
        raise HTTPException(status_code=500, detail="Malformed session response from Azure")

    return SessionResponse(
        session_id=session_id,
        ephemeral_key=ephemeral_key,
        webrtc_url=WEBRTC_URL,
        deployment=deployment,
        voice=voice,
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
    payload = json.dumps({"backendBaseUrl": FRONTEND_BACKEND_BASE_URL})
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
