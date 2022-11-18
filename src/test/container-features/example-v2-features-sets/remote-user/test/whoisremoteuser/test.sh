#!/bin/bash

set -e

# Optional: Import test library
source dev-container-features-test-lib

# Definition specific tests
check "ensure i am root" bash -c "whoami | grep 'root'"

check "_REMOTE_USER was equal to root" bash -c "whoisremoteuser | grep 'root'"

# Report result
reportResults