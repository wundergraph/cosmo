#!/bin/bash
set -e

echo "Installing wgc...   

__      ____ _  ___   
\ \ /\ / / _\` |/ __|  
 \ V  V / (_| | (__   
  \_/\_/ \__, |\___|  
         |___/        
"

OS=$(uname -s)
URL=""

case "$OS" in
    Linux)
        URL="https://github.com/wundegraph/cosmo/releases/latest/download/wgc-linux"
        ;;
    Darwin)
        URL="https://github.com/wundegraph/cosmo/releases/latest/download/wgc-mac"
        ;;
    CYGWIN*|MINGW32*|MSYS*|MINGW*)
        URL="https://github.com/wundegraph/cosmo/releases/latest/download/wgc-windows.exe"
        ;;
    *)
        echo "Unsupported OS: $OS"
        exit 1
        ;;
esac

curl -L -o /usr/local/bin/wgc $URL
chmod +x /usr/local/bin/wgc

echo "wgc installed successfully!"

