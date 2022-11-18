# Dev Container CLI Examples

This folder contains a set of basic examples that use the devcontainer CLI for different use cases. It includes example scripts to:

1. [Use three different tools from a development container](#tool-examples)
2. [Use a dev container as your CI build environment](#ci-build-environment-example) (even if your app is not deployed as a container)
3. [Build a container image](#building-an-image-from-devcontainerjson) from a devcontainer.json file that includes [dev container features](https://containers.dev/implementors/features/#devcontainer-json-properties)

Each should run on macOS or Linux. For Windows, you can use these scripts from WSL2.

## Pre-requisites

1. Install Node.js 16 (e.g., using [nvm](https://github.com/nvm-sh/nvm))
2. Install [node-gyp pre-requisites](https://github.com/nodejs/node-gyp):
   - **Linux/WSL2:** Use your distro's package manager. E.g. on Ubuntu/Debian: `sudo apt-get update && sudo apt-get install python3-minimal gcc g++ make`
   - **macOS:** Install the XCode Command Line Tools ([more info](https://github.com/nodejs/node-gyp/blob/main/README.md#on-macos))
3. Make sure you have an OpenSSH compliant `ssh` command available and in your path if you plan to use the `Vim via SSH` example (it should already be there on macOS, and in Linux/WSL, you can install `openssh-client` using your distro's package manager if its missing)
3. Install the latest dev container CLI: `npm install -g @devcontainers/cli`

## Using the examples

All examples use the contents of the `workspace` folder for their configuration, which is where you can make modifications if you'd like. The example scripts are then in different sub-folders. 

### Tool examples

You can use these examples by opening a terminal and typing one of the following:

- `tool-vscode-server/start.sh` - [VS Code Server](https://code.visualstudio.com/docs/remote/vscode-server) (official)
- `tool-openvscode-server/start.sh` - [openvscode-server](https://github.com/gitpod-io/openvscode-server)
- `tool-vim-via-ssh/start.sh` - Vim via an SSH connection. SSH is used primarily to demonstrate how this could be achieved from other SSH supporting client tools.

When switching between examples, pass `true` in as an argument to get the container recreated to avoid port conflicts. e.g., `./start.sh true`

In the first two examples, you'll be instructed to go to `http://localhost:8000` in a browser.

This also adds a desktop to the container that can be accessed from a web browser at `http://localhost:6080` and you can connect using the password `vscode`.

#### How the tool examples work

These examples demonstrate the use of the dev container CLI to:

1. Simplify setup using the "[dev container features](https://containers.dev/implementors/features/#devcontainer-json-properties)" concept. For example, SSH support is added just using a feature reference. See `workspace/.devcontainer/devcontainer.json` for more information.

2. How the dev container CLI can be used to inject tools without building them into the base image:

    1. Use `devcontainer up` to spin up the container and mount a `server` and `workspace` folder into the container.
    2. Use `devcontainer exec` to run a script from this mounted folder to set up the appropriate server (and apply tool specific settings/customizations).
    3. In the `vim` example, a temporary SSH key is set up and configured, and then SSH is used from the command line to connect to the container once it is up and running. See `tool-vim-via-ssh/start.sh` for details.

Currently the `appPort` property is used in `devcontainer.json` instead of `forwardPorts` due to a gap in the current dev container CLI ([see here](https://github.com/devcontainers/cli/issues/22)).

### CI build environment example

This example illustrates how you can use the dev container CLI to build your application in any CI system. (Note there is also a [GitHub Action](https://github.com/marketplace/actions/devcontainers-ci) and [Azure DevOps task](https://marketplace.visualstudio.com/items?itemName=devcontainers.ci) if you are using those automation systems, but this example will focus on direct use of the CLI.)

You can use the example by opening a terminal and typing the following:

```
ci-app-build-script/build-app.sh
```

After the build completes, you can find the built application in the `workspace/dist` folder.

The initial build can take a bit since it is building the dev container image, which is an example of where [pre-building an image](#building-an-image-from-devcontainerjson) helps.

#### How the CI example works

This example demonstrates the use of the dev container CLI to:

1. Simplify setup using the "[dev container features](https://containers.dev/implementors/features/#devcontainer-json-properties)" concept. For example, SSH support is added just using a feature reference. See `workspace/.devcontainer/devcontainer.json` for more information.

2. Execute an application build script inside a dev container as follows:

    1. Use `devcontainer up` to spin up the container and mount the the `workspace` folder into the container.
    2. Use `devcontainer exec` to run a build script from the mounted folder inside the development container.
    3. Delete the container when the build is finished.

All environment variables are automatically available from `exec`, including those that are are set in the non-root user's `.bashrc` file. The dev container CLI also automatically adjusts to UID/GID differences for the user inside the container on Linux to ensure the workspace folder is writable.

### Building an image from devcontainer.json

You can use the example by opening a terminal and typing the following:

```
image-build/build-image.sh
```

The resulting image name defaults to `devcontainer-cli-test-image`,  but you can change it with the first argument, and configure it to push to a registry by setting the second argument to true. The third argument allows you to build for multiple architectures.

```
image-build/build-image.sh ghcr.io/my-org/my-image-name-here true "linux/amd64 linux/arm64"
```

Ultimately, this script just calls the `devcontainer build` command to do all the work. Once built, you can refer to the specified image name directly in a devcontainer.json file using the `image` property.
