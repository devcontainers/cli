#!/bin/sh
set -e
if [ ! -e "$HOME/.openvscodeserver" ]; then
    echo "Downloading openvscode-server..."
    curl -fsSL https://github.com/gitpod-io/openvscode-server/releases/download/openvscode-server-v1.69.2/openvscode-server-v1.69.2-linux-x64.tar.gz -o /tmp/openvscode-server.tar.gz
    mkdir -p $HOME/.openvscodeserver
    echo "Extracting..."
    tar --strip 1 -xzf /tmp/openvscode-server.tar.gz -C $HOME/.openvscodeserver/
    rm -f /tmp/openvscode-server.tar.gz
fi
if [ "$(ps -ef | grep '\.openvscode-server' | wc -l)" = "1" ]; then
    $HOME/.openvscodeserver/bin/openvscode-server serve-local --without-connection-token --host 0.0.0.0 --port 8000
else
    echo "\ncode-server is already running.\n\nConnect using: http://localhost:8000\n"
fi