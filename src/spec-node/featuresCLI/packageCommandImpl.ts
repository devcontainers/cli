import path from 'path';
import { Feature } from '../../spec-configuration/containerFeaturesConfiguration';
import { isLocalFile, readLocalDir, readLocalFile, writeLocalFile } from '../../spec-utils/pfs';
import { FeaturesPackageCommandInput } from './package';

export async function doFeaturesPackageCommand(args: FeaturesPackageCommandInput): Promise<number> {

    // For each feature, package each feature and write to 'outputDir/{f}.tgz'
    // Returns an array of feature metadata from each processed feature
    const metadataOutput = await getFeaturesAndPackage(args.collectionFolder, args.outputDir);

    if (!metadataOutput) {
        // ERR
        return 1;
    }

    // Write the metadata to a file
    const metadataOutputPath = path.join(args.outputDir, 'devcontainer-collection.json');
    await writeLocalFile(metadataOutputPath, JSON.stringify(metadataOutput, null, 4));


    return 0;
}

async function tarDirectory(_featureFolder: string, _archiveName: string, _outputDir: string) {

}

export async function getFeaturesAndPackage(basePath: string, outputDir: string): Promise<Feature[] | undefined> {
    // const { output } = args;
    const featureDirs = await readLocalDir(basePath);
    let metadatas: Feature[] = [];

    await Promise.all(
        featureDirs.map(async (f: string) => {
            // output.write(`Processing feature: ${f}`);
            if (!f.startsWith('.')) {
                const featureFolder = path.join(basePath, f);
                const archiveName = `${f}.tgz`;

                await tarDirectory(featureFolder, archiveName, outputDir);

                const featureJsonPath = path.join(featureFolder, 'devcontainer-feature.json');

                if (!isLocalFile(featureJsonPath)) {
                    // core.error(`Feature '${f}' is missing a devcontainer-feature.json`);
                    // core.setFailed('All features must have a devcontainer-feature.json');
                    return;
                }

                const featureMetadata: Feature = JSON.parse(await readLocalFile(featureJsonPath, 'utf-8'));
                metadatas.push(featureMetadata);
            }
        })
    );

    if (metadatas.length === 0) {
        // core.setFailed('No features found');
        return;
    }

    return metadatas;
}