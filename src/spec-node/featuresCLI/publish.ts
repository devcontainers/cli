import path from 'path';
import { Argv } from 'yargs';
import { LogLevel, mapLogLevel } from '../../spec-utils/log';
import { isLocalFile, readLocalFile, rmLocal } from '../../spec-utils/pfs';
import { getPackageConfig } from '../../spec-utils/product';
import { createLog } from '../devContainers';
import { UnpackArgv } from '../devContainersSpecCLI';
import { FeaturesPackageArgs, featuresPackage } from './package';
import { DevContainerCollectionMetadata } from './packageCommandImpl';
import { getPublishedVersions, getSermanticVersions } from './publishCommandImpl';

export function featuresPublishOptions(y: Argv) {
    return y
        .options({
            'feature-collection-folder': { type: 'string', alias: 'c', default: '.', description: 'Path to folder containing source code for collection of features' },
            'registry': { type: 'string', alias: 'r', default: 'ghcr.io', description: 'Name of the OCI registry.' },
            'namespace': { type: 'string', alias: 'n', require: true, description: 'Unique indentifier for the collection of features. Example: <owner>/<repo>' },
            'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' }
        })
        .check(_argv => {
            return true;
        });
}

export type FeaturesPublishArgs = UnpackArgv<ReturnType<typeof featuresPublishOptions>>;

export function featuresPublishHandler(args: FeaturesPublishArgs) {
    (async () => await featuresPublish(args))().catch(console.error);
}

async function featuresPublish({
    'feature-collection-folder': featureCollectionFolder,
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
    }, pkg, new Date(), disposables);

    // Package features
    const outputDir = '/tmp/features-output';

    const packageArgs: FeaturesPackageArgs = {
        'feature-collection-folder': featureCollectionFolder,
        'force-clean-output-dir': true,
        'log-level': inputLogLevel,
        'output-dir': outputDir
    };

    await featuresPackage(packageArgs, false);

    const metadataOutputPath = path.join(outputDir, 'devcontainer-collection.json');
    if (!isLocalFile(metadataOutputPath)) {
        output.write(`(!) ERR: Failed to fetch ${metadataOutputPath}`, LogLevel.Error);
        process.exit(1);
    }

    const metadata: DevContainerCollectionMetadata = JSON.parse(await readLocalFile(metadataOutputPath, 'utf-8'));

    // temp
    const exitCode = 0;

    for (const f of metadata.features) {
        output.write('\n');
        output.write(`Processing feature: ${f.id}...`, LogLevel.Info);

        output.write(`Fetching published versions...`, LogLevel.Info);
        const publishedVersions: string[] = await getPublishedVersions(f.id, registry, namespace, output);

        if (f.version !== undefined && publishedVersions.includes(f.version)) {
            output.write(`Skipping ${f.id} as ${f.version} is already published...`, LogLevel.Warning);
        } else {
            if (f.version !== undefined) {
                const semanticVersions: string[] = getSermanticVersions(f.version, publishedVersions, output);

                output.write(`Publishing versions: ${semanticVersions.toString()}...`, LogLevel.Info);

                // TODO: CALL OCI PUSH
                // exitCode = await doFeaturesPublishCommand();

                output.write(`Published feature: ${f.id}...`, LogLevel.Info);
            }
        }
    }

    // Cleanup
    await rmLocal(outputDir, { recursive: true, force: true });

    await dispose();
    process.exit(exitCode);
}
