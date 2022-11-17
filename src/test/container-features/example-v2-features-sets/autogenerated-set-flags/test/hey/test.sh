#!/bin/bash

set -e

# Optional: Import test library
source dev-container-features-test-lib

# Definition specific tests
check "runHelloCmd" hello

# Passed in by --remote-user flag, that overrides the base image's user of 'vscode'
# The 'simple' feature set tests the opposite.
check "ensure i am user root"  bash -c "whoami | grep 'root'"

# Report result
reportResults