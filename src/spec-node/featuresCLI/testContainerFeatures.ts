import path from 'path';
import chalk from 'chalk';
import { tmpdir } from 'os';
import { CLIHost } from '../../spec-common/cliHost';
import { LogLevel } from '../../spec-utils/log';
import { launch, ProvisionOptions, createDockerParams } from '../devContainers';
import { doExec, FeaturesTestCommandInput } from '../devContainersSpecCLI';
import { LaunchResult, staticExecParams, staticProvisionParams, testLibraryScript } from './utils';
import { DockerResolverParameters } from '../utils';

const TEST_LIBRARY_SCRIPT_NAME = 'dev-container-features-test-lib';

function fail(msg: string) {
    log(msg, { prefix: '[-]', stderr: true });
    process.exit(1);
}

function log(msg: string, options?: { prefix?: string; info?: boolean; stderr?: boolean }) {

    const prefix = options?.prefix || '> ';
    const output = `${prefix} ${msg}\n`;

    if (options?.stderr) {
        process.stderr.write(chalk.red(output));
    } else if (options?.info) {
        process.stdout.write(chalk.bold.blue(output));
    } else {
        process.stdout.write(chalk.blue(output));
    }
}

function printFailedTest(feature: string) {
    log(`TEST FAILED:  ${feature}`, { prefix: '[-]', stderr: true });
}


export async function doFeaturesTestCommand(args: FeaturesTestCommandInput): Promise<number> {
    const { baseImage, collectionFolder, remoteUser, cliHost, pkg, logLevel, quiet, disposables } = args;
    let { features } = args;

    process.stdout.write(`
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
|    dev container 'features' |   
│     Testing v${pkg.version}          │
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘\n\n`);

    const srcDir = `${collectionFolder}/src`;
    const testsDir = `${collectionFolder}/test`;

    if (! await cliHost.isFolder(srcDir) || ! await cliHost.isFolder(testsDir)) {
        fail(`Folder '${collectionFolder}' does not contain the required 'src' and 'test' folders.`);
    }


    log(`baseImage:         ${baseImage}`);
    log(`Target Folder:     ${collectionFolder}`);

    // Parse comma separated list of features
    // If a set of '--features' isn't specified, run all features with a 'test' subfolder in random order.
    if (!features) {
        features = await cliHost.readDir(testsDir);
        if (features.length === 0) {
            fail(`No features specified and no test folders found in '${testsDir}'`);
        }
    }

    log(`features:          ${features.join(', ')}`);


    // 1. Generate temporary project with 'baseImage' and all the 'features..'
    const workspaceFolder = await generateProject(
        cliHost,
        baseImage,
        collectionFolder,
        features,
        remoteUser
    );

    log(`workspaceFolder:   ${workspaceFolder}`);

    const params = await generateDockerParams(workspaceFolder, logLevel, quiet, disposables);

    // 1.5. Provide a way to pass options nicely via CLI (or have test config file maybe?)

    // 2. Use  'devcontainer-cli up'  to build and start a container
    log('Building test container...\n', { prefix: '\n⏳', info: true });
    const launchResult: LaunchResult | undefined = await launchProject(params, workspaceFolder, quiet, disposables);
    if (!launchResult || !launchResult.containerId) {
        fail('Failed to launch container');
        return 2;
    }

    const { containerId } = launchResult;

    log(`Launched container.`, { prefix: '\n🚀', info: true });
    log(`containerId:          ${containerId}`);
    log(`remoteUser:           ${remoteUser}`);


    log('Starting test(s)...\n', { prefix: '\n🏃', info: true });

    // 3. Exec test script for each feature, in the provided order.
    const testResults = [];
    for (const feature of features) {
        log(`Executing '${feature}' test...`, { prefix: '🧪' });
        const testScriptPath = path.join(collectionFolder, 'test', feature, 'test.sh');
        if (!(await cliHost.isFile(testScriptPath))) {
            fail(`Feature ${feature} does not have a test script!`);
        }

        // Move the test script into the workspaceFolder
        const testScript = await cliHost.readFile(testScriptPath);
        const remoteTestScriptName = `${feature}-test-${Date.now()}.sh`;
        await cliHost.writeFile(`${workspaceFolder}/${remoteTestScriptName}`, testScript);

        // Move the test library script into the workspaceFolder
        await cliHost.writeFile(`${workspaceFolder}/${TEST_LIBRARY_SCRIPT_NAME}`, Buffer.from(testLibraryScript));

        // Execute Test
        const result = await execTest(params, remoteTestScriptName, workspaceFolder);
        testResults.push({
            feature,
            result,
        });
    }

    // 4. Print results
    const allPassed = testResults.every((x) => x.result);
    if (!allPassed) {
        testResults.filter((x) => !x.result).forEach((x) => {
            printFailedTest(x.feature);
        });
    } else {
        log('All tests passed!', { prefix: '\n✅', info: true });
    }

    return allPassed ? 0 : 1;
}

const devcontainerTemplate = `
{
    "image": "#{IMAGE}",
    "features": {
        #{FEATURES}
    },
    "remoteUser": "#{REMOTE_USER}"
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
    targetDirectory: string,
    featuresToTest: string[],
    remoteUser: string
): Promise<string> {
    const tmpFolder = await createTempDevcontainerFolder(cliHost);

    const features = featuresToTest
        .map((x) => `"${targetDirectory}/src/${x}": "latest"`)
        .join(',\n');

    let template = devcontainerTemplate
        .replace('#{IMAGE}', baseImage)
        .replace('#{FEATURES}', features)
        .replace('#{REMOTE_USER}', remoteUser);

    await cliHost.writeFile(`${tmpFolder}/.devcontainer/devcontainer.json`, Buffer.from(template));

    return tmpFolder;
}

async function launchProject(params: DockerResolverParameters, workspaceFolder: string, quiet: boolean, disposables: (() => Promise<unknown> | undefined)[]): Promise<LaunchResult> {
    const { common } = params;
    let response = {} as LaunchResult;

    const options: ProvisionOptions = {
        ...staticProvisionParams,
        workspaceFolder,
        logLevel: common.getLogLevel(),
        mountWorkspaceGitRoot: true,
        idLabels: [
            `devcontainer.local_folder=${workspaceFolder}`
        ],
        remoteEnv: common.remoteEnv,
        log: text => quiet ? null : process.stderr.write(text),
    };
    if (quiet) {
        // Launch container but don't await it to reduce output noise
        let isResolved = false;
        const p = launch(options, disposables);
        p.then(function (res) {
            process.stdout.write('\n');
            response = res;
            isResolved = true;
        });
        while (!isResolved) {
            // Just so visual progress with dots
            process.stdout.write('.');
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    } else {
        // Stream all the container setup logs.
        response = await launch(options, disposables);
    }

    return {
        ...response,
        disposables,
    };

}

async function execTest(params: DockerResolverParameters, remoteTestScriptName: string, workspaceFolder: string) {
    let cmd = 'chmod';
    let args = ['777', `./${remoteTestScriptName}`, `./${TEST_LIBRARY_SCRIPT_NAME}`];
    await exec(params, cmd, args, workspaceFolder);


    cmd = `./${remoteTestScriptName}`;
    args = [];
    return await exec(params, cmd, args, workspaceFolder);
}

async function exec(_params: DockerResolverParameters, cmd: string, args: string[], workspaceFolder: string) {
    const execArgs = {
        ...staticExecParams,
        'workspace-folder': workspaceFolder,
        cmd,
        args,
        _: [
            cmd,
            ...args
        ]
    };
    const result = await doExec(execArgs);
    return (result.outcome === 'success');
}

async function generateDockerParams(workspaceFolder: string, logLevel: LogLevel, quiet: boolean, disposables: (() => Promise<unknown> | undefined)[]): Promise<DockerResolverParameters> {
    return await createDockerParams({
        workspaceFolder,
        dockerPath: undefined,
        dockerComposePath: undefined,
        containerDataFolder: undefined,
        containerSystemDataFolder: undefined,
        mountWorkspaceGitRoot: false,
        idLabels: [],
        configFile: undefined,
        overrideConfigFile: undefined,
        logLevel,
        logFormat: 'text',
        log: text => quiet ? null : process.stderr.write(text),
        terminalDimensions: undefined,
        defaultUserEnvProbe: 'loginInteractiveShell',
        removeExistingContainer: false,
        buildNoCache: false,
        expectExistingContainer: false,
        postCreateEnabled: false,
        skipNonBlocking: false,
        prebuild: false,
        persistedFolder: undefined,
        additionalMounts: [],
        updateRemoteUserUIDDefault: 'never',
        remoteEnv: {},
        additionalCacheFroms: [],
        omitLoggerHeader: true,
        useBuildKit: 'auto'
    }, disposables);
}
