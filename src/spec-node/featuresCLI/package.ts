import path from 'path';
import { Argv } from 'yargs';
import { CLIHost, getCLIHost } from '../../spec-common/cliHost';
import { loadNativeModule } from '../../spec-common/commonUtils';
import { Log, LogLevel, mapLogLevel } from '../../spec-utils/log';
import { isLocalFolder, mkdirpLocal } from '../../spec-utils/pfs';
import { createLog } from '../devContainers';
import { UnpackArgv } from '../devContainersSpecCLI';
import { getPackageConfig } from '../utils';
import { doFeaturesPackageCommand } from './packageCommandImpl';

export function featuresPackageOptions(y: Argv) {
    return y
        .options({
            // 'features': { type: 'array', alias: 'f', describe: 'Feature(s) to test as space-separated parameters. Omit to auto-detect all features in collection directory.  Cannot be combined with \'-s\'.', },
            'features-folder': { type: 'string', alias: 'c', default: '.', description: 'Path to folder containing features source code' },
            'output-dir': { type: 'string', alias: 'o', default: '/tmp/build', description: 'Path to output' },
            'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' },
            'quiet': { type: 'boolean', alias: 'q', default: false, description: 'Quiets output' },
        })
        .check(_argv => {
            // if (argv['scenarios'] && argv['features']) {
            //     throw new Error('Cannot combine --scenarios and --features');
            // }
            return true;
        });
}

export type FeaturesPackageArgs = UnpackArgv<ReturnType<typeof featuresPackageOptions>>;
export interface FeaturesPackageCommandInput {
    cliHost: CLIHost;
    // features?: string[];
    featuresFolder: string;
    output: Log;
    outputDir: string;
    disposables: (() => Promise<unknown> | undefined)[];
}

export function featuresPackageHandler(args: FeaturesPackageArgs) {
    (async () => await featuresPackage(args))().catch(console.error);
}

async function featuresPackage({
    'features-folder': featuresFolder,
    'log-level': inputLogLevel,
    'output-dir': outputDir,
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

    output.write('Packaging features...\n', LogLevel.Info);

    const featuresDirResolved = cliHost.path.resolve(featuresFolder);
    if (!(await isLocalFolder(featuresDirResolved))) {
        throw new Error(`Features folder '${featuresDirResolved}' does not exist`);
    }

    const outputDirResolved = cliHost.path.resolve(outputDir);
    if (!(await isLocalFolder(outputDirResolved))) {
        // TODO: Delete folder first?
        await mkdirpLocal(outputDirResolved);
    }

    const args: FeaturesPackageCommandInput = {
        cliHost,
        featuresFolder: featuresDirResolved,
        outputDir: outputDirResolved,
        output,
        disposables
    };

    const exitCode = await doFeaturesPackageCommand(args);

    await dispose();
    process.exit(exitCode);
}