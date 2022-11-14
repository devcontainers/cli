#!/bin/sh
set -e

echo "Activating feature 'smile'"


action=":)"

if "$SHOULDFROWN" = "true"; then
	action=":("
fi

cat > /usr/local/bin/smile \
<< EOF
#!/bin/sh
echo "${action}"
EOF

chmod +x /usr/local/bin/smile