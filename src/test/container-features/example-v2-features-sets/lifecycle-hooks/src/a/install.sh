#!/bin/sh
set -e

echo "Activating feature 'a'"

touch /usr/local/bin/a

# InstallsAfter Feature B

if [ ! -f /usr/local/bin/b ]; then
	echo "Feature B not available!"
	exit 1
fi