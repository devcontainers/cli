import path from 'path';
import * as os from 'os';
import { Argv } from 'yargs';
import { LogLevel, mapLogLevel } from '../../spec-utils/log';
import { rmLocal } from '../../spec-utils/pfs';
import { getPackageConfig } from '../../spec-utils/product';
import { createLog } from '../devContainers';
import { UnpackArgv } from '../devContainersSpecCLI';
import { doFeaturesPackageCommand } from './packageCommandImpl';
import { getCLIHost } from '../../spec-common/cliHost';
import { loadNativeModule } from '../../spec-common/commonUtils';
import { PackageCommandInput } from '../collectionCommonUtils/package';
import { OCICollectionFileName } from '../collectionCommonUtils/packageCommandImpl';
import { publishOptions } from '../collectionCommonUtils/publish';
import { getCollectionRef, getRef, OCICollectionRef } from '../../spec-configuration/containerCollectionsOCI';
import { doPublishCommand, doPublishMetadata } from '../collectionCommonUtils/publishCommandImpl';

const collectionType = 'feature';
export function featuresPublishOptions(y: Argv) {
    return publishOptions(y, 'feature');
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
    const outputDir = path.join(os.tmpdir(), `/features-output-${Date.now()}`);

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
        const featureRef = getRef(output, resource);
        if (!featureRef) {
            output.write(`(!) Could not parse provided Feature identifier: '${resource}'`, LogLevel.Error);
            process.exit(1);
        }

        if (! await doPublishCommand(f.version, featureRef, outputDir, output, collectionType)) {
            output.write(`(!) ERR: Failed to publish '${resource}'`, LogLevel.Error);
            process.exit(1);
        }
    }

    const featureCollectionRef: OCICollectionRef | undefined = getCollectionRef(output, registry, namespace);
    if (!featureCollectionRef) {
        output.write(`(!) Could not parse provided collection identifier with registry '${registry}' and namespace '${namespace}'`, LogLevel.Error);
        process.exit(1);
    }

    if (! await doPublishMetadata(featureCollectionRef, outputDir, output, collectionType)) {
        output.write(`(!) ERR: Failed to publish '${featureCollectionRef.registry}/${featureCollectionRef.path}'`, LogLevel.Error);
        process.exit(1);
    }

    // Cleanup
    await rmLocal(outputDir, { recursive: true, force: true });
    await dispose();
    process.exit();
}
