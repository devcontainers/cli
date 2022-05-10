import { mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {  writeLocalFile } from '../spec-utils/pfs';

export async function doFeaturesTestCommand(
    baseImage: string,
    pathToCollection: string,
    commaSeparatedFeatures: string
) {
    process.stdout.write(`
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
|    dev container 'features' |   
│     Testing Tool v0.0.0     │
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘\n\n`);

    process.stdout.write(`baseImage:         ${baseImage}\n`);
    process.stdout.write(`pathToCollection:  ${pathToCollection}\n`);
    process.stdout.write(`features:          ${commaSeparatedFeatures}\n\n\n`);

    const features = commaSeparatedFeatures.split(',');

    if (features.length === 0) {
        process.stderr.write('No features specified\n');
        process.exit(1);
    }

    // 1. Generate temporary project with 'baseImage' and all the 'features..'
    const tempProjectPath = await generateProject(
        baseImage,
        pathToCollection,
        features
    );
    process.stdout.write(`[+] tempProjectPath: ${tempProjectPath}`);

    // 1.5. Provide a way to pass options nicely via CLI (or have test config file maybe?)

    // 2. Use  'devcontainer-cli up'  to build and start a container

    // 3. devcontainer-cli exec <ALL SCRIPTS>

    // 4. Watch for non-zero exit codes.

    process.exit(0);
}

const devcontainerTemplate = `
{
    "image": "#{IMAGE}",
    "features": {
        #{FEATURES}
    }
}`;

async function createTempDevcontainerFolder(): Promise<string> {
    const systemTmpDir = tmpdir();
    const tmpFolder = path.join(systemTmpDir, 'vsch', 'container-features-test', Date.now().toString(), '.devcontainer');
    process.stderr.write(`${tmpFolder}\n`);
    mkdirSync(tmpFolder)
    process.stderr.write('created tmp folder\n');
    return tmpFolder;
}

async function generateProject(
    baseImage: string,
    basePathToCollection: string,
    featuresToTest: string[]
): Promise<string> {
    const tmpFolder = await createTempDevcontainerFolder();

    const features = featuresToTest
        .map((x) => `"${basePathToCollection}/${x}": "latest"`)
        .join(',\n');

    let template = devcontainerTemplate
        .replace('#{IMAGE}', baseImage)
        .replace('#{FEATURES}', features);

    writeLocalFile(`${tmpFolder}/devcontainer.json`, template);

    return tmpFolder;
}
