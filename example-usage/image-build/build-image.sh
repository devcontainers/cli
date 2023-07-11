#!/bin/sh
set -e
cd "$(dirname $0)"

image_name="${1:-"devcontainer-cli-test-image"}"

# Push will upload the image to a registry when done (if logged in via docker CLI)
push_flag="${2:-false}"

# If more than one platform is specified, then push must be set.
platforms="${3:-linux/amd64}"

devcontainer build --image-name $image_name --platform "$platforms" --push $push_flag --workspace-folder ../workspace

echo "\nImage ${image_name} built successfully!"
