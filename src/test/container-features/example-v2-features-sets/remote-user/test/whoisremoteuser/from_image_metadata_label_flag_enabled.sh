#!/bin/bash

set -e

# Optional: Import test library
source dev-container-features-test-lib

check "ensure i am user node"  bash -c "whoami | grep 'node'"

check "_REMOTE_USER was equal to node" bash -c "whoisremoteuser | grep 'node'"

# Report result
reportResults