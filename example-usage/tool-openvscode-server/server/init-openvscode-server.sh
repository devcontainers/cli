#!/bin/bash
set -e
cd "$(dirname $0)"

if [ ! -e "$HOME/.openvscodeserver/bin" ]; then
    echo "Downloading openvscode-server..."
    curl -fsSL https://github.com/gitpod-io/openvscode-server/releases/download/openvscode-server-v1.72.2/openvscode-server-v1.72.2-linux-x64.tar.gz -o /tmp/openvscode-server.tar.gz
    mkdir -p "$HOME/.openvscodeserver"
    echo "Extracting..."
    tar --strip 1 -xzf /tmp/openvscode-server.tar.gz -C "$HOME/.openvscodeserver/"
    rm -f /tmp/openvscode-server.tar.gz
fi

if [ "$(ps -ef | grep '\.openvscode-server' | wc -l)" = "1" ]; then
    # Process customizations.openvscodeserver and features configuration
    # Logic could be simplified with https://github.com/devcontainers/cli/issues/113

    if ! type jq > /dev/null 2>&1; then
        sudo apt-get -y install jq
    fi
    tmp_dir="$(mktemp -d)"
    mkdir -p "${tmp_dir}" "$HOME"/.openvscode-server/data/Machine

    # Get list of extensions to install - [Optional] Also set of extensions from `vscode.extensions` property
    extensions=( $(jq -r -M '[
        .mergedConfiguration.customizations?.openvscodeserver[]?.extensions[]?,
        .mergedConfiguration.customizations?.vscode[]?.extensions[]?
        ] | .[]
    ' /server/configuration.json ) )
    # Install extensions
    if [ "${extensions[0]}" != "" ] && [ "${extensions[0]}" != "null" ] ; then 
        set +e
        for extension in "${extensions[@]}"; do
            "$HOME"/.openvscodeserver/bin/openvscode-server --install-extension ${extension}
        done
        set -e
    fi

    # Get openvscode-server machine settings.json - [Optional] Also settings from `vscode.settings` property
    settings="$(jq -M '[
        .mergedConfiguration.customizations?.openvscodeserver[]?.settings?,
        .mergedConfiguration.customizations?.vscode[]?.settings?
        ] | add
    ' /server/configuration.json)"
    # Place settings in right spot
    if [ "${settings}" != "" ] && [ "${settings}" != "null" ]; then
        echo "${settings}" >  "$HOME"/.openvscode-server/data/Machine/settings.json
    fi
    
    rm -rf "${tmp_dir}" /server/configuration.json

    # Start openvscode-server
    "$HOME"/.openvscodeserver/bin/openvscode-server serve-local --without-connection-token --host 0.0.0.0 --port 8000
else
    echo -e "\ncode-server is already running.\n\nConnect using: http://localhost:8000\n"
fi