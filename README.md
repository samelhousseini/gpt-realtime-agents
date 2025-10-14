# gpt-realtime-agents

Unified Azure OpenAI Realtime solution that:
- Hosts a FastAPI backend which issues ephemeral session keys, resolves function calls, and now serves a React single-page application.
- Ships a modern React/Vite frontend cloned from [`contoso-voicecare-ai-unified`](https://github.com/samelhousseini/contoso-voicecare-ai-unified) for multi-industry support experiences.

## Deploy with Azure Developer CLI (preferred)

The quickest way to stand up the full solution is with the [Azure Developer CLI (`azd`)](https://learn.microsoft.com/azure/developer/azure-developer-cli/). It creates the Azure resources defined under `infra/`, builds the container image, and deploys the FastAPI + React app as an Azure Container App.

1. **Install prerequisites**
	- Azure subscription with Azure OpenAI Realtime preview access
	- [`azd` CLI](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
	- Azure CLI (required by `azd`) and authenticated session: `az login`
2. **Prepare environment settings**
	Create/maintain a local `.env` file and fill in the above environment variables (from `.env.sample`) 
	Update the placeholders in `.env`:
	- `AZURE_GPT_REALTIME_URL = https://<resource>.openai.azure.com/openai/realtimeapi/sessions?api-version=2025-04-01-preview`
	- `WEBRTC_URL = https://<region>.realtimeapi-preview.ai.azure.com/v1/realtimertc`
	- `AZURE_GPT_REALTIME_KEY` only when not relying on Managed Identity

	_Alternative_: 
	
	```powershell
	azd env new
	azd env set AZURE_GPT_REALTIME_URL https://<resource>.openai.azure.com/openai/realtimeapi/sessions?api-version=2025-04-01-preview
	azd env set WEBRTC_URL https://<region>.realtimeapi-preview.ai.azure.com/v1/realtimertc
	# Optional when using API key auth instead of Managed Identity
	azd env set AZURE_GPT_REALTIME_KEY <your-key>
	```
	

3. **Provision and deploy**
	```powershell
	azd provision --preview   # optional dry run
	azd up
	```

`azd up` returns deployment outputs such as `AZURE_AUDIO_BACKEND_URL`, which matches the value automatically injected into the frontend (`VITE_BACKEND_BASE_URL`).

---

## Manual setup for local development

If you prefer to run everything locally, follow the condensed checklist below.

### Prerequisites
- Python 3.10+
- Node.js 20+
- Azure OpenAI Realtime resource credentials (same values you would provide to `azd`)
- [`uv`](https://github.com/astral-sh/uv) (recommended) or `pip`

### Configure environment
```powershell
Copy-Item .env.sample .env
```
Update the placeholders in `.env`:
- `AZURE_GPT_REALTIME_URL = https://<resource>.openai.azure.com/openai/realtimeapi/sessions?api-version=2025-04-01-preview`
- `WEBRTC_URL = https://<region>.realtimeapi-preview.ai.azure.com/v1/realtimertc`
- `AZURE_GPT_REALTIME_KEY` only when not relying on Managed Identity

### Install dependencies
- **Using uv (recommended)**
  ```powershell
  uv venv
  uv pip install -e .
  ```
- **Using pip**
  ```powershell
  python -m venv .venv
  .venv\Scripts\Activate.ps1
  pip install -e .
  ```

### Run the stack locally
```powershell
cd frontend
npm ci
npm run build
cd ..

Remove-Item -Recurse -Force audio_backend\frontend_dist -ErrorAction SilentlyContinue
Copy-Item -Recurse -Force frontend\dist audio_backend\frontend_dist

uv run uvicorn audio_backend.backend:app --host 0.0.0.0 --port 8080
```
Navigate to `http://localhost:8080/` to verify the React UI and API endpoints.

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
