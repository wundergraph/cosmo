#!/bin/bash

# Exit on any error
set -e

# --- Config ---
REPOSITORY="wundergraph/cosmo"
IMAGE_NAME="nats"
IMAGE_TAG="2.11.0-alpine"
GHCR_IMAGE="ghcr.io/${REPOSITORY}/${IMAGE_NAME}:${IMAGE_TAG}"

# Create and use a buildx builder (if not exists)
docker buildx create --name multi-builder --use --bootstrap || true

# Build the Docker image
# Build and push multi-arch image
echo "🔨 Building multi-arch image for linux/amd64 and linux/arm64..."
docker buildx build \
    --platform linux/amd64,linux/arm64 \
    -t "$GHCR_IMAGE" \
    --push .

echo "✅ Done! Multi-arch image pushed to $GHCR_IMAGE"
