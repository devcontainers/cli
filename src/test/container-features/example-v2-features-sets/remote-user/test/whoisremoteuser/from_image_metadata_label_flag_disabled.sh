#!/bin/bash

set -e

# Optional: Import test library
source dev-container-features-test-lib

check "ensure i am user root"  bash -c "whoami | grep 'root'"

check "_REMOTE_USER was equal to root" bash -c "whoisremoteuser | grep 'root'"

# Report result
reportResults