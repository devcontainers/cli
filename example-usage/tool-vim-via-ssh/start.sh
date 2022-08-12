#!/bin/sh
set -e
cd "$(dirname $0)"

remove_flag=""
if [ "$1" = "true" ]; then
    remove_flag="--remove-existing-container"
fi

# Generate certificate
cd server
rm -f temp-ssh-key*
ssh-keygen -q -N '' -t rsa -f temp-ssh-key
cd ..

# Start container
devcontainer up $remove_flag --mount "type=bind,source=$(pwd)/server,target=/server" --workspace-folder ../workspace

# Install vim (if needed) and add pub key to SSH allow list
devcontainer exec --workspace-folder ../workspace /server/init-vim.sh

# Connect
ssh -t -i server/temp-ssh-key -o NoHostAuthenticationForLocalhost=yes -o UserKnownHostsFile=/dev/null -o GlobalKnownHostsFile=/dev/null -p 2222 vscode@localhost exec bash -c vim