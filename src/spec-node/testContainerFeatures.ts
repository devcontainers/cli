import { tmpdir } from 'os';
import path from 'path';
import { CLIHost } from '../spec-common/cliHost';
import { LogLevel } from '../spec-utils/log';
import { launch, ProvisionOptions } from './devContainers';
import { doExec } from './devContainersSpecCLI';

const GREEN = ''; //'\033[0;32m';
const RED = ''; //'\033[0;91m';
const NC = ''; //'\033[0m';

function fail(msg: string) {
    process.stderr.write(`${RED}[-] ${msg}${NC}\n`);
    process.exit(1);
}

function log(msg: string) {
    process.stdout.write(`${GREEN}[+] ${msg}${NC}\n`);
}

export async function doFeaturesTestCommand(
    cliHost: CLIHost,
    baseImage: string,
    pathToCollection: string,
    commaSeparatedFeatures: string
) {
    process.stdout.write(`
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
|    dev container 'features' |   
│     Testing Tool v0.0.0     │
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘\n\n`);

    process.stdout.write(`baseImage:         ${baseImage}\n`);
    process.stdout.write(`pathToCollection:  ${pathToCollection}\n`);
    process.stdout.write(`features:          ${commaSeparatedFeatures}\n\n\n`);

    const features = commaSeparatedFeatures.split(',');

    if (features.length === 0) {
        process.stderr.write('No features specified\n');
        process.exit(1);
    }

    // 1. Generate temporary project with 'baseImage' and all the 'features..'
    const workspaceFolder = await generateProject(
        cliHost,
        baseImage,
        pathToCollection,
        features
    );

    log(`workspaceFolder: ${workspaceFolder}`);

    // 1.5. Provide a way to pass options nicely via CLI (or have test config file maybe?)

    // 2. Use  'devcontainer-cli up'  to build and start a container
    const launchResult = await launchProject(workspaceFolder);

    if (!launchResult) {
        fail('Failed to build and launch project\n');
    }

    // 3. Exec test script for each feature, in the provided order.
    for (const f of features) {
        const testScriptPath = path.join(pathToCollection, f, 'test.sh');
        if (!(await cliHost.isFile(testScriptPath))) {
            fail(`Feature ${f} does not have a test script!`);
        }
        // Move the test script into the workspaceFolder
        const testScript = await cliHost.readFile(testScriptPath);
        const remoteTestScriptName = `${f}-test-${Date.now()}.sh`;
        await cliHost.writeFile(`${workspaceFolder}/${remoteTestScriptName}`, testScript);

        /*const testResult =*/ await execTest(remoteTestScriptName, workspaceFolder);
    }

    // 4. Watch for non-zero exit codes.

    process.exit(0);
}

const devcontainerTemplate = `
{
    "image": "#{IMAGE}",
    "features": {
        #{FEATURES}
    }
}`;

async function createTempDevcontainerFolder(cliHost: CLIHost): Promise<string> {
    const systemTmpDir = tmpdir();
    const tmpFolder = path.join(systemTmpDir, 'vsch', 'container-features-test', Date.now().toString());
    await cliHost.mkdirp(`${tmpFolder}/.devcontainer`);
    return tmpFolder;
}

async function generateProject(
    cliHost: CLIHost,
    baseImage: string,
    basePathToCollection: string,
    featuresToTest: string[]
): Promise<string> {
    const tmpFolder = await createTempDevcontainerFolder(cliHost);

    const features = featuresToTest
        .map((x) => `"${basePathToCollection}/${x}": "latest"`)
        .join(',\n');

    let template = devcontainerTemplate
        .replace('#{IMAGE}', baseImage)
        .replace('#{FEATURES}', features);

    await cliHost.writeFile(`${tmpFolder}/.devcontainer/devcontainer.json`, Buffer.from(template));

    return tmpFolder;
}

async function launchProject(workspaceFolder: string) {

    const options: ProvisionOptions = {
        workspaceFolder,
        logLevel: LogLevel.Trace,
        workspaceMountConsistency: 'cached',
        mountWorkspaceGitRoot: true,
        idLabels: [
            `devcontainer.local_folder=${workspaceFolder}`
        ],
        logFormat: 'text',
        defaultUserEnvProbe: 'loginInteractiveShell',
        removeExistingContainer: false,
        buildNoCache: false,
        expectExistingContainer: false,
        postCreateEnabled: true,
        skipNonBlocking: false,
        prebuild: false,
        additionalMounts: [],
        updateRemoteUserUIDDefault: 'on',
        remoteEnv: {},
        additionalCacheFroms: [],
        dockerPath: undefined,
        dockerComposePath: undefined,
        containerDataFolder: undefined,
        containerSystemDataFolder: undefined,
        configFile: undefined,
        overrideConfigFile: undefined,
        log: function (text: string): void {
            process.stdout.write(text);
        },
        terminalDimensions: undefined,
        persistedFolder: undefined
    };

    const disposables: (() => Promise<unknown> | undefined)[] = [];
    const launchResult = await launch(options, disposables);


    const { containerId, remoteUser, remoteWorkspaceFolder } = launchResult;
    log(`launched container ${containerId} for user ${remoteUser} \n`);

    return {
        containerId,
        remoteUser,
        remoteWorkspaceFolder
    };
}

async function execTest(remoteTestScriptName: string, workspaceFolder: string) {
    let cmd = 'chmod';
    let args = ['777', `./${remoteTestScriptName}`];
    await exec(cmd, args, workspaceFolder);

    cmd = `./${remoteTestScriptName}`;
    args = [];
    await exec(cmd, args, workspaceFolder);


}

async function exec(cmd: string, args: string[], workspaceFolder: string) {
    const execArgs = {
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
        'remote-env': undefined,
        'container-id': undefined,
        'workspace-folder': workspaceFolder,
        'mount-workspace-git-root': true,
        'log-level': 'info' as 'info',
        'log-format': 'text' as 'text',
        'default-user-env-probe': 'loginInteractiveShell' as 'loginInteractiveShell',
        cmd,
        args,
        _: [
            cmd,
            ...args
        ]
    };
    const result = await doExec(execArgs);
    log(JSON.stringify(result, null, 2));

    // return

}