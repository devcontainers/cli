#!/bin/sh
# install.sh - Install @devcontainers/cli with bundled Node.js
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/devcontainers/cli/main/scripts/install.sh | sh
#   wget -qO- https://raw.githubusercontent.com/devcontainers/cli/main/scripts/install.sh | sh
#
# Options:
#   --prefix DIR        Installation directory (default: ~/.devcontainers)
#   --version VER       CLI version to install (default: latest)
#   --node-version VER  Node.js major version (default: 20)
#   --update            Update existing installation to latest versions
#   --uninstall         Remove the installation
#   --help              Show this help message
#
# Environment:
#   DEVCONTAINERS_INSTALL_DIR   Override default installation directory

set -e

# Default configuration
INSTALL_PREFIX="${DEVCONTAINERS_INSTALL_DIR:-$HOME/.devcontainers}"
CLI_VERSION="latest"
NODE_MAJOR_VERSION="20"
UPDATE_MODE=false
UNINSTALL_MODE=false

# Terminal colors (disabled if not a tty)
setup_colors() {
    if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
        RED='\033[0;31m'
        GREEN='\033[0;32m'
        YELLOW='\033[0;33m'
        BLUE='\033[0;34m'
        BOLD='\033[1m'
        RESET='\033[0m'
    else
        RED=''
        GREEN=''
        YELLOW=''
        BLUE=''
        BOLD=''
        RESET=''
    fi
}

say() {
    printf '%b\n' "${GREEN}>${RESET} $1"
}

warn() {
    printf '%b\n' "${YELLOW}warning${RESET}: $1" >&2
}

error() {
    printf '%b\n' "${RED}error${RESET}: $1" >&2
}

# Print usage information
usage() {
    cat << 'EOF'
Install @devcontainers/cli with bundled Node.js

Usage:
  curl -fsSL https://raw.githubusercontent.com/devcontainers/cli/main/scripts/install.sh | sh
  sh install.sh [OPTIONS]

Options:
  --prefix DIR        Installation directory (default: ~/.devcontainers)
  --version VER       CLI version to install (default: latest)
  --node-version VER  Node.js major version (default: 20)
  --update            Update existing installation to latest versions
  --uninstall         Remove the installation
  --help              Show this help message

Environment:
  DEVCONTAINERS_INSTALL_DIR   Override default installation directory

Examples:
  # Install latest version
  curl -fsSL https://raw.githubusercontent.com/devcontainers/cli/main/scripts/install.sh | sh

  # Install specific version
  sh install.sh --version 0.82.0

  # Install to custom directory
  sh install.sh --prefix ~/.local/devcontainers

  # Update existing installation
  sh install.sh --update

  # Uninstall
  sh install.sh --uninstall

After installation, add to your shell profile:
  export PATH="$HOME/.devcontainers/bin:$PATH"
EOF
}

# Parse command-line arguments
parse_args() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --prefix)
                INSTALL_PREFIX="$2"
                shift 2
                ;;
            --prefix=*)
                INSTALL_PREFIX="${1#*=}"
                shift
                ;;
            --version)
                CLI_VERSION="$2"
                shift 2
                ;;
            --version=*)
                CLI_VERSION="${1#*=}"
                shift
                ;;
            --node-version)
                NODE_MAJOR_VERSION="$2"
                shift 2
                ;;
            --node-version=*)
                NODE_MAJOR_VERSION="${1#*=}"
                shift
                ;;
            --update)
                UPDATE_MODE=true
                shift
                ;;
            --uninstall)
                UNINSTALL_MODE=true
                shift
                ;;
            --help|-h)
                usage
                exit 0
                ;;
            *)
                error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done
}

# Detect platform (OS and architecture)
detect_platform() {
    # OS detection
    case "$(uname -s)" in
        Linux*)
            PLATFORM="linux"
            ;;
        Darwin*)
            PLATFORM="darwin"
            ;;
        CYGWIN*|MINGW*|MSYS*)
            error "Windows is not supported by this installer."
            error "Please use WSL (Windows Subsystem for Linux) or install via npm:"
            error "  npm install -g @devcontainers/cli"
            exit 1
            ;;
        *)
            error "Unsupported operating system: $(uname -s)"
            exit 1
            ;;
    esac

    # Architecture detection
    case "$(uname -m)" in
        x86_64|amd64)
            ARCH="x64"
            ;;
        aarch64|arm64)
            ARCH="arm64"
            ;;
        armv7l|armv6l)
            error "32-bit ARM is not supported."
            exit 1
            ;;
        *)
            error "Unsupported architecture: $(uname -m)"
            exit 1
            ;;
    esac

    # macOS: Detect if running under Rosetta 2 and prefer native arm64
    if [ "$PLATFORM" = "darwin" ] && [ "$ARCH" = "x64" ]; then
        if sysctl -n sysctl.proc_translated 2>/dev/null | grep -q 1; then
            say "Detected Rosetta 2 translation, using native arm64 binary"
            ARCH="arm64"
        fi
    fi
}

# Check for required tools
check_prerequisites() {
    # Check for curl or wget
    if command -v curl >/dev/null 2>&1; then
        DOWNLOADER="curl"
    elif command -v wget >/dev/null 2>&1; then
        DOWNLOADER="wget"
    else
        error "Either 'curl' or 'wget' is required but neither was found."
        exit 1
    fi

    # Check for tar
    if ! command -v tar >/dev/null 2>&1; then
        error "'tar' is required but not found."
        exit 1
    fi

    # Check if we can write to the install directory
    if [ -e "$INSTALL_PREFIX" ]; then
        if [ ! -d "$INSTALL_PREFIX" ]; then
            error "Installation path exists but is not a directory: $INSTALL_PREFIX"
            exit 1
        fi
        if [ ! -w "$INSTALL_PREFIX" ]; then
            error "No write permission for installation directory: $INSTALL_PREFIX"
            exit 1
        fi
    else
        # Check if we can create the directory
        PARENT_DIR="$(dirname "$INSTALL_PREFIX")"
        if [ ! -w "$PARENT_DIR" ]; then
            error "No write permission to create installation directory: $INSTALL_PREFIX"
            exit 1
        fi
    fi
}

# Download a file using curl or wget
download() {
    url="$1"
    output="$2"

    if [ "$DOWNLOADER" = "curl" ]; then
        curl -fSL --retry 3 --retry-delay 2 -o "$output" "$url"
    else
        wget --tries=3 --waitretry=2 -q -O "$output" "$url"
    fi
}

# Fetch content from a URL (for API calls)
fetch() {
    url="$1"

    if [ "$DOWNLOADER" = "curl" ]; then
        curl -fsSL "$url"
    else
        wget -qO- "$url"
    fi
}

# Resolve "latest" CLI version from npm registry
resolve_cli_version() {
    if [ "$CLI_VERSION" = "latest" ]; then
        say "Resolving latest CLI version..."
        version=$(fetch "https://registry.npmjs.org/@devcontainers/cli/latest" | \
            sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
        if [ -z "$version" ]; then
            error "Failed to resolve latest CLI version from npm registry"
            exit 1
        fi
        CLI_VERSION="$version"
    fi
    say "CLI version: $CLI_VERSION"
}

# Resolve full Node.js version from major version
resolve_node_version() {
    say "Resolving Node.js v$NODE_MAJOR_VERSION LTS version..."

    # Get the latest version for the major version
    index_url="https://nodejs.org/dist/index.json"
    version=$(fetch "$index_url" | \
        sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"v\('"$NODE_MAJOR_VERSION"'\.[^"]*\)".*/\1/p' | head -1)

    if [ -z "$version" ]; then
        error "Failed to resolve Node.js v$NODE_MAJOR_VERSION version"
        exit 1
    fi

    NODE_VERSION="$version"
    say "Node.js version: v$NODE_VERSION"
}

# Get Node.js download URL
get_node_url() {
    # Prefer .tar.xz if available, fall back to .tar.gz
    echo "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${PLATFORM}-${ARCH}.tar.xz"
}

# Get CLI download URL from npm registry
get_cli_url() {
    echo "https://registry.npmjs.org/@devcontainers/cli/-/cli-${CLI_VERSION}.tgz"
}

# Install Node.js
install_node() {
    node_dir="$INSTALL_PREFIX/node"
    version_dir="$node_dir/v$NODE_VERSION"

    # Check if already installed
    if [ -d "$version_dir" ] && [ -x "$version_dir/bin/node" ]; then
        say "Node.js v$NODE_VERSION is already installed"
    else
        say "Downloading Node.js v$NODE_VERSION..."

        tmp_dir=$(mktemp -d)
        trap 'rm -rf "$tmp_dir"' EXIT

        node_url=$(get_node_url)
        tarball="$tmp_dir/node.tar.xz"

        if ! download "$node_url" "$tarball"; then
            # Try .tar.gz if .tar.xz failed
            node_url="${node_url%.xz}.gz"
            tarball="$tmp_dir/node.tar.gz"
            say "Trying .tar.gz format..."
            download "$node_url" "$tarball"
        fi

        say "Extracting Node.js..."
        mkdir -p "$node_dir"

        # Extract to temp first, then move
        extract_dir="$tmp_dir/extracted"
        mkdir -p "$extract_dir"

        case "$tarball" in
            *.xz)
                # Try xz decompression
                if command -v xz >/dev/null 2>&1; then
                    xz -d -c "$tarball" | tar -xf - -C "$extract_dir"
                else
                    # Some tar implementations support -J for xz
                    tar -xJf "$tarball" -C "$extract_dir" 2>/dev/null || {
                        error "xz decompression not available. Please install xz-utils."
                        exit 1
                    }
                fi
                ;;
            *.gz)
                tar -xzf "$tarball" -C "$extract_dir"
                ;;
        esac

        # Move extracted directory to version directory
        mv "$extract_dir"/node-v*/* "$extract_dir"/
        rmdir "$extract_dir"/node-v* 2>/dev/null || true
        mkdir -p "$version_dir"
        mv "$extract_dir"/* "$version_dir"/

        trap - EXIT
        rm -rf "$tmp_dir"
    fi

    # Update current symlink
    say "Activating Node.js v$NODE_VERSION..."
    ln -sfn "v$NODE_VERSION" "$node_dir/current"

    # Save metadata
    mkdir -p "$INSTALL_PREFIX/.metadata"
    echo "$NODE_VERSION" > "$INSTALL_PREFIX/.metadata/node-version"
}

# Install CLI
install_cli() {
    cli_dir="$INSTALL_PREFIX/cli"
    version_dir="$cli_dir/$CLI_VERSION"

    # Check if already installed
    if [ -d "$version_dir/package" ] && [ -f "$version_dir/package/devcontainer.js" ]; then
        say "CLI v$CLI_VERSION is already installed"
    else
        say "Downloading CLI v$CLI_VERSION..."

        tmp_dir=$(mktemp -d)
        trap 'rm -rf "$tmp_dir"' EXIT

        cli_url=$(get_cli_url)
        tarball="$tmp_dir/cli.tgz"

        download "$cli_url" "$tarball"

        say "Extracting CLI..."
        mkdir -p "$version_dir"
        tar -xzf "$tarball" -C "$version_dir"

        trap - EXIT
        rm -rf "$tmp_dir"
    fi

    # Update current symlink
    say "Activating CLI v$CLI_VERSION..."
    ln -sfn "$CLI_VERSION" "$cli_dir/current"

    # Save metadata
    mkdir -p "$INSTALL_PREFIX/.metadata"
    echo "$CLI_VERSION" > "$INSTALL_PREFIX/.metadata/installed-version"
}

# Create wrapper script
create_wrapper() {
    bin_dir="$INSTALL_PREFIX/bin"
    wrapper="$bin_dir/devcontainer"

    say "Creating wrapper script..."
    mkdir -p "$bin_dir"

    cat > "$wrapper" << 'WRAPPER_EOF'
#!/bin/sh
# devcontainer CLI wrapper - generated by install.sh
# https://github.com/devcontainers/cli

set -e

# Resolve the installation directory
# Handle both direct execution and symlinked scenarios
if [ -L "$0" ]; then
    # Follow symlink
    SCRIPT_PATH="$(readlink "$0" 2>/dev/null || readlink -f "$0" 2>/dev/null || echo "$0")"
else
    SCRIPT_PATH="$0"
fi

# Get absolute path to script directory
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
INSTALL_DIR="$(dirname "$SCRIPT_DIR")"

# Paths to bundled components
NODE_BIN="$INSTALL_DIR/node/current/bin/node"
CLI_ENTRY="$INSTALL_DIR/cli/current/package/devcontainer.js"

# Verify Node.js exists
if [ ! -x "$NODE_BIN" ]; then
    echo "Error: Node.js not found at $NODE_BIN" >&2
    echo "Installation may be corrupted. Please reinstall:" >&2
    echo "  curl -fsSL https://raw.githubusercontent.com/devcontainers/cli/main/scripts/install.sh | sh" >&2
    exit 1
fi

# Verify CLI exists
if [ ! -f "$CLI_ENTRY" ]; then
    echo "Error: CLI not found at $CLI_ENTRY" >&2
    echo "Installation may be corrupted. Please reinstall:" >&2
    echo "  curl -fsSL https://raw.githubusercontent.com/devcontainers/cli/main/scripts/install.sh | sh" >&2
    exit 1
fi

# Execute the CLI with bundled Node.js
exec "$NODE_BIN" "$CLI_ENTRY" "$@"
WRAPPER_EOF

    chmod +x "$wrapper"
}

# Verify installation
verify_installation() {
    say "Verifying installation..."

    node_bin="$INSTALL_PREFIX/node/current/bin/node"
    cli_entry="$INSTALL_PREFIX/cli/current/package/devcontainer.js"
    wrapper="$INSTALL_PREFIX/bin/devcontainer"

    if [ ! -x "$node_bin" ]; then
        error "Node.js binary not found or not executable"
        exit 1
    fi

    if [ ! -f "$cli_entry" ]; then
        error "CLI entry point not found"
        exit 1
    fi

    if [ ! -x "$wrapper" ]; then
        error "Wrapper script not found or not executable"
        exit 1
    fi

    # Try to get version
    version=$("$wrapper" --version 2>/dev/null || true)
    if [ -n "$version" ]; then
        say "Installed: devcontainer $version"
    else
        warn "Could not verify CLI version, but files are in place"
    fi
}

# Check for existing installation and warn about conflicts
check_existing() {
    # Check for existing devcontainer in PATH
    existing=$(command -v devcontainer 2>/dev/null || true)
    if [ -n "$existing" ]; then
        # Check if it's our installation
        case "$existing" in
            "$INSTALL_PREFIX"*)
                # It's our installation, that's fine
                ;;
            *)
                warn "Found existing devcontainer at: $existing"
                warn "After installation, ensure $INSTALL_PREFIX/bin is first in your PATH"
                ;;
        esac
    fi

    # Check for existing installation directory
    if [ -d "$INSTALL_PREFIX" ] && [ ! "$UPDATE_MODE" = true ]; then
        if [ -f "$INSTALL_PREFIX/.metadata/installed-version" ]; then
            current_version=$(cat "$INSTALL_PREFIX/.metadata/installed-version")
            say "Found existing installation: v$current_version"
            say "Use --update to update, or --uninstall to remove first"
        fi
    fi
}

# Update existing installation
do_update() {
    if [ ! -d "$INSTALL_PREFIX" ] || [ ! -f "$INSTALL_PREFIX/.metadata/installed-version" ]; then
        error "No existing installation found at $INSTALL_PREFIX"
        error "Run without --update to perform a fresh installation"
        exit 1
    fi

    current_cli=$(cat "$INSTALL_PREFIX/.metadata/installed-version" 2>/dev/null || echo "unknown")
    current_node=$(cat "$INSTALL_PREFIX/.metadata/node-version" 2>/dev/null || echo "unknown")

    say "Current installation:"
    say "  CLI: v$current_cli"
    say "  Node.js: v$current_node"

    # Resolve latest versions
    CLI_VERSION="latest"
    resolve_cli_version
    resolve_node_version

    # Update components
    if [ "$current_cli" = "$CLI_VERSION" ]; then
        say "CLI is already up to date"
    else
        say "Updating CLI: v$current_cli -> v$CLI_VERSION"
        install_cli
    fi

    if [ "$current_node" = "$NODE_VERSION" ]; then
        say "Node.js is already up to date"
    else
        say "Updating Node.js: v$current_node -> v$NODE_VERSION"
        install_node
    fi

    # Recreate wrapper in case it changed
    create_wrapper
    verify_installation
}

# Uninstall
do_uninstall() {
    if [ ! -d "$INSTALL_PREFIX" ]; then
        say "Nothing to uninstall at $INSTALL_PREFIX"
        exit 0
    fi

    say "Uninstalling from $INSTALL_PREFIX..."
    rm -rf "$INSTALL_PREFIX"
    say "Uninstallation complete"
    say ""
    say "Don't forget to remove the PATH entry from your shell profile:"
    say "  export PATH=\"$INSTALL_PREFIX/bin:\$PATH\""
}

# Print post-installation instructions
print_instructions() {
    bin_path="$INSTALL_PREFIX/bin"

    echo ""
    say "${BOLD}Installation complete!${RESET}"
    echo ""

    # Check if already in PATH
    case ":$PATH:" in
        *":$bin_path:"*)
            say "The installation directory is already in your PATH."
            say "You can now use: devcontainer --help"
            ;;
        *)
            say "Add the following to your shell profile to use devcontainer:"
            echo ""
            echo "  export PATH=\"$bin_path:\$PATH\""
            echo ""

            # Detect shell and suggest profile file
            shell_name=$(basename "${SHELL:-/bin/sh}")
            case "$shell_name" in
                bash)
                    if [ -f "$HOME/.bash_profile" ]; then
                        say "For bash, add to: ~/.bash_profile"
                    else
                        say "For bash, add to: ~/.bashrc"
                    fi
                    ;;
                zsh)
                    say "For zsh, add to: ~/.zshrc"
                    ;;
                fish)
                    say "For fish, run:"
                    echo "  fish_add_path $bin_path"
                    ;;
                *)
                    say "Add to your shell's profile file"
                    ;;
            esac
            echo ""
            say "Then restart your shell or run:"
            echo "  export PATH=\"$bin_path:\$PATH\""
            ;;
    esac

    echo ""
    say "To update:"
    echo "  curl -fsSL https://raw.githubusercontent.com/devcontainers/cli/main/scripts/install.sh | sh -s -- --update"
    say "To uninstall:"
    echo "  curl -fsSL https://raw.githubusercontent.com/devcontainers/cli/main/scripts/install.sh | sh -s -- --uninstall"
    say "Or simply: rm -rf $INSTALL_PREFIX"
}

# Main function
main() {
    setup_colors
    parse_args "$@"

    echo ""
    say "${BOLD}@devcontainers/cli installer${RESET}"
    echo ""

    # Handle uninstall
    if [ "$UNINSTALL_MODE" = true ]; then
        do_uninstall
        exit 0
    fi

    detect_platform
    say "Platform: $PLATFORM-$ARCH"
    say "Install directory: $INSTALL_PREFIX"

    check_prerequisites
    check_existing

    # Handle update
    if [ "$UPDATE_MODE" = true ]; then
        do_update
        print_instructions
        exit 0
    fi

    # Fresh installation
    resolve_cli_version
    resolve_node_version

    install_node
    install_cli
    create_wrapper
    verify_installation
    print_instructions
}

main "$@"
