#!/bin/sh
set -e
cd "$(dirname $0)"

remove_flag=""
if [ "$1" = "true" ]; then
    remove_flag="--remove-existing-container"
fi

devcontainer up $remove_flag --mount "type=bind,source=$(pwd)/server,target=/server"  --workspace-folder ../workspace
devcontainer exec --workspace-folder ../workspace /server/init-openvscode-server.sh
