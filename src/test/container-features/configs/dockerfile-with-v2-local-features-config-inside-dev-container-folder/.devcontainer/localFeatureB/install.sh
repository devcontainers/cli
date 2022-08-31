#!/bin/sh
set -e

echo "Activating feature 'localFeatureB'"
echo "The provided favorite color is: ${FAVORITE}"

cat > /usr/local/bin/color \
<< EOF
#!/bin/sh
echo "my favorite color is ${FAVORITE}"
EOF

chmod +x /usr/local/bin/color