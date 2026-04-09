# Contributing Code

This guide covers everything you need to set up a development environment, build, test, and submit code changes to the Dev Containers CLI. For the proposal and specification process, see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [Docker](https://www.docker.com/) (required for running integration tests — they create real containers)
- [Git](https://git-scm.com/)
- [yarn](https://yarnpkg.com/) (used for dependency installation)

## Setting up your development environment

Fork and clone the repository:

```sh
git clone https://github.com/<your-username>/cli.git
cd cli
```

### Option A: Dev Container (recommended)

The repository includes a [dev container configuration](../.devcontainer/devcontainer.json) that provides a ready-to-go environment with Node.js, TypeScript, and Docker-in-Docker pre-configured.

1. Open the cloned repository in VS Code.
2. When prompted, select **Reopen in Container** (requires the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)). Alternatively, open the repository in [GitHub Codespaces](https://github.com/features/codespaces).
3. The `postCreateCommand` automatically runs `yarn install` to install all dependencies.

You are ready to build and test.

### Option B: Local setup

1. Install Node.js >= 20 and Docker.
2. Install dependencies:

    ```sh
    yarn install
    ```

    Ensure Docker is running — it is needed for the integration test suite.

    Some tests build containers for non-native architectures (e.g., `linux/arm64` on an x64 host, or vice versa). To run these locally, register QEMU emulators:

    ```sh
    docker run --privileged --rm tonistiigi/binfmt --install all
    ```

    This is needed once per boot (or per WSL session on Windows). On macOS with Docker Desktop, cross-architecture emulation is built in and this step is not required.

3. *(Optional)* Install [Podman](https://podman.io/) if you want to run the Podman-specific tests. The CLI supports both Docker and Podman as container engines, and the test suite includes a separate set of tests (`cli.podman.test.ts`) that verify Podman compatibility using `--docker-path podman`. These tests will fail with `spawn podman ENOENT` if Podman is not installed — this is expected and does not indicate a code problem. The CI GitHub workflow runs these tests on `ubuntu-latest` where Podman is pre-installed.

## Project structure

The CLI is written in TypeScript and organized as multiple sub-projects using [TypeScript project references](https://www.typescriptlang.org/docs/handbook/project-references.html):

| Sub-project | Path | Purpose |
| --- | --- | --- |
| `spec-common` | `src/spec-common/` | Shared utilities (async helpers, CLI host, process management, shell server) |
| `spec-configuration` | `src/spec-configuration/` | Configuration parsing, OCI registry interactions, Features/Templates configuration |
| `spec-node` | `src/spec-node/` | Core CLI logic — container lifecycle, Docker/Compose integration, Feature utilities |
| `spec-shutdown` | `src/spec-shutdown/` | Docker CLI wrapper utilities (container inspection, execution, lifecycle management) |
| `spec-utils` | `src/spec-utils/` | General utilities (logging, HTTP requests, filesystem helpers) |

Key files:

- `devcontainer.js` — Entry point that loads the bundled CLI from `dist/spec-node/devContainersSpecCLI.js`.
- `esbuild.js` — Build script that bundles the TypeScript output with esbuild.
- `src/test/` — Test files and fixture configurations under `src/test/configs/`.

## Development workflow

### 1. Build

Start the dev build watchers — run these in separate terminals (or use the [VS Code build task](#vs-code-integration)):

```sh
npm run watch            # incremental esbuild (rebuilds on save)
npm run type-check-watch # tsc in watch mode (reports type errors)
```

For a one-shot build instead, run `npm run compile`. To remove all build output, run `npm run clean`.

### 2. Run

After building, invoke the CLI directly:

```sh
node devcontainer.js --help
node devcontainer.js up --workspace-folder <path>
node devcontainer.js build --workspace-folder <path>
node devcontainer.js run-user-commands --workspace-folder <path>
```

### 3. Test

Tests use [Mocha](https://mochajs.org/) and [Chai](https://www.chaijs.com/) and require Docker because they create and tear down real containers.

```sh
npm test                          # all tests
npm run test-container-features   # Features tests only
npm run test-container-templates  # Templates tests only
```

#### Adding tests

- Place new test files in `src/test/` with a `.test.ts` suffix.
- Place test fixture `devcontainer.json` configurations under `src/test/configs/<your-config-name>/`.
- Use the helpers in `src/test/testUtils.ts` (`shellExec`, `devContainerUp`, `devContainerDown`) for container lifecycle management in tests.

### 4. Validate and submit

Before committing, run the same checks CI runs:

```sh
npm run type-check   # full type-check
npm run package      # production build (minified) + pack into .tgz
npm run precommit    # lint, formatting, copyright headers
npm test             # full test suite (may take a very long time to run, consider running a subset of tests during development)
```

Then push your branch and open a pull request against `main`. Link any related [repo issues](https://github.com/devcontainers/cli/issues) or [specification issues](https://github.com/microsoft/dev-container-spec/issues) in the PR description.

## VS Code integration

The repository includes VS Code configuration in `.vscode/` for building, debugging, and testing.

### Build task

The default build task (**Ctrl+Shift+B** / **Cmd+Shift+B**) is **Build Dev Containers CLI**. It runs `npm run watch` and `npm run type-check-watch` in parallel so you get both bundled output and type errors as you edit.

### Debug configurations

Two launch configurations are provided in `.vscode/launch.json`:

- **Launch CLI - up** — Runs the CLI's `up` command against `src/test/configs/example/`. Edit the `args` array to point at a different config or subcommand.
- **Launch Tests** — Runs the full Mocha test suite under the debugger.

### Editor settings

The workspace recommends the [ESLint extension](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) for inline lint feedback. The workspace settings (`.vscode/settings.json`) configure format-on-save, tab indentation, and the workspace TypeScript SDK.

## Troubleshooting

### Docker not available

Tests will fail if Docker is not running. Make sure the Docker daemon is started. If using the dev container, Docker-in-Docker is configured automatically.

### `node-pty` native module build failures

The `node-pty` dependency includes native code. If you see build errors during `yarn install`, ensure you have the required build tools for your platform (e.g., `build-essential` on Debian/Ubuntu, Xcode Command Line Tools on macOS).

### Leftover test containers

If tests are interrupted, containers may be left running. Single-container tests label their containers with `devcontainer.local_folder`:

```sh
docker rm -f $(docker ps -aq --filter "label=devcontainer.local_folder")
```

Compose-based tests also create sidecar containers (e.g., `db` services) that don't carry that label. To remove those, filter by the compose config path:

```sh
docker rm -f $(docker ps -a --format '{{.ID}} {{.Label "com.docker.compose.project.config_files"}}' | grep src/test/configs | awk '{print $1}')
```

### Podman test failures

If you don't have Podman installed, `cli.podman.test.ts` will fail with `spawn podman ENOENT`. This is safe to ignore — CI will run them. See [Local setup](#option-b-local-setup) for details on installing Podman or skipping these tests.
