#!/bin/bash

set -e

# Optional: Import test library
source dev-container-features-test-lib

# Definition specific tests
check "runHelloCmd" hello

check "ensure i am user vscode"  bash -c "whoami | grep 'vscode'"

# Report result
reportResults