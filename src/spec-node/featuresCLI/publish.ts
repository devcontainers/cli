import path from 'path';
import * as os from 'os';
import { Argv } from 'yargs';
import { LogLevel, mapLogLevel } from '../../spec-utils/log';
import { rmLocal } from '../../spec-utils/pfs';
import { getPackageConfig } from '../../spec-utils/product';
import { createLog } from '../devContainers';
import { UnpackArgv } from '../devContainersSpecCLI';
import { doFeaturesPackageCommand } from './packageCommandImpl';
import { doFeaturesPublishCommand, doFeaturesPublishMetadata } from './publishCommandImpl';
import { getFeatureRef, OCIFeatureCollectionRef } from '../../spec-configuration/containerFeaturesOCI';
import { getCLIHost } from '../../spec-common/cliHost';
import { loadNativeModule } from '../../spec-common/commonUtils';
import { PackageCommandInput } from '../collectionCommonUtils/package';
import { OCICollectionFileName } from '../collectionCommonUtils/packageCommandImpl';

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

    const pkg = getPackageConfig();

    const cwd = process.cwd();
    const cliHost = await getCLIHost(cwd, loadNativeModule);
    const output = createLog({
        logLevel: mapLogLevel(inputLogLevel),
        logFormat: 'text',
        log: (str) => process.stdout.write(str),
        terminalDimensions: undefined,
    }, pkg, new Date(), disposables);

    // Package features
    const outputDir = path.join(os.tmpdir(), '/features-output');

    const packageArgs: PackageCommandInput = {
        cliHost,
        targetFolder,
        outputDir,
        output,
        disposables,
        forceCleanOutputDir: true,
    };

    const metadata = await doFeaturesPackageCommand(packageArgs);

    if (!metadata) {
        output.write(`(!) ERR: Failed to fetch ${OCICollectionFileName}`, LogLevel.Error);
        process.exit(1);
    }

    for (const f of metadata.features) {
        output.write(`Processing feature: ${f.id}...`, LogLevel.Info);

        if (!f.version) {
            output.write(`(!) WARNING: Version does not exist, skipping ${f.id}...`, LogLevel.Warning);
            continue;
        }

        const resource = `${registry}/${namespace}/${f.id}`;
        const featureRef = getFeatureRef(output, resource);
        await doFeaturesPublishCommand(f.version, featureRef, outputDir, output);
    }

    const featureCollectionRef: OCIFeatureCollectionRef = {
        registry: registry,
        path: namespace,
        version: 'latest'
    };

    await doFeaturesPublishMetadata(featureCollectionRef, outputDir, output);

    // Cleanup
    await rmLocal(outputDir, { recursive: true, force: true });
    await dispose();
    process.exit();
}
