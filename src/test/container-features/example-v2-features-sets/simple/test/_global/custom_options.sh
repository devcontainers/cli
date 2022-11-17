#!/bin/bash

set -e

# Optional: Import test library
source dev-container-features-test-lib

# Definition specific tests
check "correct color" color | grep "Magenta"
check "correct greeting" hello | grep "Ciao"

check "ensure i am user vscode"  bash -c "whoami | grep 'vscode'"

# Report result
reportResults