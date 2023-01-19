#!/bin/sh
set -e

echo "Activating feature 'panda'"

cat > /usr/local/bin/panda \
<< EOF
#!/bin/sh
echo 🐼
EOF

chmod +x /usr/local/bin/panda