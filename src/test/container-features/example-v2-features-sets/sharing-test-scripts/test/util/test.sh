#!/bin/bash

set -e

# Optional: Import test library
source dev-container-features-test-lib

# Definition specific tests
check "run a different script" ./a_different_script.sh

# Report result
reportResults