#!/bin/bash
set -e
INSTALL_LOCATION="$HOME/.local/bin" 
INSTALL_TARGET=unknown-linux-gnu

if [ ! -e "$INSTALL_LOCATION"/code-server ]; then
    # Adapted from https://aka.ms/install-vscode-server/setup.sh
    install_arch=x86_64
    arch=$(uname -m)
    if [ $arch = "aarch64" ] || [ $arch = "arm64" ]; then
        install_arch=aarch64
    fi
    install_url=https://aka.ms/vscode-server-launcher/$install_arch-$INSTALL_TARGET
    echo "Installing from $install_url"
    mkdir -p "$INSTALL_LOCATION"
    if type curl > /dev/null 2>&1; then
        curl -sSLf $install_url -o "$INSTALL_LOCATION"/code-server
    elif type wget > /dev/null 2>&1; then
        wget -q $install_url -O "$INSTALL_LOCATION"/code-server
    else
        echo "Installation failed. Please install curl or wget in your container image."
        exit 1
    fi
    chmod +x "$INSTALL_LOCATION"/code-server
fi

if ! pidof code-server > /dev/null 2>&1; then
    # Process customizations.vscode and features configuration using jq
    # Logic could be simplified with https://github.com/devcontainers/cli/issues/113

    if ! type jq > /dev/null 2>&1; then
        sudo apt-get -y install jq
    fi
    tmp_dir="$(mktemp -d)"
    mkdir -p "${tmp_dir}" "$HOME"/.vscode-server/data/Machine

    # Get list of extensions - including legacy spots for backwards compatibility.
    extensions=( $(jq -r -M '[
        .mergedConfiguration.customizations?.vscode[]?.extensions[]?,
        .mergedConfiguration.extensions[]?
        ] | .[]
    ' /server/configuration.json ) )
    # Install extensions
    if [ "${extensions[0]}" != "" ] && [ "${extensions[0]}" != "null" ] ; then  
        set +e
        for extension in "${extensions[@]}"; do
            "$INSTALL_LOCATION/code-server" serve-local --accept-server-license-terms --install-extension "${extension}"
        done
        set -e
    fi

    # Get VS Code machine settings - including legacy spots for backwards compatibility.
    settings="$(jq -M '[
        .mergedConfiguration.customizations?.vscode[]?.settings?,
        .mergedConfiguration.settings?
        ] | add
    ' /server/configuration.json)"
    # Place settings in right spot
    if [ "${settings}" != "" ] && [ "${settings}" != "null" ]; then
        echo "${settings}" > "${HOME}"/.vscode-server/data/Machine/settings.json
    fi

    rm -rf "${tmp_dir}" /server/configuration.json

    # Start VS Code server
    "$INSTALL_LOCATION/code-server" serve-local --without-connection-token --accept-server-license-terms --host 0.0.0.0 --port 8000 
else
    echo -e "\ncode-server is already running.\n\nConnect using: http://localhost:8000\n"
fi