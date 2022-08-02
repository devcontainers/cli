import path from 'path';
import { Argv } from 'yargs';
import { createPlainLog, LogLevel, makeLog } from '../../spec-utils/log';
import { readLocalFile, rmLocal } from '../../spec-utils/pfs';
import { UnpackArgv } from '../devContainersSpecCLI';
import { FeaturesPackageArgs, featuresPackage } from './package';
import { DevContainerCollectionMetadata } from './packageCommandImpl';
import { getPublishedVersions, getSermanticVersions } from './publishCommandImpl';

export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));

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
    // Package features
    const outputDir = '/tmp/features-output';

    const packageArgs: FeaturesPackageArgs = {
        'feature-collection-folder': featureCollectionFolder,
        'force-clean-output-dir': true,
        'log-level': inputLogLevel,
        'output-dir': outputDir
    };

    await featuresPackage(packageArgs);

    const metadataOutputPath = path.join(outputDir, 'devcontainer-collection.json');
    const metadata: DevContainerCollectionMetadata = JSON.parse(await readLocalFile(metadataOutputPath, 'utf-8'));

    for (const f of metadata.features) {
        output.write(`Processing feature: ${f.id}`, LogLevel.Info);

        output.write(`Fetching published versions...`, LogLevel.Info);
        const publishedVersions: string[] | undefined = await getPublishedVersions(f.id, registry, namespace, output);
        let semanticVersions;

        if (publishedVersions !== undefined && f.version !== undefined && publishedVersions.includes(f.version)) {
            output.write(`Skipping ${f.id} as ${f.version} is already published...`);
        } else {
            if (f.version !== undefined && publishedVersions !== undefined) {
                semanticVersions = getSermanticVersions(f.version, publishedVersions);

                if (semanticVersions !== null) {
                    output.write(`Publishing versions ${semanticVersions}`);
                    // CALL OCI PUSH
                }
            }
        }
    }

    // Cleanup
    await rmLocal(outputDir, { recursive: true, force: true });
}
