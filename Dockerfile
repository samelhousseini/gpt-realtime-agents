FROM node:20-bullseye AS frontend-builder

WORKDIR /frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN node node_modules/vite/bin/vite.js build


FROM python:3.11-bullseye AS runtime

WORKDIR /app

COPY audio_backend/requirements.txt ./requirements.txt
RUN pip install --upgrade pip \
    && pip install -r requirements.txt

COPY audio_backend/ ./audio_backend
COPY prompts/ ./prompts
COPY .env ./.env
COPY session_config.json ./session_config.json

COPY --from=frontend-builder /frontend/dist ./frontend/dist

EXPOSE 8080

CMD ["uvicorn", "audio_backend.backend:app", "--host", "0.0.0.0", "--port", "8080"]
