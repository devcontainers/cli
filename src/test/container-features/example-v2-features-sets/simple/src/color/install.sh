#!/bin/sh
set -e

echo "Activating feature 'color'"
echo "The provided favorite color is: ${FAVORITE}"

cat > /usr/local/bin/color \
<< EOF
#!/bin/sh
echo "my favorite color is ${FAVORITE}"
EOF

chmod +x /usr/local/bin/color

cp /usr/local/bin/color /usr/local/bin/color-${FAVORITE}
chmod +x /usr/local/bin/color-${FAVORITE}