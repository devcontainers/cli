#!/bin/sh
set -e

echo "Activating feature 'hello'"

GREETING=${GREETING:-undefined}
PUNCTUATION=${PUNCTUATION:-?????}
echo "The provided greeting is: $GREETING"
echo "The provided punctuation is: $PUNCTUATION"


cat > /usr/local/bin/hello \
<< EOF
#!/bin/sh
RED='\033[0;91m'
NC='\033[0m' # No Color
echo -e -n "\${RED}${GREETING}, \$(whoami)${PUNCTUATION}"
echo -e -n "\${NC}"
EOF

chmod +x /usr/local/bin/hello