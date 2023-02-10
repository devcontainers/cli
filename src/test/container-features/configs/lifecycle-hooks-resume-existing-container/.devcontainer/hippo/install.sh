#!/bin/sh
set -e

echo "Activating feature 'hippo'"

cat > /usr/local/bin/hippo \
<< EOF
#!/bin/sh
echo 🦛
EOF

chmod +x /usr/local/bin/hippo