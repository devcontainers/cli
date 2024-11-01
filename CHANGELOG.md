# Change Log

Notable changes.

## November 2024

### [0.72.0]
- Fix: change increment syntax in test library script (https://github.com/devcontainers/cli/pull/896)
- Increase timeout to 6 seconds (7 attempts) (https://github.com/microsoft/vscode-remote-release/issues/6509)
- Remove unnecessary log (https://github.com/devcontainers/cli/pull/925)

## September 2024

### [0.71.0]
- Exit with non-zero code on unexpected errors (https://github.com/microsoft/vscode-remote-release/issues/10217)
- Add option for GPU availability (https://github.com/microsoft/vscode-remote-release/issues/9385)

### [0.70.0]
- Add more leniency towards registries that malform WWW-Authenticate (https://github.com/devcontainers/cli/pull/884)
- Handle concurrent removal (https://github.com/microsoft/vscode-remote-release/issues/6509)

## August 2024

### [0.69.0]
- Enhance Template metadata (https://github.com/devcontainers/cli/pull/875)
    - Caches additional Template metadata (such as `files`) onto the manifest
	- Resolves full file paths for `optionalPaths` directories that only contain one file (for better usability in upstream tools)
	- Fixes bugs

### [0.68.0]
- Supporting changes for [Template `optionalPaths` specification](https://github.com/devcontainers/spec/blob/main/docs/specs/devcontainer-templates.md#the-optionalpaths-property) (https://github.com/microsoft/vscode-remote-release/issues/10095)
	- Publish metadata on Template OCI manifests (https://github.com/devcontainers/cli/pull/865)
	- Add `--omit-paths` option to `templates apply` command (https://github.com/devcontainers/cli/pull/868)
	- Add `templates metadata` command (https://github.com/devcontainers/cli/pull/866)

### [0.67.0]
- Fix containerEnv substitution. (https://github.com/microsoft/vscode-remote-release/issues/10033)

## July 2024

### [0.66.0]
- Wait for result to be written to stdout. (https://github.com/microsoft/vscode-remote-release/issues/10029)

## June 2024

### [0.65.0]
- Fix confusing error message with local feature. (https://github.com/devcontainers/cli/issues/834)
- Add `--label` parameter to `devcontainer build` command. (https://github.com/devcontainers/cli/issues/837)
- Prefer Docker Compose v2 over v1. (https://github.com/devcontainers/cli/issues/826)

### [0.64.0]
- Fix project name with env variable. (https://github.com/devcontainers/cli/issues/839)

### [0.63.0]
- Surface additional information in `devcontainer up`. (https://github.com/devcontainers/cli/pull/836)
- Changes the config layer of the Feature manifest to a empty descriptor (https://github.com/devcontainers/cli/pull/815)

## May 2024

### [0.62.0]
- Fix support for project name attribute. (https://github.com/devcontainers/cli/issues/831)

### [0.61.0]
- Use --depth 1 to make dotfiles install process faster (https://github.com/devcontainers/cli/pull/830)
- Enable --cache-to and --cache-from in devcontainer up (https://github.com/devcontainers/cli/pull/813)
- Omit generated image name when `--image-name` is given (https://github.com/devcontainers/cli/pull/812)

### [0.60.0]
- Support project name attribute. (https://github.com/microsoft/vscode-remote-release/issues/512)

## April 2024

### [0.59.1]
- Check if image name has registry host. (https://github.com/microsoft/vscode-remote-release/issues/9748)

### [0.59.0]
- Propagate --cache-from to buildx build. (https://github.com/devcontainers/cli/pull/638)
- Disable cache on feature build when `--build-no-cache` is passed. (https://github.com/devcontainers/cli/pull/790)
- Qualify local image for Podman. (https://github.com/microsoft/vscode-remote-release/issues/9748)
- Stop races docker-compose.devcontainer.containerFeatures file. (https://github.com/devcontainers/cli/issues/801)

## March 2024

### [0.58.0]
- Allow empty value for remote env. (https://github.com/devcontainers/ci/issues/231)
- Add generate-docs subcommand for templates and features. (https://github.com/devcontainers/cli/pull/759)
- Only use SELinux label for Linux hosts. (https://github.com/devcontainers/cli/issues/776)

### [0.57.0]
- Fix crash updating UID/GID when the image's platform is different from the native CPU arch (https://github.com/devcontainers/cli/pull/746)
- Add tags with build command (https://github.com/devcontainers/ci/issues/271)

## February 2024

### [0.56.2]
- Remove dependency on ip package (https://github.com/devcontainers/cli/pull/750)

## January 2024

### [0.56.1]
- Add hidden `--omit-syntax-directive` flag (https://github.com/devcontainers/cli/pull/728) to disable writing `#syntax` directives in intermediate Dockerfiles, even if provided by the user.  This is an advanced flag meant to mitigate issues involving user namespace remapping.  This flag will be removed in a future release. See https://github.com/moby/buildkit/issues/4556 for more information.
- Update dependencies (https://github.com/devcontainers/cli/pull/722)

### [0.56.0]
- Support additional Docker build options (https://github.com/devcontainers/cli/issues/85)

## December 2023

### [0.55.0]
- Adopt additional_contexts in compose (https://github.com/microsoft/vscode-remote-release/issues/7305)
- Log `docker start` output (https://github.com/microsoft/vscode-remote-release/issues/5887)

### [0.54.2]
- Update string in `isBuildKitImagePolicyError` (https://github.com/devcontainers/cli/pull/694)
- Mount build context as shared with buildah (https://github.com/devcontainers/cli/pull/548)

## November 2023

### [0.54.1]

- Fix authentication against Artifactory (https://github.com/devcontainers/cli/pull/692)

### [0.54.0]

- Force deterministic order of `outdated` command (https://github.com/devcontainers/cli/pull/681)
- Remove vscode-dev-containers dependency (https://github.com/devcontainers/cli/pull/682)
- Remove additional unused code (https://github.com/devcontainers/cli/commit/2d24543380dfc4d54e76b582536b52226af133c8)
- Update dependencies including node-pty (https://github.com/devcontainers/cli/pull/685)
- Update Third-party notices (https://github.com/devcontainers/cli/pull/686)
- Edit a Feature pinned version via upgrade command behind hidden flag (https://github.com/devcontainers/cli/pull/684)

### [0.53.0]

- add `--dry-run` to `upgrade` command (https://github.com/devcontainers/cli/pull/679)
- Fix version sorting and report major version in `outdated` command (https://github.com/devcontainers/cli/pull/670)
	- NOTE: This changes the signature of the `features info` command and the output of publishing Features/Templates.  The key `publishedVersions` has been renamed to `publishedTags` to better mirror the key's values.
- Docker compose: Updates create error description to include cause for docker auth plugin errors (https://github.com/devcontainers/cli/pull/660)

## October 2023

### [0.52.1]

- Updates create error description to include cause for docker auth plugin errors (https://github.com/devcontainers/cli/pull/656)

### [0.52.0]

- Add `upgrade` command to generate an updated lockfile (https://github.com/devcontainers/cli/pull/645)

## September 2023

### [0.51.3]

- Update UID only if GID is in use (https://github.com/microsoft/vscode-remote-release/issues/7284)
- Empty lockfile in workspaceFolder will initialize lockfile (https://github.com/devcontainers/cli/pull/637)

## August 2023

### [0.51.2]

- Surface buildkit policy errors (https://github.com/devcontainers/cli/pull/627)

### [0.51.1]
- Handle missing entry in /etc/passwd gracefully (https://github.com/microsoft/vscode-remote-release/issues/8875)

### [0.51.0]
- Add `--cache-to` option to `devcontainer build` command (https://github.com/devcontainers/cli/pull/570)
- Fix: Fallback when getent is not available (https://github.com/microsoft/vscode-remote-release/issues/8811)

## July 2023

### [0.50.2]
- Fix: Only allocate tty for `docker exec` when stdin is a tty (https://github.com/devcontainers/cli/issues/606)

### [0.50.1]
- Fix: Allocate pty for `docker exec` (https://github.com/devcontainers/cli/issues/556)

### [0.50.0]
- Publish without node-pty dependency (https://github.com/devcontainers/cli/pull/585)
- Record feature dependencies in the lockfile (https://github.com/devcontainers/cli/pull/566)
- Record features referenced by tarball URI in lockfile (https://github.com/devcontainers/cli/pull/594)
- Update proxy-agent to avoid vm2 (https://github.com/devcontainers/cli/pull/596)

### [0.49.0]
- Outdated command (https://github.com/devcontainers/cli/pull/565)
- Case-insensitive instructions (https://github.com/microsoft/vscode-remote-release/issues/6850)
- Automatically set execute bit when running dotfiles install script (https://github.com/devcontainers/cli/pull/541)
- Use getent passwd (https://github.com/microsoft/vscode-remote-release/issues/2957)

## June 2023

### [0.48.0]
- Update supported node engines to ^16.13.0 || >=18.0.0 (https://github.com/devcontainers/cli/pull/572)

### [0.47.0]
- Upgrade compiler target to ES2021 (https://github.com/devcontainers/cli/pull/568)
- Secret masking improvements (https://github.com/devcontainers/cli/pull/569)

### [0.46.0]
- Load `NODE_EXTRA_CA_CERTS` in Electron (https://github.com/devcontainers/cli/pull/559)
- Features Test Cmd: "Duplicate" test mode to test Feature Idempotence (https://github.com/devcontainers/cli/pull/553)

### [0.45.0]
- Mask user secrets in logs (https://github.com/devcontainers/cli/pull/551)

### [0.44.0]
- Preview: Feature Dependencies (https://github.com/devcontainers/spec/pull/234)
   - `devcontainer-feature.json` can now specify a `dependsOn` property that lists other Features that must be installed before the current Feature can be installed.
   - Complete rewrite of the Feature dependency resolution model
   - NOTE: This is a feature preview - please submit your feedback!
- Fix containerEnv values with spaces (https://github.com/devcontainers/cli/issues/532)

### [0.43.0]
- Fix a bug in passing users secrets to dotfile clone and install commands (https://github.com/devcontainers/cli/pull/544)
- Fix for mount command string generation (https://github.com/devcontainers/cli/pull/537)

## May 2023

### [0.42.0]

- Add object notation support for `initializeCommand` (https://github.com/devcontainers/cli/pull/514)
- Keep existing lockfile updated (https://github.com/devcontainers/spec/issues/236)
- HttpOci: Retry fetching bearer token anonymously if credentials appear expired (https://github.com/devcontainers/cli/pull/515)
- Bump proxy-agent (https://github.com/devcontainers/cli/pull/534)
- Log feature advisories (https://github.com/devcontainers/cli/pull/528)
- Check for disallowed features (https://github.com/devcontainers/cli/pull/521)

## April 2023

### [0.41.0]

- Secret support for up and run-user-commands (https://github.com/devcontainers/cli/pull/493)

### [0.40.0]

- Experimental lockfile support (https://github.com/devcontainers/cli/pull/495)
- Update vm2 (https://github.com/devcontainers/cli/pull/500)

### [0.39.0]

- Update auth precedence level for fetching Features/Templates. Notably preferring `docker login` credentials. (https://github.com/devcontainers/cli/pull/482)
   - The precedence order (https://github.com/devcontainers/cli/blob/4fde394ac16df1061b731d2d2f226850277cbce2/src/spec-configuration/httpOCIRegistry.ts#L147) is now:
		- parsed out of a special DEVCONTAINERS_OCI_AUTH environment variable
		- Read from a docker credential helper indicated in config
		- Read from a docker cred store indicated in config (https://docs.docker.com/engine/reference/commandline/login/#credentials-store)
		- Read from a docker config file (flat file with base64 encoded credentials)
		- Read from the platform's default credential helper
		- Crafted from the `GITHUB_TOKEN` environment variable
- Features can now be pinned to a digest in `devcontainer.json` (https://github.com/devcontainers/cli/pull/480)
- Automatically clean up test containers when using `devcontainers features test` (https://github.com/devcontainers/cli/pull/450)
   - The `--preserve-test-containers` flag can be used to disable this behavior
- Various internal changes to the Features/Templates OCI registry implementation (https://github.com/devcontainers/cli/pull/490)

### [0.38.0]

- Update vm2 (https://github.com/devcontainers/cli/pull/488)

### [0.37.0]

- Add --config to build command (microsoft/vscode-remote-release#8068)
- Features/Templates: Fix a bug in reading from docker credential helpers (https://github.com/devcontainers/cli/issues/477)

## March 2023

### [0.36.0]

-  Add initial support for docker credential helpers when fetching Features/Templates. (https://github.com/devcontainers/cli/pull/460, contributed by @aaronlehmann)

### [0.35.0]

- Transform maven, gradle and jupyterlab usages to their features v2 counterparts. (https://github.com/devcontainers/cli/issues/461)
- Escape and enclose containerEnv in quotes when writing to Dockerfile. (https://github.com/devcontainers/cli/issues/454)
- Update package dependencies.

### [0.34.0]

- Also require name property in `devcontainer-feature.json`. (https://github.com/devcontainers/cli/pull/447)
- Add `--omit-config-remote-env-from-metadata` to omit remoteEnv from devcontainer config on container metadata label. (https://github.com/devcontainers/cli/pull/453)
- Only include required legacy scripts. (https://github.com/microsoft/vscode-remote-release/issues/7532)

### [0.33.0]

- Connect stdin to executed process. (https://github.com/devcontainers/cli/issues/59)
- Better support for private Features published to Azure Container Registry (https://github.com/devcontainers/cli/pull/444)

### [0.32.0]

- Initial support for Features contributing lifecycle hooks (https://github.com/devcontainers/cli/pull/390)
- Retry docker pull on error (https://github.com/devcontainers/cli/pull/428)
- Fix: `devcontainer feature test` cmd should fail if Feature's sub-folder does not exist (https://github.com/devcontainers/cli/pull/418)

## February 2023

### [0.31.0]

- Add label for config file. (https://github.com/microsoft/vscode-remote-release/issues/7548)
- Add docs for `devcontainer templates publish`. (https://github.com/devcontainers/cli/pull/410)

### [0.30.0]

- Fix: Merge metadata logic for containerEnv for `devcontainer build`. (https://github.com/devcontainers/cli/pull/392)
- Support querying registries that Accept application/vnd.oci.image.index.v1+json. (https://github.com/devcontainers/cli/pull/393)
- Updates Features cache logic - Incrementally copy features near the layer they're installed. (https://github.com/devcontainers/cli/pull/382)

## January 2023

### [0.29.0]

- Add `set-up` command. (https://github.com/microsoft/vscode-remote-release/issues/7872)

### [0.28.0]

- Features preamble: Add warnings for Feature renames & deprecation. (https://github.com/devcontainers/cli/pull/366)
- Add dotfiles functionallity. (https://github.com/devcontainers/cli/pull/362)
- Cache user env for performance improvement. (https://github.com/devcontainers/cli/pull/374)

### [0.27.1]

- Fix: Modify argument regex to only allow certain set of values (https://github.com/devcontainers/cli/pull/361)
- Fix: Fixed fromStatement parsing to parse quotes in variable expressions (https://github.com/devcontainers/cli/pull/356)
- Fix: Allow prebuilding image without a Dockerfile (https://github.com/devcontainers/cli/pull/352)

### [0.27.0]

- Fix: Failed to fetch local disk feature on Windows (https://github.com/devcontainers/cli/pull/333)
- Features: Adds 'deprecated' property (https://github.com/devcontainers/cli/pull/346)
- Features: Adds 'legacyIds' property (https://github.com/devcontainers/cli/pull/335)
- Follow Docker Token Authentication Specification (https://github.com/devcontainers/cli/pull/341)
- Fix: Handle parsing variable expression in dockerfile (https://github.com/devcontainers/cli/pull/337)

## December 2022

### [0.26.1]

- Add more detail to the output of `publish` commands (https://github.com/devcontainers/cli/pull/326)

### [0.26.0]

- A more spec-compliant/resilient OCI distribution implementation. (https://github.com/devcontainers/cli/pull/318)
- Update NPM package dependencies. (https://github.com/devcontainers/cli/pull/315)
- Fix escaping of embedded JSON. (https://github.com/devcontainers/cli/pull/324)

### [0.25.3]

- Emit a JSON summary of the result of the `features publish` and `templates publish` commands (https://github.com/devcontainers/cli/pull/305)
- Fix: "ssh-add: communication with agent failed" (https://github.com/microsoft/vscode-remote-release/issues/7601)

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
