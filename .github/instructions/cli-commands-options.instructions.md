---
description: "Discussion of the CLI commands and options part of the codebase"
---

# CLI Commands and Options

This document covers the command-line interface implementation, including command structure, argument parsing, validation, and extension patterns.

## Architecture Overview

The CLI is built using a modular command structure where each command is implemented as a separate module with standardized interfaces for argument parsing, validation, and execution.

### Key Components

- **Command Registration**: Commands are registered through a central registry system
- **Argument Parsing**: Uses a consistent parsing framework for options, flags, and positional arguments
- **Validation Pipeline**: Multi-stage validation including syntax, semantic, and context validation
- **Error Handling**: Standardized error reporting with user-friendly messages and exit codes

## Command Structure Patterns

### Command Definition
Commands follow a consistent structure with:
- Command metadata (name, description, aliases)
- Argument/option definitions with types and validation rules
- Handler function for command execution
- Help text generation

### Option Types
- **Boolean flags**: Simple on/off switches
- **String options**: Text input with optional validation patterns
- **Enum options**: Predefined value sets with validation
- **Array options**: Multiple values of the same type
- **File/path options**: Special handling for filesystem references

## Development Conventions

### Adding New Commands
1. Create command module in appropriate subdirectory
2. Define command schema with full type information
3. Implement validation logic (both sync and async where needed)
4. Add comprehensive error handling with specific error codes
5. Include help text and examples
6. Register command in central registry
7. Add integration tests covering common usage patterns

### Option Naming Conventions
- Use kebab-case for multi-word options (`--config-file`)
- Provide short aliases for frequently used options (`-c` for `--config`)
- Boolean flags should be positive by default (`--enable-feature` not `--disable-feature`)
- Use consistent naming across related commands

### Validation Patterns
- **Input Validation**: Check argument types, ranges, and format requirements
- **Context Validation**: Verify prerequisites, file existence, permissions
- **Cross-option Validation**: Ensure option combinations are valid
- **Async Validation**: Handle network-dependent or filesystem validation

## Integration Points

### Configuration System
Commands integrate with the configuration system to:
- Load default values from config files
- Override config with command-line arguments
- Validate configuration consistency

### Logging and Output
- Use structured logging for debugging and audit trails
- Implement consistent output formatting (JSON, table, plain text)
- Handle progress reporting for long-running operations

### Error Handling
- Map internal errors to user-friendly messages
- Use specific exit codes for different error categories
- Provide actionable error messages with suggested fixes

## Common Patterns

### Async Command Execution
Most commands involve async operations (file I/O, network requests). Follow patterns for:
- Proper async/await usage
- Timeout handling
- Graceful cancellation
- Progress reporting

### File System Operations
- Always validate paths before operations
- Handle relative vs absolute path resolution
- Implement proper error handling for permissions, missing files
- Consider cross-platform path handling

### Configuration Merging
Commands often need to merge configuration from multiple sources:
1. Default values
2. Configuration files
3. Environment variables
4. Command-line arguments

## Testing Patterns

### Unit Tests
- Test command parsing in isolation
- Validate option validation logic
- Mock external dependencies
- Test error conditions and edge cases

### Integration Tests
- Test complete command execution flows
- Verify file system interactions
- Test configuration loading and merging
- Validate output formatting

## Common Pitfalls

### Argument Parsing
- Be careful with optional vs required arguments
- Handle edge cases in string parsing (quotes, escaping)
- Validate mutually exclusive options
- Consider default value precedence

### Error Messages
- Avoid technical jargon in user-facing messages
- Provide specific error locations (line numbers, file paths)
- Include suggested fixes when possible
- Use consistent error formatting

### Performance Considerations
- Lazy-load command modules to improve startup time
- Cache validation results when appropriate
- Optimize for common usage patterns
- Handle large input sets efficiently

## Extension Points

### Custom Validators
The validation system supports custom validators for domain-specific requirements.

### Output Formatters
New output formats can be added through the formatter registry.

### Command Plugins
External commands can be registered through the plugin system.

## Key Files and Directories

- `/src/spec-node/devContainersSpecCLI.ts` - Main CLI entry point
- `/src/spec-configuration/` - Configuration parsing and validation
- `/src/spec-utils/` - Shared utilities for command implementation
- Tests in `/src/test/` following command structure
