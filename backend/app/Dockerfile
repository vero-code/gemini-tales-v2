# --- Build Stage (Node.js) ---
FROM node:20-slim AS build-stage
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
# Add environment variable for build if needed
ARG VITE_GCP_PROJECT
ENV VITE_GCP_PROJECT=$VITE_GCP_PROJECT
RUN npm run build

# --- Final Stage (Python) ---
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV VIRTUAL_ENV=/app/.venv
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install dependencies
COPY pyproject.toml uv.lock ./
RUN uv sync --no-install-project --no-dev

# Copy the rest of the application
COPY . .

# Copy the built frontend from build-stage
COPY --from=build-stage /app/frontend/dist /app/frontend/dist

# Final sync
RUN uv sync --no-install-project --no-dev

ENV HOST 0.0.0.0
EXPOSE 8080

CMD ["uv", "run", "main.py"]
