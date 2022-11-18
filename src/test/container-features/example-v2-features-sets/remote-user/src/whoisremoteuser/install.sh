#!/bin/sh
set -e

echo "Activating feature 'whoisremoteuser'..."

cat > /usr/local/bin/whoisremoteuser \
<< EOF
#!/bin/sh
echo -n "$_REMOTE_USER"
EOF

chmod +x /usr/local/bin/whoisremoteuser