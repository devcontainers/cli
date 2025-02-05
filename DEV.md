# Dev Container CLI

This repository holds the dev container CLI, which can take a devcontainer.json and create and configure a dev container from it.

## Context

A development container allows you to use a container as a full-featured development environment. It can be used to run an application, to separate tools, libraries, or runtimes needed for working with a codebase, and to aid in continuous integration and testing. Dev containers can be run locally or remotely, in a private or public cloud.

![Diagram of inner and outerloop development with dev containers](/images/dev-container-stages.png)

This CLI is in active development. Current status:

- [x] `devcontainer build` - Enables building/pre-building images
- [x] `devcontainer up` - Spins up containers with `devcontainer.json` settings applied
- [x] `devcontainer run-user-commands` - Runs lifecycle commands like `postCreateCommand`
- [x] `devcontainer read-configuration` - Outputs current configuration for workspace
- [x] `devcontainer exec` - Executes a command in a container with `userEnvProbe`, `remoteUser`, `remoteEnv`, and other properties applied
- [x] `devcontainer features <...>` - Tools to assist in authoring and testing [Dev Container Features](https://containers.dev/implementors/features/)
- [x] `devcontainer templates <...>` - Tools to assist in authoring and testing [Dev Container Templates](https://containers.dev/implementors/templates/)
- [ ] `devcontainer stop` - Stops containers
- [ ] `devcontainer down` - Stops and deletes containers

## Try it out

We'd love for you to try out the dev container CLI and let us know what you think. You can quickly try it out in just a few simple steps, either by installing its npm package or building the CLI repo from sources (see "[Build from sources](#build-from-sources)").

To install the npm package you will need Python and C/C++ installed to build one of the dependencies (see, e.g., [here](https://github.com/microsoft/vscode/wiki/How-to-Contribute) for instructions).

### npm install

```bash
npm install -g @devcontainers/cli
```

Verify you can run the CLI and see its help text:

```bash
devcontainer <command>

Commands:
  devcontainer up                   Create and run dev container
  devcontainer build [path]         Build a dev container image
  devcontainer run-user-commands    Run user commands
  devcontainer read-configuration   Read configuration
  devcontainer features             Features commands
  devcontainer templates            Templates commands
  devcontainer exec <cmd> [args..]  Execute a command on a running dev container

Options:
  --help     Show help                                                 [boolean]
  --version  Show version number                                       [boolean]
```

### Try out the CLI

Once you have the CLI, you can try it out with a sample project, like this [Rust sample](https://github.com/microsoft/vscode-remote-try-rust).

Clone the Rust sample to your machine, and start a dev container with the CLI's `up` command:

```bash
git clone https://github.com/microsoft/vscode-remote-try-rust
devcontainer up --workspace-folder <path-to-vscode-remote-try-rust>
```

This will download the container image from a container registry and start the container. Your Rust container should now be running:

```bash
[88 ms] dev-containers-cli 0.1.0.
[165 ms] Start: Run: docker build -f /home/node/vscode-remote-try-rust/.devcontainer/Dockerfile -t vsc-vscode-remote-try-rust-89420ad7399ba74f55921e49cc3ecfd2 --build-arg VARIANT=bullseye /home/node/vscode-remote-try-rust/.devcontainer
[+] Building 0.5s (5/5) FINISHED
 => [internal] load build definition from Dockerfile                       0.0s
 => => transferring dockerfile: 38B                                        0.0s
 => [internal] load .dockerignore                                          0.0s
 => => transferring context: 2B                                            0.0s
 => [internal] load metadata for mcr.microsoft.com/vscode/devcontainers/r  0.4s
 => CACHED [1/1] FROM mcr.microsoft.com/vscode/devcontainers/rust:1-bulls  0.0s
 => exporting to image                                                     0.0s
 => => exporting layers                                                    0.0s
 => => writing image sha256:39873ccb81e6fb613975e11e37438eee1d49c963a436d  0.0s
 => => naming to docker.io/library/vsc-vscode-remote-try-rust-89420ad7399  0.0s
[1640 ms] Start: Run: docker run --sig-proxy=false -a STDOUT -a STDERR --mount type=bind,source=/home/node/vscode-remote-try-rust,target=/workspaces/vscode-remote-try-rust -l devcontainer.local_folder=/home/node/vscode-remote-try-rust --cap-add=SYS_PTRACE --security-opt seccomp=unconfined --entrypoint /bin/sh vsc-vscode-remote-try-rust-89420ad7399ba74f55921e49cc3ecfd2-uid -c echo Container started
Container started
{"outcome":"success","containerId":"f0a055ff056c1c1bb99cc09930efbf3a0437c54d9b4644695aa23c1d57b4bd11","remoteUser":"vscode","remoteWorkspaceFolder":"/workspaces/vscode-remote-try-rust"}
```

You can then run commands in this dev container:

```bash
devcontainer exec --workspace-folder <path-to-vscode-remote-try-rust> cargo run
```

This will compile and run the Rust sample, outputting:

```bash
[33 ms] dev-containers-cli 0.1.0.
   Compiling hello_remote_world v0.1.0 (/workspaces/vscode-remote-try-rust)
    Finished dev [unoptimized + debuginfo] target(s) in 1.06s
     Running `target/debug/hello_remote_world`
Hello, VS Code Remote - Containers!
{"outcome":"success"}
```

Congrats, you've just run the dev container CLI and seen it in action!

## More CLI examples

The [example-usage](./example-usage) folder contains some simple shell scripts to illustrate how the CLI can be used to:

- Inject tools for use inside a development container
- Use a dev container as your CI build environment to build an application (even if it is not deployed as a container)
- Build a container image from a devcontainer.json file that includes [dev container features](https://containers.dev/implementors/features/#devcontainer-json-properties)

## Build from sources

This repository has a [dev container configuration](https://github.com/devcontainers/cli/tree/main/.devcontainer), which you can use to ensure you have the right dependencies installed.

Compile the CLI with yarn:
```sh
yarn
yarn compile
```

Verify you can run the CLI and see its help text:
```sh
node devcontainer.js --help
```

## Specification

The dev container CLI is part of the [Development Containers Specification](https://github.com/devcontainers/spec). This spec seeks to find ways to enrich existing formats with common development specific settings, tools, and configuration while still providing a simplified, un-orchestrated single container option – so that they can be used as coding environments or for continuous integration and testing.

Learn more on the [dev container spec website](https://devcontainers.github.io/).

## Additional resources

You may review other resources part of the specification in the [`devcontainers` GitHub organization](https://github.com/devcontainers).

### Documentation

- Additional information on using the built-in [Features testing command](./docs/features/test.md).

## Contributing

Check out how to contribute to the CLI in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

This project is under an [MIT license](LICENSE.txt).
