#!/bin/sh

# Download ocb binary from github releases

OCB_VERSION=0.84.0

OS=$(uname -s)

if [ "$OS" != "Linux" ]; then
    echo "This script is only for Linux"
    exit 1
fi

ARCH=$(uname -m)
if [ "$ARCH" = "x86_64" ]; then
    OCB_ARCH="amd64"
elif [ "$ARCH" = "aarch64" ]; then
    OCB_ARCH="arm64"
else
    echo "Unsupported architecture $ARCH"
    exit 1
fi

OCB_URL="https://github.com/open-telemetry/opentelemetry-collector/releases/download/cmd%2Fbuilder%2Fv${OCB_VERSION}/ocb_${OCB_VERSION}_linux_${OCB_ARCH}"
curl -LJO ${OCB_URL} && mv ocb_${OCB_VERSION}_linux_${OCB_ARCH} ocb && chmod +x ocb
