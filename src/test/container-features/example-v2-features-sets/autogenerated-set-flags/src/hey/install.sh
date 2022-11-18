#!/bin/sh
set -e

echo "Activating feature 'localFeatureA'"

GREETING=${GREETING:-undefined}
echo "The provided greeting is: $GREETING"

cat > /usr/local/bin/hello \
<< EOF
#!/bin/sh
RED='\033[0;91m'
NC='\033[0m' # No Color
echo "\${RED}${GREETING}, \$(whoami)\${NC}"
EOF

chmod +x /usr/local/bin/hello