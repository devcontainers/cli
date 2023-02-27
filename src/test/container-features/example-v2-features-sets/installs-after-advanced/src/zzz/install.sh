#!/usr/bin/env bash

set -e

# Check if npm and node are installed.
if ! command -v npm &> /dev/null
then
    echo "npm could not be found! I need npm!"
    exit 1
fi
if ! command -v node &> /dev/null
then
    echo "node could not be found! I need node!"
    exit 1
fi

cat > /usr/local/bin/zzz \
<< EOF
#!/bin/sh
echo "ZzzZzzZzz"
EOF

chmod +x /usr/local/bin/zzz