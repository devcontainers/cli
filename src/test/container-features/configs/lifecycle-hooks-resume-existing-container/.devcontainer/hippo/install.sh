#!/bin/sh
set -e

echo "Activating feature 'hippo'"

cat > /usr/local/bin/hippo \
<< EOF
#!/bin/sh
echo 🦛
EOF

# Copy helper script into somewhere that will persist
mkdir -p /usr/features/hippo
cp ./createMarker.sh /usr/features/hippo
chmod -R 0755 /usr/features/hippo

chmod +x /usr/local/bin/hippo