# Devcontainer Metadata Regression: Complete Fork Handoff

Date: 2026-05-13
Prepared by: Copilot investigation agent

## 1) Which repo to fork
Fork this repository:
- https://github.com/devcontainers/cli

Why this repo:
- The observed behavior is consistent with the CLI build/metadata assembly path, not the spec intent.
- The likely fix point is in CLI source where metadata is collected and re-written.

Suggested fork workflow:
1. Fork `devcontainers/cli`.
2. Create branch `fix/preserve-user-dockerfile-metadata`.
3. Add/adjust tests first, then patch implementation.
4. Open PR to upstream `devcontainers/cli` with repro matrix and source trace below.

## 2) Executive conclusion
Your expectation is standard: image metadata in `devcontainer.metadata` is intended to support this exact use case.

Observed behavior in tested CLI build paths can drop user Dockerfile metadata entries from the effective final image label.

Working decision for downstream reliability:
- Treat runtime-critical settings as devcontainer JSON source of truth (workaround branch B1 in downstream repo).
- In parallel, fix/report upstream CLI behavior.

## 3) Spec intent (cross-check)
Reviewed references:
- devcontainers/spec issue #18 (Dev container metadata in image labels)
- devcontainers/spec PR #95 (Image Metadata Proposal, merged)
- containers.dev spec sections for Image Metadata and Merge Logic

Intent established by spec/discussion:
1. `devcontainer.metadata` label is an intended standard mechanism.
2. Label may contain object or array snippets, merged at runtime.
3. Mounts merge rule is collected list, with conflict handling by source.
4. Features and image metadata are meant to compose, not erase user intent.

## 4) Reproduction matrix (executed)
Environment versions:
- devcontainer CLI: 0.87.0
- Docker: 29.4.3
- buildx: 0.33.0
- Node for CLI invocation: 22.11.0 via mise

### Case A
Build path: docker build only (no devcontainer CLI)
Base: metadata-bearing (`mcr.microsoft.com/devcontainers/base:debian`)
Result: user metadata entry survived.

### Case B
Build path: devcontainer CLI build, no features
Base: metadata-bearing (`mcr.microsoft.com/devcontainers/base:debian`)
Result: user metadata entry did not survive.

### Case C
Build path: devcontainer CLI build, with features
Base: metadata-bearing (`mcr.microsoft.com/devcontainers/base:debian`)
Result: user metadata entry did not survive.

### Case D
Build path: devcontainer CLI build, no features
Base: plain (`debian:bookworm`, no preexisting devcontainer metadata)
Result: user metadata entry survived.

### Case E
Build path: devcontainer CLI build, with features
Base: plain (`debian:bookworm`)
Result: user metadata entry did not survive.

Interpretation:
- Feature-enabled CLI path consistently overwrote effective user label metadata in tests.
- CLI no-feature behavior appears sensitive to base metadata state.
- This indicates implementation/path behavior, not a spec prohibition.

## 5) Minimal repro patterns used
### Repro metadata entry in Dockerfile
- `name: "label-repro"`
- `mounts: ["source=${localEnv:HOME}/.aws,target=/home/vscode/.aws,type=bind"]`
- `postCreateCommand: "echo HELLO_FROM_LABEL"`

### Devcontainer CLI command pattern
- `mise x nodejs@22.11.0 -- npx -y @devcontainers/cli@latest build --workspace-folder <repro-folder> --image-name <image-tag> --no-cache`

### Inspect commands
- `docker inspect --format '{{ index .Config.Labels "devcontainer.metadata" }}' <image-tag> | jq`
- `docker history --no-trunc <image-tag> | grep -i 'devcontainer.metadata'`

Note:
- Docker-in-Docker feature on Debian trixie required `"moby": false` for build success in repro.

## 6) Source-code trace in devcontainers/cli (where it likely breaks)
High-probability break path:
1. Dockerfile config flow calls `buildNamedImageAndExtend(...)` then `buildAndExtendImage(...)`.
2. `buildAndExtendImage(...)` calls `getImageBuildInfoFromDockerfile(...)` before generating wrapper Dockerfile.
3. In `internalGetImageBuildInfoFromDockerfile(...)`, metadata source is derived via `findBaseImage(...)` + `inspectDockerImage(baseImage)` and parsed from that image.
4. Wrapper metadata is then generated from computed metadata/features/config with `getDevcontainerMetadata(...)` and written via `getDevcontainerMetadataLabel(...)` into generated wrapper Dockerfile (`Dockerfile-with-features` / `Dockerfile.extended`).
5. Final image has a later `LABEL devcontainer.metadata=...` write from wrapper path, which becomes effective (label replacement semantics).

Observed consequence:
- User Dockerfile metadata entry can be absent from final effective label, even when present in image history.

## 7) What to implement upstream
Primary objective:
- Preserve user Dockerfile metadata entries in effective final `devcontainer.metadata` for CLI build paths, especially with features.

Implementation direction:
1. Ensure metadata computation for wrapper label includes metadata from the built user Dockerfile image layer (not only resolved base image metadata).
2. Validate behavior across:
   - Dockerfile config with features
   - Dockerfile config without features
   - image-based config extended with features
3. Keep merge rules consistent with spec intent.

## 8) Tests to add/update in devcontainers/cli
Add regression tests that assert final image effective metadata includes user Dockerfile metadata entry:
1. Dockerfile + feature + metadata-bearing base.
2. Dockerfile + feature + plain base.
3. Dockerfile without feature + metadata-bearing base.

Assertions:
- Final inspect metadata contains user entry by marker (`name` or unique command).
- Feature metadata still present.
- Mount and lifecycle fields are preserved/merged as expected.

## 9) Downstream workaround (until upstream fixed)
In downstream repos relying on runtime-critical mounts/hooks:
1. Move runtime-critical fields from Dockerfile label to devcontainer JSON.
2. Keep Dockerfile metadata minimal/non-critical where possible.
3. Add drift tests if maintaining parallel local/release configs.

## 10) Ready-to-file upstream issue/PR summary
Problem statement:
- `devcontainer build` can produce final `devcontainer.metadata` that excludes user Dockerfile metadata entries in certain build paths, especially when features are involved.

Expected:
- Final metadata should preserve user Dockerfile metadata and append/merge feature/runtime metadata according to spec merge model.

Actual:
- Final effective label can reflect wrapper/base/feature entries without user Dockerfile entry.

Impact:
- Mounts, lifecycle hooks, and other runtime-critical settings encoded in user image metadata may silently disappear.

Evidence:
- Repro matrix above + inspect/history outputs + version snapshot.

---
This document is the single source handoff for the next agent run in a forked `devcontainers/cli` context.
