#!/bin/bash
set -e
cd "$(dirname $0)"

if [ ! -e "$HOME/.openvscodeserver" ]; then
    echo "Downloading openvscode-server..."
    curl -fsSL https://github.com/gitpod-io/openvscode-server/releases/download/openvscode-server-v1.69.2/openvscode-server-v1.69.2-linux-x64.tar.gz -o /tmp/openvscode-server.tar.gz
    mkdir -p "$HOME/.openvscodeserver"
    echo "Extracting..."
    tar --strip 1 -xzf /tmp/openvscode-server.tar.gz -C "$HOME/.openvscodeserver/"
    rm -f /tmp/openvscode-server.tar.gz
fi

if [ "$(ps -ef | grep '\.openvscode-server' | wc -l)" = "1" ]; then
    if ! type jq > /dev/null 2>&1; then
        sudo apt-get -y install jq
    fi
    tmp_dir="$(mktemp -d)"
    mkdir -p "${tmp_dir}" "$HOME"/.openvscode-server/data/Machine

    # Logic could be simplified with https://github.com/devcontainers/cli/issues/113
    # Install extensions
    jq -M '.configuration.customizations?."openvscodeserver"?.extensions?' /server/configuration.json > "${tmp_dir}"/extensions1.json
    jq -M '.featuresConfiguration?.featureSets[]?.features[]?.customizations?.vscode?.extensions?' /server/configuration.json  > "${tmp_dir}"/extensions2.json
    extensions=( $(jq -s -M '.[0] + .[1]' "${tmp_dir}"/extensions1.json "${tmp_dir}"/extensions2.json | jq -r -M '.[]') )
    if [ "${extensions[0]}" != "null" ]; then 
        set +e
        for extension in "${extensions[@]}"; do
            "$HOME"/.openvscodeserver/bin/openvscode-server --install-extension ${extension}
        done
        set -e
    fi

    # Add machine settings.json
    jq -M '.configuration.customizations?."openvscodeserver"?.settings?' /server/configuration.json > "${tmp_dir}"/settings1.json
    jq -M '.featuresConfiguration?.featureSets[]?.features[]?.customizations?.vscode?.settings?' /server/configuration.json > "${tmp_dir}"/settings2.json
    settings="$(jq -s -M '.[0] + .[1]' "${tmp_dir}"/settings1.json "${tmp_dir}"/settings2.json)"
    if [ "${settings}" != "null" ]; then
        echo "${settings}" >  "$HOME"/.openvscode-server/data/Machine/settings.json
    fi
    
    rm -rf "${tmp_dir}" /server/configuration.json

    "$HOME"/.openvscodeserver/bin/openvscode-server serve-local --without-connection-token --host 0.0.0.0 --port 8000
else
    echo -e "\ncode-server is already running.\n\nConnect using: http://localhost:8000\n"
fi