#!/bin/sh
set -e

echo "Activating feature 'otter'"

cat > /usr/local/bin/otter \
<< EOF
#!/bin/sh
echo "i-am-an-otter"
EOF

# Copy helper script into somewhere that will persist
mkdir -p /usr/features/otter
chmod -R 0755 /usr/features/otter
cp ./helper_script.sh /usr/features/otter/helper_script.sh

chmod +x /usr/local/bin/otter