#!/bin/sh
set -e
if ! type vim > /dev/null 2>&1; then
    echo "Installing vim..."
    sudo apt-get update
    sudo apt-get install -y vim
fi

# Copy generated keys
mkdir -p $HOME/.ssh
cat /server/temp-ssh-key.pub > $HOME/.ssh/authorized_keys
chmod 644 $HOME/.ssh/authorized_keys
chmod 700 $HOME/.ssh
