import path from 'path';
import { Argv } from 'yargs';
import { LogLevel, mapLogLevel } from '../../spec-utils/log';
import { isLocalFile, readLocalFile, rmLocal } from '../../spec-utils/pfs';
import { getPackageConfig } from '../../spec-utils/product';
import { createLog } from '../devContainers';
import { UnpackArgv } from '../devContainersSpecCLI';
import { FeaturesPackageArgs, featuresPackage } from './package';
import { DevContainerCollectionMetadata } from './packageCommandImpl';
import { doFeaturesPublishCommand, getPublishedVersions, getSermanticVersions } from './publishCommandImpl';

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
    const outputDir = '/tmp/features-output';

    const packageArgs: FeaturesPackageArgs = {
        'target': targetFolder,
        'log-level': inputLogLevel,
        'output-folder': outputDir,
        'force-clean-output-folder': true,
    };

    await featuresPackage(packageArgs, false);

    const metadataOutputPath = path.join(outputDir, 'devcontainer-collection.json');
    if (!isLocalFile(metadataOutputPath)) {
        output.write(`(!) ERR: Failed to fetch ${metadataOutputPath}`, LogLevel.Error);
        process.exit(1);
    }

    let exitCode = 0;
    const metadata: DevContainerCollectionMetadata = JSON.parse(await readLocalFile(metadataOutputPath, 'utf-8'));
    for (const f of metadata.features) {
        output.write(`Processing feature: ${f.id}...`, LogLevel.Info);

        if (f.version === undefined) {
            output.write(`(!) WARNING: Version does not exist, skipping ${f.id}...`, LogLevel.Warning);
            continue;
        }

        output.write(`Fetching published versions...`, LogLevel.Info);
        const publishedVersions: string[] = await getPublishedVersions(f.id, registry, namespace, output);
        const semanticVersions: string[] | undefined = getSermanticVersions(f.version, publishedVersions, output);

        if (semanticVersions !== undefined) {
            output.write(`Publishing versions: ${semanticVersions.toString()}...`, LogLevel.Info);
            exitCode = doFeaturesPublishCommand();
            output.write(`Published feature: ${f.id}...`, LogLevel.Info);
        }
    }

    // Cleanup
    await rmLocal(outputDir, { recursive: true, force: true });
    await dispose();
    process.exit(exitCode);
}
