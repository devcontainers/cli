#!/bin/bash

MARKER_FILE_NAME="$1"

echo "Starting '${MARKER_FILE_NAME}'...."
sleep 1s

[[ -f saved_value.testMarker ]] || echo 0 > saved_value.testMarker
n=$(< saved_value.testMarker)
echo "${n}.`date +%s%3N`" > "${n}.${MARKER_FILE_NAME}"
echo $(( n + 1 )) > saved_value.testMarker

echo "Ending '${MARKER_FILE_NAME}'...."