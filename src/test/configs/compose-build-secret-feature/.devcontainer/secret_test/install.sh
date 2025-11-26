#!/bin/bash
set -e
if [ -f /run/secrets/compose_file ]; then
	echo "Contents of secret file:"
	cat /run/secrets/compose_file
	echo "Writing secret file contents to /secret_file.txt"
	cat /run/secrets/compose_file > /secret_file.txt
else
	echo "Secret file not found!"
	exit 1
fi
