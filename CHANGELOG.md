# Change Log

Notable changes.

## October 2022

### [0.19.0]

- Inspect image in registry to avoid pulling it. (https://github.com/microsoft/vscode-remote-release/issues/7273)

### [0.18.0]

- Introduces `templates publish` command. (https://github.com/devcontainers/cli/pull/198)
- Adds `--additional-features` option. (https://github.com/devcontainers/cli/pull/171)
- Adds `--output` option to the `devcontainer build` command. (https://github.com/devcontainers/cli/pull/166)

## September 2022

### [0.17.0]

- Use qualified id for features. (https://github.com/microsoft/vscode-remote-release/issues/7253)
- Avoid changing metadata order. (https://github.com/microsoft/vscode-remote-release/issues/7254)
- Include version in all override files. (https://github.com/microsoft/vscode-remote-release/issues/7244)

### [0.16.0]

- Image metadata. (https://github.com/devcontainers/cli/issues/188)

### [0.15.0]

- Fix typo in 'installsAfter'. (https://github.com/devcontainers/cli/issues/163)
- Add --skip-post-attach. (https://github.com/devcontainers/cli/pull/174)
- Improve feature installation logs. (https://github.com/devcontainers/cli/pull/178)

## August 2022

### [0.14.2]

- Properly source feature options. (https://github.com/devcontainers/cli/issues/148)

### [0.14.1]

- Replace containerEnv in entire config and in read-configuration command. (https://github.com/microsoft/vscode-remote-release/issues/7121)

### [0.14.0]

- Update to vscode-dev-containers 0.245.2.

### [0.13.0]

- Updates to `devcontainer features test` command
	- Can now specify a `scenarios.json` per-feature
- Introduces `devcontainer features info` command

### [0.12.1]

- Pick up v0.10.2 related to container ENV output.

### [0.12.0]

- Native implementation for pushing a dev container feature to an OCI registry
- `features publish` command

### [0.11.0]

- WIP on features v2:
	- Auto map old feature ids to OCI features. (https://github.com/devcontainers/cli/pull/100)

### [0.10.2]

- Fix malformed container ENV output for 'v1' features (https://github.com/devcontainers/cli/issues/131) 

### [0.10.1]

- Fixes regression where some dev container feature properties were not being applied properly (https://github.com/devcontainers/cli/pull/126)
- Fixes undesired behavior with dev container features and multi-stage builds (https://github.com/devcontainers/cli/issues/120)

### [0.10.0]

- Implement optional default values in localEnv/containerEnv expansions. (https://github.com/devcontainers/cli/issues/50)
- Log version and install location at the end of `--help`. (https://github.com/devcontainers/cli/issues/114)
- WIP on features v2:
	- Update `direct-tarball` to follow spec. (https://github.com/devcontainers/cli/pull/105)
	- Add `features package` command. (https://github.com/devcontainers/cli/pull/93)
	- Fix cwd for building with local features. (https://github.com/devcontainers/cli/issues/116)

### [0.9.0]

- WIP on features v2:
	- Contributable features in OCI registries.

## July 2022

### [0.8.0]

- Build command: Support multiple --image-name parameters  (#61)
- WIP on features v2:
	- Contributable features.
	- `features test` command.

## June 2022

### [0.7.0]

- Multi-platform build support. (https://github.com/devcontainers/cli/pull/24)
- User-scoped tmp folder on Linux. (https://github.com/microsoft/vscode-remote-release/issues/2347)

## May 2022

### [0.6.0]

- Handle undefined context. (https://github.com/microsoft/vscode-remote-release/issues/6815)
- Avoid comment after ARG for Podman. (https://github.com/microsoft/vscode-remote-release/issues/6819)
- Update to vscode-dev-containers 0.238.1.

### [0.5.0]

- Update to vscode-dev-containers 0.238.0.

### [0.4.0]

- Merge user and features Dockerfile to simplify cache and multi-platform handling.
- Use PTY for `--log-format-json`.

### [0.3.0]

- BuildKit version check for `--build-context`.

### [0.2.0]

- Use single Dockerfile to build image for single container using BuildKit.

### [0.1.0]

- Initial version.
