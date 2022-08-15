#!/bin/bash

set -e

# Optional: Import test library
source dev-container-features-test-lib

# Definition specific tests
check "correct color" color | grep "Magenta"
check "correct greeting" hello | grep "Ciao"

# Report result
reportResults