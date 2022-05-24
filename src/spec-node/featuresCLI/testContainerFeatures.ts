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

    const prefix = options?.prefix || '[+]';
    const output = `${prefix} ${msg}\n`;

    if (options?.stderr) {
        process.stderr.write(chalk.red(output));
    } else if (options?.info) {
        process.stdout.write(chalk.bold.blue(output));
    } else {
        process.stdout.write(chalk.green(output));
    }
}

function printFailedTest(feature: string) {
    log(`TEST FAILED:  ${feature}`, { prefix: '[-]', stderr: true });
}


export async function doFeaturesTestCommand(args: FeaturesTestCommandInput): Promise<number> {
    const { baseImage, collectionFolder, remoteUser, quiet, cliHost, pkg, disposables } = args;
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

    const params = await generateDockerParams(workspaceFolder, disposables);

    // 1.5. Provide a way to pass options nicely via CLI (or have test config file maybe?)

    // 2. Use  'devcontainer-cli up'  to build and start a container
    log('\n>>> Building test container... <<<\n\n', { prefix: ' ', info: true });
    const launchResult: LaunchResult | undefined = await launchProject(params, workspaceFolder, quiet, disposables);

    if (!launchResult || !launchResult.containerId) {
        fail('Failed to launch container');
        return 2;
    }

    const { containerId } = launchResult;

    log(`Launched container '${containerId}' as remote user ${remoteUser} \n`);

    log('>>> Executing test(s)... <<<\n\n', { prefix: ' ', info: true });

    // 3. Exec test script for each feature, in the provided order.
    const testResults = [];
    for (const feature of features) {
        log(`>>> Executing '${feature}' test. <<<\n\n`, { prefix: ' ', info: true });
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
        const result = await execTest(params, remoteTestScriptName, workspaceFolder, launchResult);
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
        log(' !!!!!! FIX ME ✅ All tests passed!');
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

async function launchProject(params: DockerResolverParameters, workspaceFolder: string, quiet: boolean, disposables: (() => Promise<unknown> | undefined)[]): Promise<LaunchResult | undefined> {
    const { common } = params;

    const options: ProvisionOptions = {
        ...staticProvisionParams,
        workspaceFolder,
        logLevel: common.getLogLevel(),
        mountWorkspaceGitRoot: true,
        idLabels: [
            `devcontainer.local_folder=${workspaceFolder}`
        ],
        remoteEnv: common.remoteEnv,
        log: (str) => common.output.write(str),
    };

    if (quiet) {
        // Launch container but don't await it to reduce output noise
        let isResolved = false;
        const p = launch(options, disposables);
        p.then(function (res) {
            isResolved = true;
            return {
                ...res,
                disposables
            };
        });
        while (!isResolved) {
            // Just so visual progress with dots
            process.stdout.write('.');
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    } else {
        // Stream all the container setup logs.
        return {
            ...await launch(options, disposables),
            disposables,
        };
    }

    return undefined;
}

async function execTest(params: DockerResolverParameters, _remoteTestScriptName: string, workspaceFolder: string, launchResult: LaunchResult) {
    // let cmd = 'chmod';
    // let args = ['777', `./${remoteTestScriptName}`, `./${TEST_LIBRARY_SCRIPT_NAME}`];
    // await exec(params, cmd, args, workspaceFolder, launchResult);

    // TODO: DEBUG ONLY
    let cmd = 'go';
    let args = ['version'];
    return await exec(params, cmd, args, workspaceFolder, launchResult);

    //     cmd = `./${remoteTestScriptName}`;
    //     args = [];
    //     return await exec(params, cmd, args, workspaceFolder, launchResult);
}

async function exec(_params: DockerResolverParameters, cmd: string, args: string[], _workspaceFolder: string, _launchResult: LaunchResult) {
    const execArgs = {
        ...staticExecParams,
        'workspace-folder': _workspaceFolder,
        cmd,
        args,
        _: [
            cmd,
            ...args
        ]
    };
    const result = await doExec(execArgs);
    return (result.outcome === 'success');

    // const { common } = params;
    // const { remoteWorkspaceFolder, remoteUser, containerId } = launchResult;

    // log('remoteWorkspaceFolder: ' + remoteWorkspaceFolder + 'remoteUser' + remoteUser);

    // const command = [cmd, ...args];


    // const remoteExec = dockerExecFunction(params, containerId, undefined);
    // const remotePtyExec = await dockerPtyExecFunction(params, containerId, undefined, loadNativeModule);

    // const containerProperties = await getContainerProperties({
    //     params: common,
    //     remoteWorkspaceFolder,
    //     containerUser: undefined,
    //     createdAt: undefined,
    //     startedAt: undefined,
    //     containerGroup: undefined,
    //     containerEnv: undefined,
    //     remoteExec,
    //     remotePtyExec,
    //     remoteExecAsRoot: undefined,
    //     rootShellServer: undefined,
    // });

    // const configs = configPath && await readDevContainerConfigFile(common.cliHost, common.workspace, configPath, params.mountWorkspaceGitRoot, output, undefined, overrideConfigFile) || undefined;
    // if (!configs) {
    //     throw new ContainerError({ description: `Dev container config (${uriToFsPath(configFile || getDefaultDevContainerConfigPath(cliHost, workspace!.configFolderPath), cliHost.platform)}) not found.` });
    // }
    // const { config, workspaceConfig } = configs;

    // const remoteEnv = probeRemoteEnv(common, containerProperties, config);


    // try {
    //     const remoteCommandOutput = await runRemoteCommand(
    //         { ...common, output: common.output },
    //         containerProperties,
    //         command,
    //         remoteWorkspaceFolder,
    //         { remoteEnv: await remoteEnv, print: 'continuous' }
    //     );
    //     return {
    //         outcome: 'success',
    //         output: remoteCommandOutput,
    //     };

    // } catch (originalError) {
    //     const originalStack = originalError?.stack;
    //     const err = originalError instanceof ContainerError ? originalError : new ContainerError({
    //         description: 'Failed to exec test',
    //         originalError
    //     });
    //     if (originalStack) {
    //         console.error(originalStack);
    //     }

    //     return {
    //         outcome: 'error',
    //         output: err.message,
    //     };
    // }
}

async function generateDockerParams(workspaceFolder: string, disposables: (() => Promise<unknown> | undefined)[]): Promise<DockerResolverParameters> {
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
        logLevel: LogLevel.Trace,
        logFormat: 'text',
        log: function (text: string): void {
            process.stdout.write(text);
        },
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
        additionalCacheFroms: []
    }, disposables);
}
