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
    # Process customizations.vscode and features configuration
    if ! type jq > /dev/null 2>&1; then
        sudo apt-get -y install jq
    fi
    tmp_dir="$(mktemp -d)"
    mkdir -p "${tmp_dir}" "$HOME"/.vscode-server/data/Machine

    # Logic could be simplified with https://github.com/devcontainers/cli/issues/113
    # Install extensions
    jq -M '.configuration.customizations?.vscode?.extensions?' /server/configuration.json > "${tmp_dir}"/extensions1.json
    jq -M '.featuresConfiguration?.featureSets[]?.features[]?.customizations?.vscode?.extensions?' /server/configuration.json  > "${tmp_dir}"/extensions2.json
    jq -M '.configuration.extensions?' /server/configuration.json > "${tmp_dir}"/extensions3.json                                      # Legacy locaiton - backwards compat
    jq -M '.featuresConfiguration?.featureSets[]?.features[]?.extensions?' /server/configuration.json  > "${tmp_dir}"/extensions4.json # Legacy locaiton - backwards compat
    extensions=( $(jq -s -M '.[0] + .[1] + .[2] + .[3]' "${tmp_dir}"/extensions1.json "${tmp_dir}"/extensions2.json ${tmp_dir}"/extensions3.json ${tmp_dir}"/extensions4.json | jq -r -M '.[]') )
    if [ "${extensions[0]}" != "null" ]; then 
        set +e
        for extension in "${extensions[@]}"; do
            "$INSTALL_LOCATION/code-server" serve-local --accept-server-license-terms --install-extension ${extension}
        done
        set -e
    fi

    # Add machine settings.json
    jq -M '.configuration.customizations?.vscode?.settings?' /server/configuration.json > "${tmp_dir}"/settings1.json
    jq -M '.featuresConfiguration?.featureSets[]?.features[]?.customizations?.vscode?.settings?' /server/configuration.json > "${tmp_dir}"/settings2.json
    jq -M '.configuration.settings?' /server/configuration.json  > "${tmp_dir}"/settings3.json                                      # Legacy locaiton - backwards compat
    jq -M '.featuresConfiguration?.featureSets[]?.features[]?.settings?' /server/configuration.json  > "${tmp_dir}"/settings4.json  # Legacy locaiton - backwards compat
    settings="$(jq -s -M '.[0] + .[1] + .[2] + .[3]' "${tmp_dir}"/settings1.json "${tmp_dir}"/settings2.json "${tmp_dir}"/settings3.json "${tmp_dir}"/settings4.json)"
    if [ "${settings}" != "null" ]; then
        echo "${settings}" > "${HOME}"/.vscode-server/data/Machine/settings.json
    fi

    rm -rf "${tmp_dir}" /server/configuration.json

    # Start server
    "$INSTALL_LOCATION/code-server" serve-local --without-connection-token --accept-server-license-terms --host 0.0.0.0 --port 8000 
else
    echo -e "\ncode-server is already running.\n\nConnect using: http://localhost:8000\n"
fi