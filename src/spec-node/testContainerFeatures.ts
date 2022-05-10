import { tmpdir } from 'os';
import path from 'path';
import { mkdirpLocal, writeLocalFile } from '../spec-utils/pfs';


export async function doFeaturesTestCommand(baseImage: string, pathToCollection: string, commaSeparatedFeatures: string): Prim {

    const features = commaSeparatedFeatures.split(',');

    // if (features.length === 0) {
    //     console.log('No features specified');
    //     process.exit(1);

    // }

    // 1. Generate temporary project with 'baseImage' and all the 'features..'
    const tempProjectPath = await generateProject(baseImage, pathToCollection, features);
    console.log('[+] tempProjectPath:', tempProjectPath);

    // 1.5. Provide a way to pass options nicely via CLI (or have test config file maybe?)

    // 2. Use  'devcontainer-cli up'  to build and start a container

    // 3. devcontainer-cli exec <ALL SCRIPTS>

    // 4. Watch for non-zero exit codes.

    process.exit(0);
}

const devcontainerTemplate = `{
        "image": "#{IMAGE}",
        "features": {
            #{FEATURES}
        }
    }
`;

async function createTempDevcontainerFolder(): Promise<string> {
    const tmpFolder: string = path.join(tmpdir(), 'vsch', 'container-features-test', `${Date.now()}`, '.devcontainer');
    await mkdirpLocal(tmpFolder);
    return tmpFolder;
}

async function generateProject(baseImage: string, basePathToCollection: string, featuresToTest: string[]): Promise<string> {
    const tmpFolder = await createTempDevcontainerFolder();

    const features = featuresToTest
        .map(x => `"${basePathToCollection}/${x}": "latest"`)
        .join(',\n');

    let template =
        devcontainerTemplate
            .replace('#{IMAGE}', baseImage)
            .replace('#{FEATURES}', features);

    writeLocalFile(`${tmpFolder}/devcontainer.json`, template);

    return tmpFolder;
}