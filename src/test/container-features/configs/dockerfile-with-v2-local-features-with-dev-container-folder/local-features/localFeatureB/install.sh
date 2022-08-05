#!/bin/bash

echo "Activating feature 'localFeatureB'"

echo "The provided favorite color is: $FAVORITE"

tee /usr/color.sh > /dev/null \
<< EOF
#!/bin/bash
NC='\033[0m' # No Color
echo -e -n "my favorite color is ${FAVORITE}"
EOF

chmod +x /usr/color.sh
sudo cat '/usr/color.sh' > /usr/local/bin/color
sudo chmod +x /usr/local/bin/color