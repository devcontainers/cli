#!/bin/sh

NAME="C"

echo "Installing ${NAME}"
MAGIC_NUMBER=${MAGICNUMBER}
echo "The magic number is ${MAGIC_NUMBER}"
touch /usr/local/magic-number-${NAME}-${MAGIC_NUMBER}-$(date +%s).testMarker
echo "Done installing ${NAME}"
