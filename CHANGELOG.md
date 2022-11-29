# Change Log

Notable changes.

## November 2022

### [0.25.2]

- Fix Feature/Template publishing issue when a capital letter is in the repo name (https://github.com/devcontainers/cli/pull/303)

### [0.25.1]
- Fix regression in https://github.com/devcontainers/cli/pull/298

### [0.25.0]

- `features test`: Respect image label metadata. (https://github.com/devcontainers/cli/pull/288)
- Surface first error (https://github.com/microsoft/vscode-remote-release/issues/7382)
- `templates publish`: Exit for "Failed to PUT manifest for tag x" error. (https://github.com/devcontainers/cli/pull/296)
- Respect devcontainer.json when using image without features. (https://github.com/devcontainers/cli/issues/299)
- Emit response from registry on failed `postUploadSessionId` (https://github.com/devcontainers/cli/pull/298)
- downcase OCI identifiers and validate input of getRef() (https://github.com/devcontainers/cli/pull/293)

### [0.24.1]

- `features test`: Respects testing scenarios where 'remoteUser' is non-root (https://github.com/devcontainers/cli/pull/286)

### [0.24.0]

- Handle quoted base image (https://github.com/microsoft/vscode-remote-release/issues/7323)
- Use plain text when not in terminal (https://github.com/devcontainers/cli/issues/253)
- `features test` documentation (https://github.com/devcontainers/cli/pull/219)
- `features test`: Copy entire test folder on test execution and improve CLI command usage. (https://github.com/devcontainers/cli/pull/265)
- Avoid image build (https://github.com/microsoft/vscode-remote-release/issues/7378)
- Preserve syntax directive (https://github.com/microsoft/vscode-remote-release/issues/7463)
- GPU requirement and auto-detect NVIDIA extensions (https://github.com/devcontainers/cli/pull/173)
- `features test`: Pattern to provide additional files in scenario test. (https://github.com/devcontainers/cli/pull/273)
- Handle Cygwin / Git Bash sockets forwarding on Windows. (https://github.com/devcontainers/cli/issues/62)
- Handle ENV without `=`. (https://github.com/microsoft/vscode-remote-release/issues/7493)
- Bundle CLI for NPM package. (https://github.com/devcontainers/cli/issues/279)
- `features test`: Add --filter to allow for selectively running scenarios. (https://github.com/devcontainers/cli/pull/272)

## October 2022

### [0.23.2]

- Add flag to omit `customizations` from image metadata. (https://github.com/devcontainers/cli/pull/262)
- Normalize feature permissions. (https://github.com/devcontainers/cli/issues/153)
- Skip features code path without features. (https://github.com/devcontainers/cli/pull/258)

### [0.23.1]

- Pick up updated `remoteEnv`, `remoteUser` and `userEnvProbe` properties. (https://github.com/devcontainers/cli/issues/252)

### [0.23.0]

- Consider base image env when looking up USER. (https://github.com/microsoft/vscode-remote-release/issues/7358)
- Handle ENV when looking up USER. (https://github.com/microsoft/vscode-remote-release/issues/7303)
- Last mount source wins. (https://github.com/microsoft/vscode-remote-release/issues/7368)
- Add missing substitutions in run-user-commands. (https://github.com/microsoft/vscode-remote-release/issues/7412)
- Last updateRemoteUserUID value wins. (https://github.com/microsoft/vscode-remote-release/issues/7390)

### [0.22.0]

- Add `${devcontainerId}` configuration variable. (https://github.com/devcontainers/spec/issues/62)
- User environment variables for features. (https://github.com/devcontainers/spec/issues/91)

### [0.21.0]

- New Command: `templates apply` to apply fetch and apply a dev container Template to a project
- Initial support for running lifecycle scripts in parallel
- Improvements to the `features test` command
- Improvements related to packaging dev container Features and Templates

### [0.20.0]

- Handle old and otherwise started containers (https://github.com/microsoft/vscode-remote-release/issues/7307)
- Configure proxy-agent (https://github.com/microsoft/vscode-remote-release/issues/6995)

### [0.19.1]

- Only set target when previously set. (https://github.com/microsoft/vscode-remote-release/issues/7301)
- Check for existing syntax directive. (https://github.com/microsoft/vscode-remote-release/issues/6848)
- Templates & Features Packaging - Throw warning of a missing JSON file and continue. (https://github.com/devcontainers/cli/pull/206)

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
