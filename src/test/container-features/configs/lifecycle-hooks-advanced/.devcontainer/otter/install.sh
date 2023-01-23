#!/bin/sh
set -e

echo "Activating feature 'otter'"

cat > /usr/local/bin/otter \
<< EOF
#!/bin/sh
echo "i-am-an-otter"
EOF

chmod +x /usr/local/bin/otter