#!/bin/sh

NAME="F"

echo "Installing ${NAME}"
MAGIC_NUMBER=${MAGICNUMBER}
echo "The magic number is ${MAGIC_NUMBER}"
touch ${_REMOTE_USER_HOME}/magic-number-${NAME}-${MAGIC_NUMBER}-$(date +%s)
echo "Done installing ${NAME}"
