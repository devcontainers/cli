#!/bin/sh
set -e

echo "Activating feature 'hello'"

cat > /usr/local/bin/hello \
<< EOF
echo "$(cat message.txt)"
EOF

chmod +x /usr/local/bin/hello
