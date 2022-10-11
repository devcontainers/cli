#!/bin/bash

set -e

# Optional: Import test library
source dev-container-features-test-lib

# Definition specific tests
check "correct color" color | grep "Silver"
check "correct greeting" hello | grep "How ya doing"

# Report result
reportResults