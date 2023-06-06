#!/bin/bash

MARKER_FILE_NAME="$1"
echo "Hello from the .devcontainer helper_script.sh invoked by ${MARKER_FILE_NAME}"
touch "helperScript.devContainer.${MARKER_FILE_NAME}.testMarker"