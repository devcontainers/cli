import path from 'path';
import * as os from 'os';
import { Argv } from 'yargs';
import { LogLevel, mapLogLevel } from '../../spec-utils/log';
import { rmLocal } from '../../spec-utils/pfs';
import { getPackageConfig } from '../../spec-utils/product';
import { createLog } from '../devContainers';
import { UnpackArgv } from '../devContainersSpecCLI';
import { FeaturesPackageArgs, featuresPackage } from './package';
import { OCIFeatureCollectionFileName } from './packageCommandImpl';
import { doFeaturesPublishCommand } from './publishCommandImpl';
import { getFeatureRef } from '../../spec-configuration/containerFeaturesOCI';

const targetPositionalDescription = `
Package and publish features at provided [target] (default is cwd), where [target] is either:
   1. A path to the src folder of the collection with [1..n] features.
   2. A path to a single feature that contains a devcontainer-feature.json.
`;

export function featuresPublishOptions(y: Argv) {
    return y
        .options({
            'registry': { type: 'string', alias: 'r', default: 'ghcr.io', description: 'Name of the OCI registry.' },
            'namespace': { type: 'string', alias: 'n', require: true, description: 'Unique indentifier for the collection of features. Example: <owner>/<repo>' },
            'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' }
        })
        .positional('target', { type: 'string', default: '.', description: targetPositionalDescription })
        .check(_argv => {
            return true;
        });
}

export type FeaturesPublishArgs = UnpackArgv<ReturnType<typeof featuresPublishOptions>>;

export function featuresPublishHandler(args: FeaturesPublishArgs) {
    (async () => await featuresPublish(args))().catch(console.error);
}

async function featuresPublish({
    'target': targetFolder,
    'log-level': inputLogLevel,
    'registry': registry,
    'namespace': namespace
}: FeaturesPublishArgs) {
    const disposables: (() => Promise<unknown> | undefined)[] = [];
    const dispose = async () => {
        await Promise.all(disposables.map(d => d()));
    };

    const extensionPath = path.join(__dirname, '..', '..', '..');
    const pkg = await getPackageConfig(extensionPath);
    const output = createLog({
        logLevel: mapLogLevel(inputLogLevel),
        logFormat: 'text',
        log: (str) => process.stdout.write(str),
        terminalDimensions: undefined,
    }, pkg, new Date(), disposables, true);

    // Package features
    const outputDir = os.tmpdir();

    const packageArgs: FeaturesPackageArgs = {
        'target': targetFolder,
        'log-level': inputLogLevel,
        'output-folder': outputDir,
        'force-clean-output-folder': true,
    };

    const metadata = await featuresPackage(packageArgs, false);

    if (!metadata) {
        output.write(`(!) ERR: Failed to fetch ${OCIFeatureCollectionFileName}`, LogLevel.Error);
        process.exit(1);
    }

    let exitCode = 0;
    for (const f of metadata.features) {
        output.write(`Processing feature: ${f.id}...`, LogLevel.Info);

        if (!f.version) {
            output.write(`(!) WARNING: Version does not exist, skipping ${f.id}...`, LogLevel.Warning);
            continue;
        }

        const resource = `${registry}/${namespace}/${f.id}`;
        const featureRef = getFeatureRef(output, resource);
        exitCode = await doFeaturesPublishCommand(f.version, featureRef, outputDir, output);

        // Cleanup
        await rmLocal(outputDir, { recursive: true, force: true });
        await dispose();
        process.exit(exitCode);
    }
}
