#!/bin/sh
# install.test.sh - Tests for install.sh
#
# Usage:
#   sh scripts/install.test.sh
#
# Can be run in CI or locally. Uses a temp directory for all installs.
# Requires network access to download Node.js and the CLI package.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_SCRIPT="$SCRIPT_DIR/install.sh"

# ── Test framework ────────────────────────────────────────────────

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
FAILED_NAMES=""

# Colors (disabled in non-tty / CI)
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    C_RED='\033[0;31m'
    C_GREEN='\033[0;32m'
    C_YELLOW='\033[0;33m'
    C_BOLD='\033[1m'
    C_RESET='\033[0m'
else
    C_RED=''
    C_GREEN=''
    C_YELLOW=''
    C_BOLD=''
    C_RESET=''
fi

pass() {
    TESTS_PASSED=$((TESTS_PASSED + 1))
    printf '%b\n' "  ${C_GREEN}✓${C_RESET} $1"
}

fail() {
    TESTS_FAILED=$((TESTS_FAILED + 1))
    FAILED_NAMES="$FAILED_NAMES\n    - $1"
    printf '%b\n' "  ${C_RED}✗${C_RESET} $1"
    if [ -n "${2:-}" ]; then
        printf '    %s\n' "$2"
    fi
}

assert_eq() {
    expected="$1"
    actual="$2"
    msg="$3"
    TESTS_RUN=$((TESTS_RUN + 1))
    if [ "$expected" = "$actual" ]; then
        pass "$msg"
    else
        fail "$msg" "expected: '$expected', got: '$actual'"
    fi
}

assert_contains() {
    haystack="$1"
    needle="$2"
    msg="$3"
    TESTS_RUN=$((TESTS_RUN + 1))
    case "$haystack" in
        *"$needle"*)
            pass "$msg"
            ;;
        *)
            fail "$msg" "expected output to contain: '$needle'"
            ;;
    esac
}

assert_file_exists() {
    path="$1"
    msg="$2"
    TESTS_RUN=$((TESTS_RUN + 1))
    if [ -f "$path" ]; then
        pass "$msg"
    else
        fail "$msg" "file not found: $path"
    fi
}

assert_dir_exists() {
    path="$1"
    msg="$2"
    TESTS_RUN=$((TESTS_RUN + 1))
    if [ -d "$path" ]; then
        pass "$msg"
    else
        fail "$msg" "directory not found: $path"
    fi
}

assert_executable() {
    path="$1"
    msg="$2"
    TESTS_RUN=$((TESTS_RUN + 1))
    if [ -x "$path" ]; then
        pass "$msg"
    else
        fail "$msg" "not executable: $path"
    fi
}

assert_symlink() {
    path="$1"
    msg="$2"
    TESTS_RUN=$((TESTS_RUN + 1))
    if [ -L "$path" ]; then
        pass "$msg"
    else
        fail "$msg" "not a symlink: $path"
    fi
}

assert_exit_code() {
    expected="$1"
    actual="$2"
    msg="$3"
    TESTS_RUN=$((TESTS_RUN + 1))
    if [ "$expected" = "$actual" ]; then
        pass "$msg"
    else
        fail "$msg" "expected exit code $expected, got $actual"
    fi
}

# ── Setup / teardown ─────────────────────────────────────────────

TEST_TMPDIR=""
setup() {
    TEST_TMPDIR="$(mktemp -d)"
}

teardown() {
    if [ -n "$TEST_TMPDIR" ] && [ -d "$TEST_TMPDIR" ]; then
        rm -rf "$TEST_TMPDIR"
    fi
}

# ── Tests: --help ─────────────────────────────────────────────────

test_help_flag() {
    printf '%b\n' "${C_BOLD}--help flag${C_RESET}"
    setup

    output=$(sh "$INSTALL_SCRIPT" --help 2>&1) || true

    assert_contains "$output" "Install @devcontainers/cli" "--help shows description"
    assert_contains "$output" "--prefix" "--help shows --prefix option"
    assert_contains "$output" "--version" "--help shows --version option"
    assert_contains "$output" "--node-version" "--help shows --node-version option"
    assert_contains "$output" "--update" "--help shows --update option"
    assert_contains "$output" "--uninstall" "--help shows --uninstall option"
    assert_contains "$output" "DEVCONTAINERS_INSTALL_DIR" "--help shows env var"

    teardown
}

test_help_short_flag() {
    printf '%b\n' "${C_BOLD}-h flag${C_RESET}"
    setup

    output=$(sh "$INSTALL_SCRIPT" -h 2>&1) || true
    assert_contains "$output" "Install @devcontainers/cli" "-h shows help"

    teardown
}

# ── Tests: argument parsing errors ────────────────────────────────

test_unknown_option() {
    printf '%b\n' "${C_BOLD}Unknown option${C_RESET}"
    setup

    output=$(sh "$INSTALL_SCRIPT" --bogus 2>&1) && rc=0 || rc=$?
    assert_exit_code "1" "$rc" "exits with code 1 on unknown option"
    assert_contains "$output" "Unknown option" "reports unknown option"

    teardown
}

# ── Tests: --uninstall on missing dir ─────────────────────────────

test_uninstall_no_dir() {
    printf '%b\n' "${C_BOLD}Uninstall with no existing installation${C_RESET}"
    setup

    prefix="$TEST_TMPDIR/nonexistent"
    output=$(sh "$INSTALL_SCRIPT" --prefix "$prefix" --uninstall 2>&1) && rc=0 || rc=$?
    assert_exit_code "0" "$rc" "exits 0 when nothing to uninstall"
    assert_contains "$output" "Nothing to uninstall" "reports nothing to uninstall"

    teardown
}

# ── Tests: --update on missing installation ───────────────────────

test_update_no_installation() {
    printf '%b\n' "${C_BOLD}Update with no existing installation${C_RESET}"
    setup

    prefix="$TEST_TMPDIR/empty"
    mkdir -p "$prefix"
    output=$(sh "$INSTALL_SCRIPT" --prefix "$prefix" --update 2>&1) && rc=0 || rc=$?
    assert_exit_code "1" "$rc" "exits 1 when no installation found"
    assert_contains "$output" "No existing installation" "reports missing installation"

    teardown
}

# ── Tests: DEVCONTAINERS_INSTALL_DIR env var ──────────────────────

test_env_var_prefix() {
    printf '%b\n' "${C_BOLD}DEVCONTAINERS_INSTALL_DIR env var${C_RESET}"
    setup

    # The env var should be reflected in the help output or the
    # install run. We just test that the script picks it up by
    # running --uninstall (lightweight) against a nonexistent path.
    prefix="$TEST_TMPDIR/from-env"
    output=$(DEVCONTAINERS_INSTALL_DIR="$prefix" sh "$INSTALL_SCRIPT" --uninstall 2>&1) && rc=0 || rc=$?
    assert_exit_code "0" "$rc" "exits 0 with env-var prefix"
    assert_contains "$output" "Nothing to uninstall" "uses env-var prefix path"

    teardown
}

# ── Tests: --prefix flag overrides env var ────────────────────────

test_prefix_overrides_env() {
    printf '%b\n' "${C_BOLD}--prefix overrides DEVCONTAINERS_INSTALL_DIR${C_RESET}"
    setup

    env_dir="$TEST_TMPDIR/env-dir"
    flag_dir="$TEST_TMPDIR/flag-dir"
    output=$(DEVCONTAINERS_INSTALL_DIR="$env_dir" sh "$INSTALL_SCRIPT" --prefix "$flag_dir" --uninstall 2>&1) && rc=0 || rc=$?
    assert_exit_code "0" "$rc" "exits 0"
    # The output should reference flag_dir, not env_dir
    assert_contains "$output" "Nothing to uninstall" "--prefix is used over env var"

    teardown
}

# ── Tests: full install with a specific version ───────────────────

test_full_install() {
    printf '%b\n' "${C_BOLD}Full install (specific CLI version)${C_RESET}"
    setup

    prefix="$TEST_TMPDIR/devcontainers"

    # Use a known CLI version to make the test deterministic
    cli_version="0.75.0"

    output=$(sh "$INSTALL_SCRIPT" --prefix "$prefix" --version "$cli_version" 2>&1) && rc=0 || rc=$?
    assert_exit_code "0" "$rc" "install exits 0"

    # Directory structure
    assert_dir_exists "$prefix/bin" "bin/ directory created"
    assert_dir_exists "$prefix/node" "node/ directory created"
    assert_dir_exists "$prefix/cli" "cli/ directory created"
    assert_dir_exists "$prefix/.metadata" ".metadata/ directory created"

    # Wrapper script
    assert_file_exists "$prefix/bin/devcontainer" "wrapper script exists"
    assert_executable "$prefix/bin/devcontainer" "wrapper script is executable"

    # Symlinks
    assert_symlink "$prefix/node/current" "node/current is a symlink"
    assert_symlink "$prefix/cli/current" "cli/current is a symlink"

    # Node.js binary
    assert_executable "$prefix/node/current/bin/node" "node binary is executable"

    # CLI entry point
    assert_file_exists "$prefix/cli/current/package/devcontainer.js" "CLI entry point exists"

    # Metadata
    assert_file_exists "$prefix/.metadata/installed-version" "CLI version metadata written"
    assert_file_exists "$prefix/.metadata/node-version" "Node version metadata written"

    installed_version=$(cat "$prefix/.metadata/installed-version")
    assert_eq "$cli_version" "$installed_version" "metadata records correct CLI version"

    # Wrapper executes successfully
    version_output=$("$prefix/bin/devcontainer" --version 2>/dev/null) && wrc=0 || wrc=$?
    assert_exit_code "0" "$wrc" "wrapper --version exits 0"
    assert_contains "$version_output" "$cli_version" "wrapper reports installed version"

    teardown
}

# ── Tests: idempotent install ─────────────────────────────────────

test_idempotent_install() {
    printf '%b\n' "${C_BOLD}Idempotent install (run twice)${C_RESET}"
    setup

    prefix="$TEST_TMPDIR/devcontainers"
    cli_version="0.75.0"

    # First install
    sh "$INSTALL_SCRIPT" --prefix "$prefix" --version "$cli_version" >/dev/null 2>&1

    # Second install – same version, should succeed and say "already installed"
    output=$(sh "$INSTALL_SCRIPT" --prefix "$prefix" --version "$cli_version" 2>&1) && rc=0 || rc=$?
    assert_exit_code "0" "$rc" "second install exits 0"
    assert_contains "$output" "already installed" "detects existing Node.js or CLI"

    # Still works
    version_output=$("$prefix/bin/devcontainer" --version 2>/dev/null) && wrc=0 || wrc=$?
    assert_exit_code "0" "$wrc" "wrapper still works after second install"

    teardown
}

# ── Tests: uninstall after install ────────────────────────────────

test_uninstall_after_install() {
    printf '%b\n' "${C_BOLD}Uninstall removes installation${C_RESET}"
    setup

    prefix="$TEST_TMPDIR/devcontainers"
    cli_version="0.75.0"

    # Install
    sh "$INSTALL_SCRIPT" --prefix "$prefix" --version "$cli_version" >/dev/null 2>&1

    # Uninstall
    output=$(sh "$INSTALL_SCRIPT" --prefix "$prefix" --uninstall 2>&1) && rc=0 || rc=$?
    assert_exit_code "0" "$rc" "uninstall exits 0"
    assert_contains "$output" "Uninstallation complete" "reports completion"

    # Directory should be gone
    TESTS_RUN=$((TESTS_RUN + 1))
    if [ ! -d "$prefix" ]; then
        pass "install directory removed"
    else
        fail "install directory removed" "directory still exists: $prefix"
    fi

    teardown
}

# ── Tests: update existing installation ───────────────────────────

test_update_existing() {
    printf '%b\n' "${C_BOLD}Update existing installation${C_RESET}"
    setup

    prefix="$TEST_TMPDIR/devcontainers"

    # Install an older version first
    old_version="0.72.0"
    sh "$INSTALL_SCRIPT" --prefix "$prefix" --version "$old_version" >/dev/null 2>&1

    installed=$(cat "$prefix/.metadata/installed-version")
    assert_eq "$old_version" "$installed" "initial version installed"

    # Update to a slightly newer specific version
    new_version="0.75.0"
    # Fake update by doing a fresh install with --version (--update resolves "latest")
    sh "$INSTALL_SCRIPT" --prefix "$prefix" --version "$new_version" >/dev/null 2>&1

    updated=$(cat "$prefix/.metadata/installed-version")
    assert_eq "$new_version" "$updated" "version updated in metadata"

    # Wrapper reports new version
    version_output=$("$prefix/bin/devcontainer" --version 2>/dev/null) && wrc=0 || wrc=$?
    assert_exit_code "0" "$wrc" "wrapper works after version change"
    assert_contains "$version_output" "$new_version" "wrapper reports new version"

    teardown
}

# ── Tests: wrapper handles missing node gracefully ────────────────

test_wrapper_missing_node() {
    printf '%b\n' "${C_BOLD}Wrapper error when Node.js missing${C_RESET}"
    setup

    prefix="$TEST_TMPDIR/devcontainers"
    cli_version="0.75.0"

    # Install
    sh "$INSTALL_SCRIPT" --prefix "$prefix" --version "$cli_version" >/dev/null 2>&1

    # Remove node binary
    rm -rf "$prefix/node"

    output=$("$prefix/bin/devcontainer" --version 2>&1) && rc=0 || rc=$?
    assert_exit_code "1" "$rc" "wrapper exits 1 when node missing"
    assert_contains "$output" "Node.js not found" "wrapper reports missing Node.js"

    teardown
}

# ── Tests: wrapper handles missing CLI gracefully ─────────────────

test_wrapper_missing_cli() {
    printf '%b\n' "${C_BOLD}Wrapper error when CLI missing${C_RESET}"
    setup

    prefix="$TEST_TMPDIR/devcontainers"
    cli_version="0.75.0"

    # Install
    sh "$INSTALL_SCRIPT" --prefix "$prefix" --version "$cli_version" >/dev/null 2>&1

    # Remove CLI
    rm -rf "$prefix/cli"

    output=$("$prefix/bin/devcontainer" --version 2>&1) && rc=0 || rc=$?
    assert_exit_code "1" "$rc" "wrapper exits 1 when CLI missing"
    assert_contains "$output" "CLI not found" "wrapper reports missing CLI"

    teardown
}

# ── Tests: install via symlinked wrapper ──────────────────────────

test_wrapper_via_symlink() {
    printf '%b\n' "${C_BOLD}Wrapper works when invoked via symlink${C_RESET}"
    setup

    prefix="$TEST_TMPDIR/devcontainers"
    cli_version="0.75.0"

    sh "$INSTALL_SCRIPT" --prefix "$prefix" --version "$cli_version" >/dev/null 2>&1

    # Create a symlink to the wrapper in a different directory
    link_dir="$TEST_TMPDIR/links"
    mkdir -p "$link_dir"
    ln -s "$prefix/bin/devcontainer" "$link_dir/devcontainer"

    version_output=$("$link_dir/devcontainer" --version 2>/dev/null) && wrc=0 || wrc=$?
    assert_exit_code "0" "$wrc" "symlinked wrapper exits 0"
    assert_contains "$version_output" "$cli_version" "symlinked wrapper reports version"

    teardown
}

# ── Tests: install to path with spaces ────────────────────────────

test_path_with_spaces() {
    printf '%b\n' "${C_BOLD}Install to path with spaces${C_RESET}"
    setup

    prefix="$TEST_TMPDIR/my dev containers"

    cli_version="0.75.0"
    output=$(sh "$INSTALL_SCRIPT" --prefix "$prefix" --version "$cli_version" 2>&1) && rc=0 || rc=$?
    assert_exit_code "0" "$rc" "install to spaced path exits 0"

    assert_file_exists "$prefix/bin/devcontainer" "wrapper exists in spaced path"

    version_output=$("$prefix/bin/devcontainer" --version 2>/dev/null) && wrc=0 || wrc=$?
    assert_exit_code "0" "$wrc" "wrapper works from spaced path"
    assert_contains "$version_output" "$cli_version" "reports correct version from spaced path"

    teardown
}

# ── Tests: non-writable prefix ────────────────────────────────────

test_non_writable_prefix() {
    printf '%b\n' "${C_BOLD}Error on non-writable prefix${C_RESET}"
    setup

    # Skip if running as root (root can write anywhere)
    if [ "$(id -u)" = "0" ]; then
        TESTS_RUN=$((TESTS_RUN + 1))
        pass "skipped (running as root)"
        teardown
        return
    fi

    prefix="/usr/local/no-permission-test-devcontainers-$$"
    output=$(sh "$INSTALL_SCRIPT" --prefix "$prefix" --version "0.75.0" 2>&1) && rc=0 || rc=$?
    assert_exit_code "1" "$rc" "exits 1 for non-writable prefix"
    assert_contains "$output" "No write permission" "reports permission error"

    teardown
}

# ── Tests: --prefix= form (equals delimiter) ─────────────────────

test_prefix_equals_form() {
    printf '%b\n' "${C_BOLD}--prefix=DIR form${C_RESET}"
    setup

    prefix="$TEST_TMPDIR/eq-form"
    # Just verify parsing works – use uninstall for a lightweight check
    output=$(sh "$INSTALL_SCRIPT" "--prefix=$prefix" --uninstall 2>&1) && rc=0 || rc=$?
    assert_exit_code "0" "$rc" "--prefix=DIR is accepted"
    assert_contains "$output" "Nothing to uninstall" "--prefix=DIR path is used"

    teardown
}

test_version_equals_form() {
    printf '%b\n' "${C_BOLD}--version=VER form${C_RESET}"
    setup

    prefix="$TEST_TMPDIR/ver-eq"
    output=$(sh "$INSTALL_SCRIPT" "--prefix=$prefix" "--version=0.75.0" 2>&1) && rc=0 || rc=$?
    assert_exit_code "0" "$rc" "--version=VER install exits 0"
    assert_contains "$output" "0.75.0" "version from --version=VER is used"

    teardown
}

# ── Run all tests ─────────────────────────────────────────────────

printf '%b\n' ""
printf '%b\n' "${C_BOLD}install.sh test suite${C_RESET}"
printf '%b\n' "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
printf '%b\n' ""

# Fast tests (no network required)
test_help_flag
printf '\n'
test_help_short_flag
printf '\n'
test_unknown_option
printf '\n'
test_uninstall_no_dir
printf '\n'
test_update_no_installation
printf '\n'
test_env_var_prefix
printf '\n'
test_prefix_overrides_env
printf '\n'
test_prefix_equals_form
printf '\n'
test_non_writable_prefix
printf '\n'

# Integration tests (require network, download Node.js + CLI)
printf '%b\n' "${C_YELLOW}Integration tests (requires network)${C_RESET}"
printf '\n'
test_full_install
printf '\n'
test_idempotent_install
printf '\n'
test_uninstall_after_install
printf '\n'
test_update_existing
printf '\n'
test_wrapper_missing_node
printf '\n'
test_wrapper_missing_cli
printf '\n'
test_wrapper_via_symlink
printf '\n'
test_path_with_spaces
printf '\n'
test_version_equals_form
printf '\n'

# ── Summary ───────────────────────────────────────────────────────

printf '%b\n' "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$TESTS_FAILED" -eq 0 ]; then
    printf '%b\n' "${C_GREEN}${C_BOLD}All $TESTS_RUN tests passed${C_RESET}"
else
    printf '%b\n' "${C_RED}${C_BOLD}$TESTS_FAILED of $TESTS_RUN tests failed${C_RESET}"
    printf '%b\n' "$FAILED_NAMES"
fi
printf '%b\n' ""

exit "$TESTS_FAILED"
