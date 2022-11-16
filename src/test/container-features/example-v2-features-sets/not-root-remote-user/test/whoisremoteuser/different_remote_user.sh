#!/bin/bash

set -e

# Optional: Import test library
source dev-container-features-test-lib

# Definition specific tests
check "ensure i am user codespace"  bash -c "whoami | grep 'codespace'"

check "_REMOTE_USER was equal to codespace" bash -c "whoisremoteuser | grep 'codespace'"


# Report result
reportResults