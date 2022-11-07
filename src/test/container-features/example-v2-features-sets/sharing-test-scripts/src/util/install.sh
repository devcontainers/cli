#!/bin/sh
set -e

echo "Activating feature 'util'"

cat > /usr/local/bin/util \
<< EOF
#!/bin/sh
echo "you did it"
EOF

chmod +x /usr/local/bin/util