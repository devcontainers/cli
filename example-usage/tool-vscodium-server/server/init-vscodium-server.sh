#!/bin/bash
set -xe

# Default version - should be updated periodically
VSCODIUM_VERSION="1.96.4.25017"
INSTALL_LOCATION="$HOME/.vscodium-server"

if [ ! -e "$INSTALL_LOCATION/bin" ]; then
    echo "Downloading VSCodium Remote Server..."
    mkdir -p "$INSTALL_LOCATION"
    curl -fsSL "https://github.com/VSCodium/vscodium/releases/download/${VSCODIUM_VERSION}/vscodium-reh-linux-x64-${VSCODIUM_VERSION}.tar.gz" -o /tmp/vscodium-server.tar.gz
    echo "Extracting..."
    tar --strip 1 -xzf /tmp/vscodium-server.tar.gz -C "$INSTALL_LOCATION"
    rm -f /tmp/vscodium-server.tar.gz
    chmod +x "$INSTALL_LOCATION/bin/codium-server"
fi

if ! pidof codium-server > /dev/null 2>&1; then
    # Process customizations and features configuration
    if ! type jq > /dev/null 2>&1; then
        sudo apt-get -y install jq
    fi
    
    tmp_dir="$(mktemp -d)"
    mkdir -p "${tmp_dir}" "$HOME/.vscodium-server/data/Machine"

    # Get list of extensions
    extensions=( $(jq -r -M '[
        .mergedConfiguration.customizations?.vscodium[]?.extensions[]?,
        .mergedConfiguration.extensions[]?
        ] | .[]
    ' /server/configuration.json ) )

    # Install extensions if any are specified
    if [ "${extensions[0]}" != "" ] && [ "${extensions[0]}" != "null" ] ; then
        set +e
        for extension in "${extensions[@]}"; do
            "$INSTALL_LOCATION/bin/codium-server" --install-extension "${extension}"
        done
        set -e
    fi

    # Get VSCodium/VS Code settings
    settings="$(jq -M '[
        .mergedConfiguration.customizations?.vscodium[]?.settings?,
        .mergedConfiguration.settings?
        ] | add
    ' /server/configuration.json)"

    # Apply settings if any are specified
    if [ "${settings}" != "" ] && [ "${settings}" != "null" ]; then
        echo "${settings}" > "$HOME/.vscodium-server/data/Machine/settings.json"
    fi

    rm -rf "${tmp_dir}" /server/configuration.json

    # Start VSCodium server
    echo "Starting VSCodium Remote Server..."
    "$INSTALL_LOCATION/bin/codium-server" --host 0.0.0.0 --port 8000 --without-connection-token --accept-server-license-terms
else
    echo -e "\nVSCodium server is already running.\n\nConnect using: http://localhost:8000\n"
fi