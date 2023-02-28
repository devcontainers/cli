#!/bin/sh
set -e

echo "Activating feature 'rabbit'"

cat > /usr/local/bin/rabbit \
<< EOF
#!/bin/sh
echo "i-am-a-rabbit"
EOF

# Copy helper script into somewhere that will persist
mkdir -p /usr/features/rabbit
chmod -R 0755 /usr/features/rabbit
cp ./helper_script.sh /usr/features/rabbit/helper_script.sh


chmod +x /usr/local/bin/rabbit