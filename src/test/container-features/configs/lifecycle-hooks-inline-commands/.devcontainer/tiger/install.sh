#!/bin/sh
set -e

echo "Activating feature 'tiger'"

cat > /usr/local/bin/tiger \
<< EOF
#!/bin/sh
echo 🐯
EOF

chmod +x /usr/local/bin/tiger