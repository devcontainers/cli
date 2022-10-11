#!/bin/sh
set -e

echo "Activating feature 'b'"

touch /usr/local/bin/b

# InstallsAfter Feature A
if [ ! -f /usr/local/bin/a ]; then
	echo "Feature A not available!"
	exit 1
fi