#!/bin/bash

# Exit on any error
set -e

# --- Config ---
REPOSITORY="wundergraph/cosmo"
IMAGE_NAME="nats"
IMAGE_TAG="2.11.0"
GHCR_IMAGE="ghcr.io/${REPOSITORY}/${IMAGE_NAME}:${IMAGE_TAG}"

# Build the Docker image
echo "🔨 Building image..."
docker build -t "$GHCR_IMAGE" .

# Push the image to GitHub Container Registry
echo "🚀 Pushing to GitHub Container Registry..."
docker push "$GHCR_IMAGE"

echo "✅ Done! Image pushed to $GHCR_IMAGE"
