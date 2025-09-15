#!/usr/bin/env bash
set -euo pipefail

# Versions
GO_VERSION="${GO_VERSION:-1.25.1}"
PROTOC_VERSION="${PROTOC_VERSION:-29.3}"
PROTOC_GEN_GO_VERSION="${PROTOC_GEN_GO_VERSION:-1.36.5}"
PROTOC_GEN_GO_GRPC_VERSION="${PROTOC_GEN_GO_GRPC_VERSION:-1.5.1}"

# Directory to install tools
INSTALL_DIR="${INSTALL_DIR:-$HOME/.proto-tools}"
BIN_DIR="$INSTALL_DIR/bin"
TMP_DIR="$INSTALL_DIR/tmp"

# Flag to control printing instructions (default: true)
# Can be overridden with the PRINT_INSTRUCTIONS environment variable
PRINT_INSTRUCTIONS=${PRINT_INSTRUCTIONS:-true}

# Reset
Color_Off=''

# Regular Colors
Red=''
Green=''
Dim='' # White

# Bold
Bold_White=''
Bold_Green=''

if [[ -t 1 ]]; then
    # Reset
    Color_Off='\033[0m' # Text Reset

    # Regular Colors
    Red='\033[0;31m'   # Red
    Green='\033[0;32m' # Green
    Dim='\033[0;2m'    # White

    # Bold
    Bold_Green='\033[1;32m' # Bold Green
    Bold_White='\033[1m'    # Bold White
fi

error() {
    echo -e "${Red}error${Color_Off}:" "$@" >&2
    exit 1
}

info() {
    echo -e "${Dim}$@ ${Color_Off}"
}

info_bold() {
    echo -e "${Bold_White}$@ ${Color_Off}"
}

success() {
    echo -e "${Green}$@ ${Color_Off}"
}

# Detect platform
platform=$(uname -sm)
case $platform in
'Darwin x86_64')
    go_platform="darwin-amd64"
    protoc_platform="osx-x86_64"
    grpc_platform="darwin.amd64"
    protoc_gen_go_platform="darwin.amd64"
    ;;
'Darwin arm64')
    go_platform="darwin-arm64"
    protoc_platform="osx-aarch_64"
    grpc_platform="darwin.arm64"
    protoc_gen_go_platform="darwin.arm64"
    ;;
'Linux aarch64' | 'Linux arm64')
    go_platform="linux-arm64"
    protoc_platform="linux-aarch_64"
    grpc_platform="linux.arm64"
    protoc_gen_go_platform="linux.arm64"
    ;;
'Linux x86_64')
    go_platform="linux-amd64"
    protoc_platform="linux-x86_64"
    grpc_platform="linux.amd64"
    protoc_gen_go_platform="linux.amd64"
    ;;
*)
    error "Unsupported platform: $platform"
    ;;
esac

# Create installation directories
mkdir -p "$BIN_DIR" "$TMP_DIR" ||
    error "Failed to create install directories"

info_bold "Installing tools to $INSTALL_DIR"

# Download and install Go
download_go() {
    info "Downloading Go $GO_VERSION..."
    go_url="https://go.dev/dl/go${GO_VERSION}.${go_platform}.tar.gz"
    tmp_file="$TMP_DIR/go.tar.gz"
    
    curl --fail --location --progress-bar --output "$tmp_file" "$go_url" ||
        error "Failed to download Go from \"$go_url\""
    
    info "Extracting Go..."
    tar -xzf "$tmp_file" -C "$INSTALL_DIR" ||
        error "Failed to extract Go"
    
    # Create symlinks to binaries
    ln -sf "$INSTALL_DIR/go/bin/go" "$BIN_DIR/go" ||
        error "Failed to link go binary"
    ln -sf "$INSTALL_DIR/go/bin/gofmt" "$BIN_DIR/gofmt" ||
        error "Failed to link gofmt binary"
    
    success "Go $GO_VERSION installed successfully!"
}

# Download and install Protoc
download_protoc() {
    info "Downloading protoc $PROTOC_VERSION..."
    protoc_url="https://github.com/protocolbuffers/protobuf/releases/download/v${PROTOC_VERSION}/protoc-${PROTOC_VERSION}-${protoc_platform}.zip"
    tmp_file="$TMP_DIR/protoc.zip"
    
    curl --fail --location --progress-bar --output "$tmp_file" "$protoc_url" ||
        error "Failed to download Protoc from \"$protoc_url\""
    
    info "Extracting protoc..."
    unzip -oq "$tmp_file" -d "$INSTALL_DIR/protoc" ||
        error "Failed to extract protoc"
    
    # Create symlink to protoc binary
    ln -sf "$INSTALL_DIR/protoc/bin/protoc" "$BIN_DIR/protoc" ||
        error "Failed to link protoc binary"
    
    success "Protoc $PROTOC_VERSION installed successfully!"
}

# Download protoc-gen-go directly from GitHub releases
download_protoc_gen_go() {
    info "Downloading protoc-gen-go $PROTOC_GEN_GO_VERSION..."
    # Using the correct URL format with version in the filename
    plugin_url="https://github.com/protocolbuffers/protobuf-go/releases/download/v${PROTOC_GEN_GO_VERSION}/protoc-gen-go.v${PROTOC_GEN_GO_VERSION}.${protoc_gen_go_platform}.tar.gz"
    tmp_file="$TMP_DIR/protoc-gen-go.tar.gz"
    
    curl --fail --location --progress-bar --output "$tmp_file" "$plugin_url" ||
        error "Failed to download protoc-gen-go from \"$plugin_url\""
    
    # Extract the binary
    info "Extracting protoc-gen-go binary..."
    tar -xzf "$tmp_file" -C "$TMP_DIR" ||
        error "Failed to extract protoc-gen-go"
    
    # Move the extracted binary to BIN_DIR
    mv "$TMP_DIR/protoc-gen-go" "$BIN_DIR/" ||
        error "Failed to move protoc-gen-go binary"
    
    # Make it executable
    chmod +x "$BIN_DIR/protoc-gen-go" ||
        error "Failed to make protoc-gen-go executable"
    
    success "protoc-gen-go $PROTOC_GEN_GO_VERSION installed successfully!"
}

# Download protoc-gen-go-grpc directly from official GitHub releases
download_protoc_gen_go_grpc() {
    info "Downloading protoc-gen-go-grpc $PROTOC_GEN_GO_GRPC_VERSION..."
    
    # Download the official binary directly from GitHub releases
    # URL format: https://github.com/grpc/grpc-go/releases/download/cmd%2Fprotoc-gen-go-grpc%2Fv1.4.0/protoc-gen-go-grpc.v1.4.0.linux.386.tar.gz
    # We'll create the URL based on OS and architecture
    
    grpc_url="https://github.com/grpc/grpc-go/releases/download/cmd%2Fprotoc-gen-go-grpc%2Fv${PROTOC_GEN_GO_GRPC_VERSION}/protoc-gen-go-grpc.v${PROTOC_GEN_GO_GRPC_VERSION}.${grpc_platform}.tar.gz"
    tar_file="$TMP_DIR/protoc-gen-go-grpc.tar.gz"
    
    info "Downloading official binary from $grpc_url"
    curl --fail --location --progress-bar --output "$tar_file" "$grpc_url" ||
        error "Failed to download protoc-gen-go-grpc from \"$grpc_url\""
    
    # Extract the binary
    info "Extracting protoc-gen-go-grpc binary..."
    tar -xzf "$tar_file" -C "$TMP_DIR" ||
        error "Failed to extract protoc-gen-go-grpc"
    
    # Move the extracted binary to BIN_DIR (assuming it's at the root of the tar archive)
    mv "$TMP_DIR/protoc-gen-go-grpc" "$BIN_DIR/" ||
        error "Failed to move protoc-gen-go-grpc binary"
    
    # Make it executable
    chmod +x "$BIN_DIR/protoc-gen-go-grpc" ||
        error "Failed to make protoc-gen-go-grpc executable"
    
    success "protoc-gen-go-grpc $PROTOC_GEN_GO_GRPC_VERSION downloaded successfully!"
}

# Main installation process
download_go
download_protoc
download_protoc_gen_go
download_protoc_gen_go_grpc

# Clean up temporary files
rm -rf "$TMP_DIR"

# Instructions for updating PATH
if [[ "$PRINT_INSTRUCTIONS" != "false" ]]; then
    echo
    info_bold "Installation complete!"
    info "To use the installed tools, add the following to your shell profile:"
    echo
    info_bold "  export PATH=\"$BIN_DIR:\$PATH\""
    echo
    info "You can also use the tools directly by running:"
    echo
    info_bold "  $BIN_DIR/go"
    info_bold "  $BIN_DIR/protoc"
    info_bold "  $BIN_DIR/protoc-gen-go"
    info_bold "  $BIN_DIR/protoc-gen-go-grpc"
    echo 
else
    echo
    info_bold "Installation complete!"
    echo
fi 