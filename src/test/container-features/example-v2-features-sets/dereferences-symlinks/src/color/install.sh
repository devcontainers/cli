#!/bin/sh
set -e

echo "Activating feature 'color'"

cat > /usr/local/bin/color \
<< EOF
echo "$(cat color.txt)"
EOF

chmod +x /usr/local/bin/color
