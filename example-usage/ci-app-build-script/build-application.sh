#!/bin/sh
set -e
cd "$(dirname $0)"

build_date="$(date +%s)"

# Create a label for use during cleanup since the devcontainer CLI does 
# not have a "remove" or "down" command yet (though this is planned).
id_label="ci-container=${build_date}"

# Run build
devcontainer up --id-label ${id_label} --workspace-folder ../workspace
set +e
devcontainer exec --id-label ${id_label} --workspace-folder ../workspace scripts/execute-app-build.sh
build_exit_code=$?
set -e

# Clean up. 
echo "\nCleaning up..."
docker rm -f $(docker ps -aq --filter label=${id_label})

exit ${build_exit_code}