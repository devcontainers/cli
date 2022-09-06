#!/bin/sh
set -e
cd "$(dirname $0)/.."

mkdir -p dist
echo "\nStarting build..."
GOARCH="amd64" GOOS="linux" go build -o ./dist/hello-world-linux ./main.go
GOARCH="amd64" GOOS="darwin" go build -o ./dist/hello-world-darwin ./main.go
GOARCH="amd64" GOOS="windows" go build -o ./dist/hello-world-windows.exe ./main.go

echo "\nApplication build complete! Check out the result in the workspace/dist folder."