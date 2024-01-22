#!/bin/bash

set -e

env

# Optional: Import test library
source dev-container-features-test-lib

# The values of the randomized options will be set as environment variables.
if [ -z "${FAVORITE}" ]; then
	echo "Favorite color from randomized Feature not set!"
	exit 1
fi

# The values of the default options will be set as environment variables.
if [ -z "${FAVORITE__DEFAULT}" ]; then
	echo "Favorite color from default Feature not set!"
	exit 1
fi

# Definition specific tests
check "runColorCmd" color

# Definition test specific to what option was set.
check "Feature with randomized options installed correctly" color-"${FAVORITE}"

# Definition test specific to what option was set.
check "Feature with default options installed correctly" color-"${FAVORITE__DEFAULT}"

# Report result
reportResults