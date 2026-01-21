# AGENTS.md

This file contains guidelines and commands for agentic coding agents working on the Dev Containers CLI repository.

## Development Commands

### Build Commands
- `npm run compile` - Compile the project (clean + compile-dev)
- `npm run compile-prod` - Production build with optimizations
- `npm run compile-dev` - Development build
- `npm run compile-watch` - Watch mode for development
- `npm run watch` - Alias for compile-watch
- `npm run package` - Create distributable package

### Type Checking
- `npm run type-check` - Run TypeScript compiler type checking
- `npm run type-check-watch` - Type checking in watch mode

### Linting and Code Quality
- `npm run lint` - Run ESLint with max-warnings 0
- `npm run precommit` - Run hygiene checks (formatting, lint, etc.)

### Testing
- `npm test` - Run all tests
- `npm run test-matrix` - Run tests with matrix options
- `npm run test-container-features` - Run container features tests only
- `npm run test-container-features-cli` - Run CLI features tests only
- `npm run test-container-templates` - Run container templates tests only

**Single test execution:**
```bash
# Run a specific test file
env TS_NODE_PROJECT=src/test/tsconfig.json mocha -r ts-node/register --exit src/test/cli.test.ts

# Run a specific test within a file
env TS_NODE_PROJECT=src/test/tsconfig.json mocha -r ts-node/register --exit src/test/cli.test.ts -g "test name"
```

### Clean Commands
- `npm run clean` - Clean all build artifacts
- `npm run clean-dist` - Clean dist folder
- `npm run clean-built` - Clean built folder

## Code Style Guidelines

### TypeScript Configuration
- Use TypeScript 5.8+ with strict mode
- Project references architecture with separate packages:
  - `spec-common` - Shared utilities
  - `spec-configuration` - Configuration handling
  - `spec-node` - Node.js specific implementations
  - `spec-shutdown` - Docker/shutdown utilities
  - `spec-utils` - General utilities

### Import Organization
- Group imports: standard library → third-party → local modules
- Use `import * as` for modules with exports
- Prefer named imports over default exports
- Keep import statements at file top after license header

### Formatting Rules (tsfmt.json)
- Tab size: 4, convert tabs to spaces: false (preserves tabs)
- Semicolons: always required
- Brace placement: same line for functions and control blocks
- Binary operators: spaces before and after
- Function calls: no spaces inside parentheses
- Template strings: no spaces inside braces

### ESLint Configuration
- TypeScript ESLint parser with stylistic plugin
- Key rules enforced:
  - No unused variables or imports
  - Curly braces required for control structures
  - Strict equality checks (`===`) required
  - No async promise executors
  - No var declarations (use const/let)
  - No debugger statements
  - Consistent member delimiter style (semicolons)

### Naming Conventions
- **Files**: PascalCase for classes/exports, kebab-case for utilities
- **Classes/Interfaces**: PascalCase (e.g., `DevContainerConfig`)
- **Functions/Methods**: camelCase, descriptive verbs for actions
- **Variables**: camelCase, avoid abbreviations
- **Constants**: UPPER_SNAKE_CASE for top-level constants
- **Types**: PascalCase for type aliases, camelCase for type parameters

### Error Handling
- Use custom `ContainerError` class from `src/spec-common/errors.ts`
- Always provide meaningful error messages with context
- Use try-catch blocks for async operations with proper error propagation
- Include error codes and stack traces when appropriate
- Validate inputs early and fail fast

### Code Organization
- **License Header**: Include Microsoft copyright header in all .ts files
- **Module Structure**: Export classes/functions at module level, not inside objects
- **File Size**: Keep files focused and reasonably sized (<500 lines when possible)
- **Dependencies**: Check existing codebase before adding new npm packages

### Testing Guidelines
- Use Mocha with Chai assertions
- Test files end with `.test.ts`
- Organize tests with describe/it blocks
- Use `this.timeout('120s')` for integration tests
- Mock external dependencies in unit tests
- Clean up test artifacts in afterEach hooks

### Documentation
- Use JSDoc comments for public APIs
- Include parameter types and return types
- Document complex logic with inline comments when necessary
- Update CHANGELOG.md for significant changes

### Git Workflow
- Feature branches for new development
- Ensure all lint/type checks pass before commits
- Include tests for new functionality
- Update documentation as needed

## Project Structure
- `/src/spec-*` - Core specification modules
- `/src/test/` - Test files and test utilities
- `/docs/` - Documentation
- `devcontainer.js` - Main CLI entry point
- `package.json` - Project configuration and scripts
- `.eslintrc.js` - ESLint configuration
- `tsconfig*.json` - TypeScript project configurations

## Important Notes
- Node.js version requirement: ^16.13.0 || >=18.0.0
- This is a Microsoft project with MIT license
- CLI is part of the Development Containers Specification
- Maintains backward compatibility when possible
- Uses esbuild for fast compilation