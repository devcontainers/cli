import { tmpdir } from 'os';
import path from 'path';
import { CLIHost } from '../spec-common/cliHost';

export async function doFeaturesTestCommand(
    cliHost: CLIHost,
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
        cliHost,
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

async function createTempDevcontainerFolder(cliHost: CLIHost): Promise<string> {
    const systemTmpDir = tmpdir();
    const tmpFolder = path.join(systemTmpDir, 'vsch', 'container-features-test', Date.now().toString(), '.devcontainer');
    process.stderr.write(`${tmpFolder}\n`);
    await cliHost.mkdirp(tmpFolder);
    process.stderr.write('created tmp folder\n');
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

    await cliHost.writeFile(`${tmpFolder}/devcontainer.json`, Buffer.from(template));

    return tmpFolder;
}
