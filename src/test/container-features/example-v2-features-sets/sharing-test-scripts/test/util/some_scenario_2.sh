#!/bin/bash

set -e

# Optional: Import test library
source dev-container-features-test-lib

# Definition specific tests
check "run a helper script for from some_scenario_2" ./a_helper_script_for_scenario.sh

# Report result
reportResults