#!/bin/bash

echo "Activating feature 'featureB'"

echo "The provided favorite color is: $FAVORITE"

if [ "${FAVORITE}" == "red" ]; then
    FAVORITE='\\033[0\;91m'
fi

if [ "${FAVORITE}" == "green" ]; then
    FAVORITE='\\033[0\;32m'
fi

if [ "${FAVORITE}" == "gold" ]; then
    FAVORITE='\\033[0\;33m'
fi

tee /usr/color.sh > /dev/null \
<< EOF
#!/bin/bash
NC='\033[0m' # No Color
FAVORITE=${FAVORITE}
echo -e -n "\my favorite color is ${FAVORITE}\${NC}"
EOF

chmod +x /usr/color.sh
sudo cat '/usr/color.sh' > /usr/local/bin/color
sudo chmod +x /usr/local/bin/color