import path from 'path';
import chalk from 'chalk';
import { tmpdir } from 'os';
import { CLIHost } from '../../spec-common/cliHost';
import { LogLevel } from '../../spec-utils/log';
import { launch, ProvisionOptions } from '../devContainers';
import { doExec, FeaturesTestCommandInput } from '../devContainersSpecCLI';
import { staticExecParams, staticProvisionParams, testLibraryScript } from './utils';

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


export async function doFeaturesTestCommand(cliHost: CLIHost, params: FeaturesTestCommandInput) {
    const { baseImage, directory, features: inputFeatures, remoteUser, quiet } = params;

    process.stdout.write(`
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
|    dev container 'features' |   
│     Testing Tool v0.0.0     │
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘\n\n`);

    const srcDir = `${directory}/src`;
    const testsDir = `${directory}/test`;

    if (! await cliHost.isFolder(srcDir) || ! await cliHost.isFolder(testsDir)) {
        fail(`Directory '${directory}' does not the required 'src' and 'test' folders.`);
    }


    log(`baseImage:         ${baseImage}`);
    log(`Target Directory:  ${directory}`);

    // Parse comma separated list of features
    // If '--features' isn't specified, run all features with a 'test' subfolder in random order.
    let features: string[] = [];
    if (!inputFeatures) {
        features = await cliHost.readDir(testsDir);
        if (features.length === 0) {
            fail(`No features specified and no test folders found in '${testsDir}'`);
        }
    } else {
        features = inputFeatures
            .split(',')
            .map((x) => x.trim());

        if (features.length === 0) {
            fail('Comma separated list of features could not be parsed');
        }
    }

    log(`features:          ${features.join(', ')}`);


    // 1. Generate temporary project with 'baseImage' and all the 'features..'
    const workspaceFolder = await generateProject(
        cliHost,
        baseImage,
        directory,
        features,
        remoteUser
    );

    log(`workspaceFolder:   ${workspaceFolder}`);

    // 1.5. Provide a way to pass options nicely via CLI (or have test config file maybe?)

    // 2. Use  'devcontainer-cli up'  to build and start a container
    log('\n>>> Building test container... <<<\n\n', { prefix: ' ', info: true });
    await launchProject(workspaceFolder, quiet);

    log('>>> Executing test(s)... <<<\n\n', { prefix: ' ', info: true });

    // 3. Exec test script for each feature, in the provided order.
    const testResults = [];
    for (const feature of features) {
        log(`>>> Executing '${feature}' test. <<<\n\n`, { prefix: ' ', info: true });
        const testScriptPath = path.join(directory, 'test', feature, 'test.sh');
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
        const result = await execTest(remoteTestScriptName, workspaceFolder);
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
        log(' ✅ All tests passed!');
    }

    process.exit(allPassed ? 0 : 1);
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

async function launchProject(workspaceFolder: string, quiet: boolean) {

    const options: ProvisionOptions = {
        ...staticProvisionParams,
        workspaceFolder,
        logLevel: LogLevel.Info,
        mountWorkspaceGitRoot: true,
        idLabels: [
            `devcontainer.local_folder=${workspaceFolder}`
        ],
        remoteEnv: {},
        log: ((_msg: string) => quiet ? null : process.stdout.write(_msg))
    };

    const disposables: (() => Promise<unknown> | undefined)[] = [];

    let containerId = '';
    let remoteUser = '';
    if (quiet) {
        // Launch container but don't await it to reduce output noise
        let isResolved = false;
        const p = launch(options, disposables);
        p.then(function (res) {
            isResolved = true;
            containerId = res.containerId;
            remoteUser = res.remoteUser;
        });
        while (!isResolved) {
            // Just so visual progress with dots
            process.stdout.write('.');
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
        process.stdout.write('\n');

    } else {
        // Stream all the container setup logs.
        const launchResult = await launch(options, disposables);
        containerId = launchResult.containerId;
        remoteUser = launchResult.remoteUser;

    }

    log(`Launched container '${containerId}' as remote user ${remoteUser} \n`);
}

async function execTest(remoteTestScriptName: string, workspaceFolder: string) {

    let cmd = 'chmod';
    let args = ['777', `./${remoteTestScriptName}`, `./${TEST_LIBRARY_SCRIPT_NAME}`];
    await exec(cmd, args, workspaceFolder);

    cmd = `./${remoteTestScriptName}`;
    args = [];
    return await exec(cmd, args, workspaceFolder);
}

async function exec(cmd: string, args: string[], workspaceFolder: string) {
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