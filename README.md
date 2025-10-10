# gpt-realtime-agents

Unified Azure OpenAI Realtime solution that:
- Hosts a FastAPI backend which issues ephemeral session keys, resolves function calls, and now serves a React single-page application.
- Ships a modern React/Vite frontend cloned from [`contoso-voicecare-ai-unified`](https://github.com/samelhousseini/contoso-voicecare-ai-unified) for multi-industry support experiences.

## Prerequisites
- Python 3.10+
- An Azure OpenAI resource with Realtime preview access
- Environment variables configured in `.env`
- [`uv`](https://github.com/astral-sh/uv) (recommended) or `pip`

## Configuration
1. Copy `.env.sample` to `.env`:
	```powershell
	Copy-Item .env.sample .env
	```
2. Replace the placeholder values in `.env` with the details for your Azure OpenAI resource:

- `AZURE_GPT_REALTIME_URL` – `https://<resource>.openai.azure.com/openai/realtimeapi/sessions?api-version=...`
- `WEBRTC_URL` – `https://<region>.realtimeapi-preview.ai.azure.com/v1/realtimertc`
- `AZURE_GPT_REALTIME_KEY` – **Server-side only.** The FastAPI app uses this or a managed identity to talk to Azure.
- Optional overrides:
	- `AZURE_GPT_REALTIME_DEPLOYMENT`
	- `AZURE_GPT_REALTIME_VOICE`

## Install dependencies
```powershell
# preferred for Python deps
uv sync

# alternative
pip install .
```

## Clone the React frontend
```powershell
git clone https://github.com/samelhousseini/contoso-voicecare-ai-unified frontend
```

## Run the stack locally

1. **Install backend dependencies** (see above).
2. **Install frontend dependencies & build**:
	```powershell
	cd frontend
	npm ci
	npm run build
	cd ..
	```
3. **Expose the build output to the backend** (copy `frontend/dist` into `audio_backend/frontend_dist`).
	```powershell
	Remove-Item -Recurse -Force audio_backend\frontend_dist -ErrorAction SilentlyContinue
	Copy-Item -Recurse -Force frontend\dist audio_backend\frontend_dist
	```
4. **Run the FastAPI backend** (serves APIs and the React app):
	```powershell
	uv run uvicorn audio_backend.backend:app --host 0.0.0.0 --port 8080
	```
5. Browse to `http://localhost:8080/` for the React UI. API endpoints remain available under `/api`.

## Container deployment

The repository includes a Dockerfile that builds the React app and bundles it with the FastAPI service.

```powershell
docker build -t gpt-realtime-agents .
docker run -p 8080:8080 --env-file .env gpt-realtime-agents
```

This multi-stage build does the following:
- Installs Node dependencies, runs `npm ci`, and executes `npm run build` for the React project.
- Installs Python dependencies, copies the FastAPI backend, and bundles the built frontend into `audio_backend/frontend_dist`.
- Launches the combined application using Uvicorn on port 8080.

### Endpoints
- `POST /api/session` – returns `{ session_id, ephemeral_key, webrtc_url }`
- `GET /api/tools` – lists tool definitions for the frontend
- `POST /api/function-call` – executes a requested tool and returns structured output
- `GET /healthz` – basic readiness probe

## Browser demo (`audio.html`)
- Update `CLIENT_CONFIG.backendBaseUrl` if your backend runs on a different host/port.
- Serve the file from a static server (for example `python -m http.server 5500`) and open it in a modern browser.
- Click **Start Session** to negotiate WebRTC. When the model asks for `generate_horoscope`, the page will call the backend, receive the horoscope, and feed it back to the model automatically.

## Python CLI demo (`audio.py`)
```powershell
uv run python audio.py
```

Type messages and inspect the streamed text/audio output. Enter `q` to exit.

## Extending function tools
Add new entries to the `TOOLS_REGISTRY` in `backend.py`. Each tool defines:
- The `definition` sent to Azure Realtime (matching the OpenAI schema)
- The `executor` coroutine/function that returns a JSON-serializable dictionary

The frontend automatically advertises whatever tools the backend exposes and forwards function-call invocations over the `/api/function-call` endpoint.
