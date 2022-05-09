# Dev Container CLI

This repository holds the dev container CLI, which can take a devcontainer.json and create and configure a dev container from it.

## Context

A development container allows you to use a container as a full-featured development environment. It can be used to run an application, to separate tools, libraries, or runtimes needed for working with a codebase, and to aid in continuous integration and testing. Dev containers can be run locally or remotely, in a private or public cloud.

![Diagram of inner and outerloop development with dev containers](/images/dev-container-stages.png)

This CLI is in active development. Current status:

- [x] `dev-containers-cli build` - Enables building/pre-building images
- [x] `dev-containers-cli up` - Spins up containers with `devcontainer.json` settings applied
- [x] `dev-containers-cli run-user-commands` - Runs lifecycle commands like `postCreateCommand`
- [x] `dev-containers-cli read-configuration` - Outputs current configuration for workspace
- [x] `dev-containers-cli exec` - Executes a command in a container with `userEnvProbe`, `remoteUser`, `remoteEnv`, and other properties applied
- [ ] `dev-containers-cli stop` - Stops containers
- [ ] `dev-containers-cli down` - Stops and deletes containers

## Try it out
You can try out the CLI in just a few steps. This repository has a [dev container configuration](https://github.com/devcontainers/cli/tree/main/.devcontainer), which you can use to ensure you have the right dependencies installed.

Compile and get the help text:
```sh
yarn
yarn compile
node cli.js
```

You can try out the dev container CLI with a sample project, like this [Rust sample](https://github.com/microsoft/vscode-remote-try-rust). Clone the Rust sample to the repo's parent folder, start a dev container, and run some command:
```sh
( cd .. && git clone https://github.com/microsoft/vscode-remote-try-rust )
node cli.js up --workspace-folder ../vscode-remote-try-rust
node cli.js exec --workspace-folder ../vscode-remote-try-rust cargo run
```

## Specification

The dev container CLI is part of the [Development Containers Specification](https://github.com/devcontainers/spec). This spec seeks to find ways to enrich existing formats with common development specific settings, tools, and configuration while still providing a simplified, un-orchestrated single container option – so that they can be used as coding environments or for continuous integration and testing.

Learn more on the [dev container spec website](https://devcontainers.github.io/containers.dev/).

## Additional resources

You may review other resources part of the specification in the [`devcontainers` GitHub organization](https://github.com/devcontainers).

## Contributing

Check out how to contribute to the CLI in [CONTRIBUTING.md](contributing.md).

## License

This project is under an [MIT license](LICENSE.txt).
