---
description: "Discussion of the devcontainers CLI project architecture, conventions, and development patterns"
---

# DevContainers CLI Project Instructions

## Overview

The DevContainers CLI (`@devcontainers/cli`) is a TypeScript-based Node.js project that implements the [Development Containers specification](https://containers.dev). It provides tooling for building, running, and managing development containers across different container runtimes and orchestrators.

## Architecture

### Core Components

- **`src/spec-configuration/`** - Configuration parsing and validation for devcontainer.json
- **`src/spec-node/`** - Node.js-specific implementations of the specification
- **`src/spec-utils/`** - Shared utilities for specification handling
- **`src/test/`** - Comprehensive test suites including container tests

### Key Design Principles

1. **Specification Compliance**: All features must align with the official devcontainer specification
2. **Multi-Runtime Support**: Support for Docker, Podman, and other container runtimes
3. **Cross-Platform**: Works on Windows, macOS, and Linux
4. **Extensibility**: Plugin architecture for features and lifecycle hooks

## Development Conventions

### TypeScript Patterns

- Use strict TypeScript configuration with `noImplicitAny` and `strictNullChecks`
- Prefer interfaces over type aliases for object shapes
- Use proper async/await patterns, avoid callback-style APIs
- Export types and interfaces from dedicated `types.ts` files

### Error Handling

- Use custom error classes that extend base `Error`
- Provide meaningful error messages with context
- Include error codes for programmatic handling
- Log errors at appropriate levels using the project's logging system

### Testing Strategy

- Unit tests in `src/test/` with `.test.ts` suffix
- Container integration tests that actually build and run containers
- Mock external dependencies (Docker API, file system operations)
- Use descriptive test names that explain the scenario being tested

## Key Integration Points

### Container Runtime Integration

- **Docker**: Primary runtime support via Docker API
- **Podman**: Alternative runtime with compatibility layer
- **BuildKit**: For advanced build features and caching

### File System Operations

- Configuration discovery and parsing from workspace roots
- Template and feature resolution from local and remote sources
- Volume mounting and bind mount handling across platforms

### External Dependencies

- **Container registries**: For pulling base images and publishing
- **Git repositories**: For fetching features and templates
- **Package managers**: npm, pip, apt for installing tools in containers

## Common Development Patterns

### Adding New CLI Commands

1. Define command in `src/spec-node/devContainersSpecCLI.ts`
2. Implement handler function with proper argument parsing
3. Add comprehensive error handling and logging
4. Include unit and integration tests
5. Update CLI help text and documentation

### Configuration Processing

- Use `src/spec-configuration/` utilities for parsing devcontainer.json
- Validate configuration against JSON schema
- Handle inheritance and composition (extends, merging)
- Support both local and remote configuration sources

### Feature Implementation

- Follow the specification's feature model
- Support installation scripts and lifecycle hooks
- Handle dependency resolution and ordering
- Provide proper cleanup and error recovery

## Common Pitfalls

### Platform-Specific Issues

- **Path handling**: Use `path.posix` for container paths, `path` for host paths
- **Line endings**: Handle CRLF/LF differences in scripts and configs
- **File permissions**: Different behavior on Windows vs Unix systems
- **Container mounting**: Volume vs bind mount differences across platforms

### Container Runtime Differences

- Docker Desktop vs Docker Engine behavior variations
- Podman compatibility quirks (networking, volumes, security contexts)
- Image building differences between runtimes
- Registry authentication handling

### Performance Considerations

- **Image caching**: Leverage BuildKit and registry caching
- **Parallel operations**: Use proper concurrency for multi-container scenarios
- **File watching**: Efficient change detection for rebuild scenarios
- **Network optimization**: Minimize registry pulls and DNS lookups

## Development Workflow

### Setup and Building

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm test

# Run container tests (requires Docker)
npm run test:container
```

### Testing Guidelines

- Always test with actual containers, not just mocks
- Test cross-platform scenarios when possible
- Include negative test cases for error conditions
- Verify cleanup behavior (containers, volumes, networks)

### Debugging

- Use `--log-level trace` for detailed operation logging
- Container logs are available via runtime APIs
- File system operations are logged at debug level
- Network issues often manifest as timeout errors

## Extension Points

### Custom Features

- Implement in separate npm packages
- Follow feature specification format
- Provide proper metadata and documentation
- Test with multiple base images and scenarios

### Lifecycle Hooks

- `onCreateCommand`, `postCreateCommand`, `postStartCommand`
- Handle both synchronous and asynchronous operations
- Provide proper error propagation
- Support both shell commands and executable scripts

## Related Documentation

- [Contributing Guidelines](../../CONTRIBUTING.md)
- [Development Container Specification](https://containers.dev)
- [Feature and Template specifications](https://containers.dev/implementors/features/)
- [JSON Schema definitions](src/spec-configuration/schemas/)

## Key Files and Directories

- `src/spec-node/devContainersSpecCLI.ts` - Main CLI entry point
- `src/spec-configuration/configuration.ts` - Configuration parsing logic
- `src/spec-utils/` - Shared utilities and helpers
- `src/test/container-features/` - Feature integration tests
- `.devcontainer/` - Project's own development container configuration
