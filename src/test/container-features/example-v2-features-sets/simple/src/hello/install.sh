#!/bin/bash

echo "Activating feature 'hello'"

GREETING=${GREETING:-undefined}
echo "The provided greeting is: $GREETING"

tee /usr/hello.sh > /dev/null \
<< EOF
#!/bin/bash
RED='\033[0;91m'
NC='\033[0m' # No Color
echo -e -n "\${RED}${GREETING}, \$(whoami)!"
echo -e -n "\${NC}"
EOF

chmod +x /usr/hello.sh
sudo cat '/usr/hello.sh' > /usr/local/bin/hello
sudo chmod +x /usr/local/bin/hello