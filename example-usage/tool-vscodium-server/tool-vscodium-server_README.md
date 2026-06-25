# VSCodium Remote Server Example

This example demonstrates how to use VSCodium's Remote Server with Dev Containers. It provides a fully open-source alternative to the VS Code Server.

## Usage

1. Start the container with VSCodium Remote Server:
   ```bash
   ./start.sh
   ```

2. Access VSCodium Remote Server in your browser:
   ```
   http://localhost:8000
   ```

If you want to recreate the container (e.g., when switching between different server examples), use:
```bash
./start.sh true
```

## Configuration

The server supports the following customization options in your `devcontainer.json`:

```jsonc
{
    "customizations": {
        "vscodium": {
            "settings": {
                // VSCodium/VS Code settings here
            },
            "extensions": [
                // Extension IDs here
            ]
        }
    }
}
```

Note: The server also respects VS Code settings under the `vscode` customization key for compatibility.

## Environment Variables

- `VSCODIUM_VERSION`: Set this to use a specific version of VSCodium Remote Server (defaults to latest stable)

## Features

- VSCodium Remote Server support
- Extension installation support
- Settings synchronization
- Compatible with many VS Code settings and extensions
- Open-source alternative to VS Code Server

- Serves client vscodium 
-  

## vscodium client settings 

Must install the "remote oss (xaberus)" extension installed. The extension ID is `xaberus.remote-oss`. See  https://github.com/xaberus/vscode-remote-oss/blob/main/README.md for general explanation.

- The vscodium version used for this test is `VSCODIUM_VERSION="1.96.4.25017"`.
- The client version and the remote server version number must be the same.
- To match the server settings in `/example-usage/tool-vscodium-server/` these client vscodium settings will suffice:

`~/.config/VSCodium/User/settings.json`
```json
{
    "remote.OSS.hosts": [
        {
            "type": "manual",
            "name": "vscodium-server",
            "host": "localhost",
            "port": 8000,
            "connectionToken": "false",
            "folders": [
                {
                    "name": "workspace",
                    "path": "/workspace"
                }
            ]
        }
    ],
}
```

`~/.vscode-oss/argv.json`
```json
{
    "enable-crash-reporter": false,
    "enable-proposed-api": [
        "xaberus.remote-oss"
    ]
}
```

## Test

After successfully conection from the client, the bottom left connection icon should say 
```
remoss-server
```

In a vscoddium terminal window, `cd /workspace`, then 
```
vscode ➜ /workspace $ go run main.go
Hello world!
```

