export const staticProvisionParams = {
    workspaceMountConsistency: 'cached' as 'cached',
    defaultUserEnvProbe: 'loginInteractiveShell' as 'loginInteractiveShell',
    logFormat: 'text' as 'text',
    removeExistingContainer: false,
    buildNoCache: false,
    expectExistingContainer: false,
    postCreateEnabled: true,
    skipNonBlocking: false,
    prebuild: false,
    additionalMounts: [],
    updateRemoteUserUIDDefault: 'on' as 'on',
    additionalCacheFroms: [],
    dockerPath: undefined,
    dockerComposePath: undefined,
    containerDataFolder: undefined,
    containerSystemDataFolder: undefined,
    configFile: undefined,
    overrideConfigFile: undefined,
    persistedFolder: undefined,
    terminalDimensions: undefined,
    useBuildKit: 'auto' as 'auto',
    buildxPlatform: undefined,
    buildxPush: false,
    buildxOutput: undefined,
    buildxCacheTo: undefined,
    skipPostAttach: false,
};

export const staticExecParams = {
    'user-data-folder': undefined,
    'docker-path': undefined,
    'docker-compose-path': undefined,
    'container-data-folder': undefined,
    'container-system-data-folder': undefined,
    'id-label': undefined,
    'config': undefined,
    'override-config': undefined,
    'terminal-rows': undefined,
    'terminal-columns': undefined,
    'container-id': undefined,
    'mount-workspace-git-root': true,
    'log-level': 'info' as 'info',
    'log-format': 'text' as 'text',
    'default-user-env-probe': 'loginInteractiveShell' as 'loginInteractiveShell',
};

export interface LaunchResult {
    disposables?: (() => Promise<unknown> | undefined)[];
    containerId: string;
    remoteUser?: string;
    remoteWorkspaceFolder?: string | undefined;
    finishBackgroundTasks?: () => Promise<void>;
    containerHost?: string;
    containerPort?: any;
}

// dev-container-features-test-lib
export const testLibraryScript = `
SCRIPT_FOLDER="$(cd "$(dirname $0)" && pwd)"
USERNAME=\${1:-root}
export TERM=\${TERM:-dumb}

if [ -z $HOME ]; then
    HOME="/root"
fi

FAILED=""

check() {
    LABEL=$1
    shift
    printf "\n🔄 Testing '%s'%s" "\${LABEL}" "$(tput setaf 7)"
    if "$@"; then
        printf "\n✅  Passed '%s'!" "\${LABEL}"
        return 0
    else
        printf "\n"
        printf "❌ %s check failed." "\${LABEL}" >&2
        FAILED="\${FAILED}\n\${LABEL}"
        return 1
    fi
}

checkMultiple() {
    PASSED=0
    LABEL="$1"
    printf "\n🔄 Testing '%s'." "\${LABEL}"
    shift; MINIMUMPASSED=$1
    shift; EXPRESSION="$1"
    while [ "$EXPRESSION" != "" ]; do
        if $EXPRESSION; then PASSED=$((PASSED+1)); fi
        shift; EXPRESSION=$1
    done
    if [ $PASSED -ge $MINIMUMPASSED ]; then
        printf "\n✅ Passed!"
        return 0
    else
        printf "\n"
        printf "❌ '%s' check failed." "\${LABEL}" >&2
        FAILED="\${FAILED}\n\${LABEL}"
        return 1
    fi
}

reportResults() {
    if [ "\${FAILED}" ]; then
        printf "\n"
        printf "💥  Failed tests: %s" "\${FAILED}" >&2
        exit 1
    else
        printf "\nTest Passed!"
        exit 0
    fi
}`;
