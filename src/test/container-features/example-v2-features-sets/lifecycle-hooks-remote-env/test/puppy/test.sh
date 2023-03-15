#!/bin/bash

set -e

# Optional: Import test library
source dev-container-features-test-lib

# Check that '/tmp/secret-from-feature.txt' exists
check "'/tmp/secret-from-feature.txt' exists" test -f /tmp/secret-from-feature.txt
check "'/tmp/secret-from-feature.txt' contains 'you-found-my-secret-string'" grep -q you-found-my-secret-string /tmp/secret-from-feature.txt

# Report result
reportResults