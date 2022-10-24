#!/bin/sh
set -e
cd "$(dirname $0)"

remove_flag=""
if [ "$1" = "true" ]; then
    remove_flag="--remove-existing-container"
fi

# Save off effective config for use in the container
devcontainer read-configuration --include-merged-configuration --log-format json --workspace-folder ../workspace 2>/dev/null > server/configuration.json

devcontainer up $remove_flag --mount "type=bind,source=$(pwd)/server,target=/server"  --workspace-folder ../workspace
devcontainer exec --workspace-folder ../workspace /server/init-openvscode-server.sh
