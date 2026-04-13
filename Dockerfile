# Stage 1: Frontend build
FROM node:22-alpine AS frontend-build

WORKDIR /app/frontend

# Copy frontend source and config
COPY frontend/ .

# Install dependencies with legacy peer deps for compatibility
RUN npm install --legacy-peer-deps && npm install ajv@8.12.0 --legacy-peer-deps

RUN npm run build

# Stage 2: Backend with static files
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN useradd -m -u 1000 appuser

# Copy backend
COPY backend/ /app/backend

# Install Python dependencies
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Copy built frontend from stage 1
COPY --from=frontend-build /app/frontend/build /app/frontend_build

# Change ownership to non-root user
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose port 8000
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/api/health/ready || exit 1

# Run the backend server
CMD ["uvicorn", "backend.server:app", "--host", "0.0.0.0", "--port", "8000"]
