
FROM node:20-bullseye AS frontend-builder

WORKDIR /frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build


FROM python:3.11-bullseye AS runtime

WORKDIR /app

COPY audio_backend/requirements.txt ./requirements.txt
RUN pip install --upgrade pip \
	&& pip install -r requirements.txt

COPY audio_backend/ ./audio_backend
COPY --from=frontend-builder /frontend/dist ./audio_backend/frontend_dist

EXPOSE 8080

CMD ["uvicorn", "audio_backend.backend:app", "--host", "0.0.0.0", "--port", "8080"]
