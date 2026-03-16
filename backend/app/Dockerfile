# --- Build Stage (Node.js) ---
FROM node:20-slim AS build-stage
WORKDIR /app/frontend
# Relative to repository root
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./

# Build-time environment variables for Vite
ARG VITE_GCP_PROJECT
ARG VITE_MODEL_ID
ARG VITE_MODEL_ID_IMAGE
ARG VITE_GEMINI_API_KEY
ARG VITE_PROXY_URL

ENV VITE_GCP_PROJECT=$VITE_GCP_PROJECT
ENV VITE_MODEL_ID=$VITE_MODEL_ID
ENV VITE_MODEL_ID_IMAGE=$VITE_MODEL_ID_IMAGE
ENV VITE_GEMINI_API_KEY=$VITE_GEMINI_API_KEY
ENV VITE_PROXY_URL=$VITE_PROXY_URL

RUN npm run build

# --- Final Stage (Python) ---
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV VIRTUAL_ENV=/app/.venv
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install dependencies
# If context is root, these are in backend/
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --no-install-project --no-dev

# Copy the app code into a subdirectory named 'app'
COPY backend/app/ app/

# Copy the built frontend from build-stage to /frontend/dist
COPY --from=build-stage /app/frontend/dist /frontend/dist

# Final sync
RUN uv sync --no-install-project --no-dev

ENV HOST 0.0.0.0
# Ensure /app is in PYTHONPATH so 'app' is a valid package
ENV PYTHONPATH=/app
EXPOSE 8080

CMD ["uv", "run", "python", "app/main.py"]
