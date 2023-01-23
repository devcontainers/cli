#!/bin/sh
set -e

echo "Activating feature 'rabbit'"

cat > /usr/local/bin/rabbit \
<< EOF
#!/bin/sh
echo "i-am-a-rabbit"
EOF

chmod +x /usr/local/bin/rabbit