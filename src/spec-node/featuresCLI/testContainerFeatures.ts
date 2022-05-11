import path from 'path';
import chalk from 'chalk';
import { tmpdir } from 'os';
import { CLIHost } from '../../spec-common/cliHost';
import { LogLevel } from '../../spec-utils/log';
import { launch, ProvisionOptions } from '../devContainers';
import { doExec } from '../devContainersSpecCLI';
import { staticExecParams, staticProvisionParams } from './utils';

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

export async function doFeaturesTestCommand(
    cliHost: CLIHost,
    baseImage: string,
    pathToCollection: string,
    commaSeparatedFeatures: string,
    verbose: boolean
) {
    process.stdout.write(`
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
|    dev container 'features' |   
│     Testing Tool v0.0.0     │
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘\n\n`);

    log(`baseImage:         ${baseImage}`);
    log(`pathToCollection:  ${pathToCollection}`);
    log(`features:          ${commaSeparatedFeatures}`);

    const features = commaSeparatedFeatures.split(',');

    if (features.length === 0) {
        fail('No features specified\n');
    }

    // 1. Generate temporary project with 'baseImage' and all the 'features..'
    const workspaceFolder = await generateProject(
        cliHost,
        baseImage,
        pathToCollection,
        features
    );

    log(`workspaceFolder:   ${workspaceFolder}`);

    // 1.5. Provide a way to pass options nicely via CLI (or have test config file maybe?)

    // 2. Use  'devcontainer-cli up'  to build and start a container
    log('\n>>> Building test container... <<<\n\n', { prefix: ' ', info: true });
    await launchProject(workspaceFolder, verbose);

    // 3. Exec test script for each feature, in the provided order.
    const testResults = [];
    for (const feature of features) {
        const testScriptPath = path.join(pathToCollection, feature, 'test.sh');
        if (!(await cliHost.isFile(testScriptPath))) {
            fail(`Feature ${feature} does not have a test script!`);
        }

        // Move the test script into the workspaceFolder
        const testScript = await cliHost.readFile(testScriptPath);
        const remoteTestScriptName = `${feature}-test-${Date.now()}.sh`;
        await cliHost.writeFile(`${workspaceFolder}/${remoteTestScriptName}`, testScript);

        // Execute Test
        log('>>> Executing test(s)... <<<\n\n', { prefix: ' ', info: true });
        const result = await execTest(remoteTestScriptName, workspaceFolder);
        testResults.push({
            feature,
            result,
        });
    }

    // 4. Check for
    const allPassed = testResults.every((x) => x.result);
    if (!allPassed) {
        testResults.filter((x) => !x.result).forEach((x) => {
            printFailedTest(x.feature);
        });
    } else {
        log('All tests passed!');
    }

    process.exit(allPassed ? 0 : 1);
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

async function launchProject(workspaceFolder: string, verbose: boolean) {

    const options: ProvisionOptions = {
        ...staticProvisionParams,
        workspaceFolder,
        logLevel: LogLevel.Info,
        mountWorkspaceGitRoot: true,
        idLabels: [
            `devcontainer.local_folder=${workspaceFolder}`
        ],
        remoteEnv: {},
        log: ((_msg: string) => verbose ? process.stdout.write(_msg) : null)
    };

    const disposables: (() => Promise<unknown> | undefined)[] = [];

    let containerId = '';
    let remoteUser = '';
    if (!verbose) {
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
    let args = ['777', `./${remoteTestScriptName}`];
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