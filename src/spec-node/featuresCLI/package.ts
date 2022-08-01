import path from 'path';
import { Argv } from 'yargs';
import { CLIHost, getCLIHost } from '../../spec-common/cliHost';
import { loadNativeModule } from '../../spec-common/commonUtils';
import { Log, LogLevel, mapLogLevel } from '../../spec-utils/log';
import { isLocalFolder, mkdirpLocal, rmLocal } from '../../spec-utils/pfs';
import { createLog } from '../devContainers';
import { UnpackArgv } from '../devContainersSpecCLI';
import { getPackageConfig } from '../utils';
import { doFeaturesPackageCommand } from './packageCommandImpl';

export function featuresPackageOptions(y: Argv) {
    return y
        .options({
            'feature-collection-folder': { type: 'string', alias: 'c', default: '.', description: 'Path to folder containing source code for collection of features' },
            'output-dir': { type: 'string', alias: 'o', default: './output', description: 'Path to output directory. Will create directories as needed.' },
            'force-clean-output-dir': { type: 'boolean', alias: 'f', default: false, description: 'Automatically delete previous output directory before packaging' },
            'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' },
        })
        .check(_argv => {
            return true;
        });
}

export type FeaturesPackageArgs = UnpackArgv<ReturnType<typeof featuresPackageOptions>>;
export interface FeaturesPackageCommandInput {
    cliHost: CLIHost;
    srcFolder: string;
    outputDir: string;
    output: Log;
    disposables: (() => Promise<unknown> | undefined)[];
}

export function featuresPackageHandler(args: FeaturesPackageArgs) {
    (async () => await featuresPackage(args))().catch(console.error);
}

async function featuresPackage({
    'feature-collection-folder': featureCollectionFolder,
    'log-level': inputLogLevel,
    'output-dir': outputDir,
    'force-clean-output-dir': forceCleanOutputDir,
}: FeaturesPackageArgs) {
    const disposables: (() => Promise<unknown> | undefined)[] = [];
    const dispose = async () => {
        await Promise.all(disposables.map(d => d()));
    };

    const extensionPath = path.join(__dirname, '..', '..', '..');
    const pkg = await getPackageConfig(extensionPath);

    const cwd = process.cwd();
    const cliHost = await getCLIHost(cwd, loadNativeModule);
    const output = createLog({
        logLevel: mapLogLevel(inputLogLevel),
        logFormat: 'text',
        log: (str) => process.stdout.write(str),
        terminalDimensions: undefined,
    }, pkg, new Date(), disposables);

    output.write('Packaging features...', LogLevel.Info);

    const featuresDirResolved = cliHost.path.resolve(featureCollectionFolder);
    if (!(await isLocalFolder(featuresDirResolved))) {
        throw new Error(`Features folder '${featuresDirResolved}' does not exist`);
    }

    const outputDirResolved = cliHost.path.resolve(outputDir);
    if (await isLocalFolder(outputDirResolved)) {
        // Output dir exists. Delete it automatically if '-f' is true
        if (forceCleanOutputDir) {
            await rmLocal(outputDirResolved, { recursive: true, force: true });
        }
        else {
            output.write(`Output directory '${outputDirResolved}' already exists. Manually delete, or pass '-f' to continue.`, LogLevel.Warning);
            process.exit(1);
        }
    }

    // Generate output folder.
    await mkdirpLocal(outputDirResolved);

    const args: FeaturesPackageCommandInput = {
        cliHost,
        srcFolder: featuresDirResolved,
        outputDir: outputDirResolved,
        output,
        disposables
    };

    const exitCode = await doFeaturesPackageCommand(args);

    await dispose();
    process.exit(exitCode);
}