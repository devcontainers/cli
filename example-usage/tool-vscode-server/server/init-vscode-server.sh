#!/bin/sh
set -e
INSTALL_LOCATION="$HOME/.local/bin" 
INSTALL_TARGET=unknown-linux-gnu

if [ ! -e "$HOME/.vscode-cli" ]; then
    # Adapted from https://aka.ms/install-vscode-server/setup.sh
    install_arch=x86_64
    arch=$(uname -m)
    if [ $arch = "aarch64" ] || [ $arch = "arm64" ]; then
        install_arch=aarch64
    fi
    install_url=https://aka.ms/vscode-server-launcher/$install_arch-$INSTALL_TARGET
    echo "Installing from $install_url"
    mkdir -p $INSTALL_LOCATION
    if type curl > /dev/null 2>&1; then
        curl -sSLf $install_url -o $INSTALL_LOCATION/code-server
    elif type wget > /dev/null 2>&1; then
        wget -q $install_url -O $INSTALL_LOCATION/code-server
    else
        echo "Installation failed. Please install curl or wget in your container image."
        exit 1
    fi
    chmod +x $INSTALL_LOCATION/code-server
fi
if ! pidof code-server > /dev/null 2>&1; then
    $INSTALL_LOCATION/code-server serve-local --without-connection-token --accept-server-license-terms --host 0.0.0.0 --port 8000 
else
    echo "\ncode-server is already running.\n\nConnect using: http://localhost:8000\n"
fi