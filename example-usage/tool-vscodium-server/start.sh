#!/bin/sh
set -xe

cd "$(dirname $0)"
pwd

remove_flag=""
if [ "$1" = "true" ]; then
    remove_flag="--remove-existing-container"
fi

chmod +x server/init-vscodium-server.sh

npm install -g @devcontainers/cli


# Resolves any variables like ${containerWorkspaceFolder}
# Processes any referenced configurations
# Expands environment variables
# etc.
# Save off effective config for use in the container
devcontainer read-configuration --include-merged-configuration --log-format json --workspace-folder ../workspace > server/configuration.json

# Mount server script and start container. The .devcontainer/ folder is under ../workspace.  We need to be there.
# devcontainer up $remove_flag --mount "type=bind,source=$(pwd)/server,target=/server" \
#     --workspace-mount type=bind,source=/workspaces/devcontainers-cli-fork/example-usage/workspace,target=/workspace \
#     --workspace-folder ../workspace

devcontainer up $remove_flag --mount "type=bind,source=$(pwd)/server,target=/server" \
    --mount type=bind,source=$(realpath ../workspace),target=/workspace \
    --workspace-folder ../workspace


# Initialize VSCodium server (wont return until server is stopped)
devcontainer exec --workspace-folder ../workspace /server/init-vscodium-server.sh