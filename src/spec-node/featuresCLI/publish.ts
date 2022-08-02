// import path from 'path';
import { Argv } from 'yargs';
// import { getCLIHost } from '../../spec-common/cliHost';
// import { loadNativeModule } from '../../spec-common/commonUtils';
import { request } from '../../spec-utils/httpRequest';
import { createPlainLog, Log, LogLevel, makeLog } from '../../spec-utils/log';
import { rmLocal } from '../../spec-utils/pfs';
import { UnpackArgv } from '../devContainersSpecCLI';
import { FeaturesPackageArgs, featuresPackage } from './package';

export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));

export function featuresPublishOptions(y: Argv) {
    return y
        .options({
            'feature-collection-folder': { type: 'string', alias: 'c', default: '.', description: 'Path to folder containing source code for collection of features' },
            'registry': { type: 'string', alias: 'r', default: 'ghcr.io', description: 'Name of the OCI registry.' },
            'namespace': { type: 'string', alias: 'n', require: true, description: 'Unique indentifier for the collection of features. Example: <owner>/<repo>' },
            'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' },
            'fea': { type: 'string', alias: 'f', require: true, description: 'Unique indentifier for the collection of features. Example: <owner>/<repo>' },
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
    'namespace': namespace,
    'fea': feature
}: FeaturesPublishArgs) {
    // Package features
    const outputDir = '/tmp/features-output';

    const packageArgs: FeaturesPackageArgs = {
        'feature-collection-folder': featureCollectionFolder,
        'force-clean-output-dir': true,
        'log-level': inputLogLevel,
        'output-dir': outputDir
    };

    // featuresPackageHandler(packageArgs);
    await featuresPackage(packageArgs);
    output.write('trying to get tags');
    await getTagsList(feature, registry, namespace, featureCollectionFolder);

    // Cleanup
    await rmLocal(outputDir, { recursive: true, force: true });
}

async function getTagsList(featureId: string, registry: string, namespace: string, workspace: string) {
    console.log(workspace);
    const url = `https://${registry}/v2/${namespace}/${featureId}/tags/list`;
    const id = `${registry}/${namespace}/${featureId}`;
    output.write(`URL: ${url}`);
    output.write(`id: ${id}`);

    try {
        // const workspaceFolder = path.resolve(process.cwd(), workspace);
        // const cwd = workspaceFolder || process.cwd();
        // const cliHost = await getCLIHost(cwd, loadNativeModule);
        const env = process.env;
        const headers = {
            // 'user-agent': 'devcontainer',
            'Authorization': await getAuthenticationToken(env, output, registry, id),
            'Accept': 'application/json',
        };

        const options = {
            type: 'GET',
            url: url,
            headers: headers
        };

        const response = JSON.parse((await request(options, output)).toString());
        output.write('Respone yay');
        output.write(response.toString());
        output.write(response);
        // output.write(JSON.parse(response.toString()));
    } catch (error) {
        output.write('Failed~~~~~');
    }
}

async function getAuthenticationToken(env: NodeJS.ProcessEnv, output: Log, registry: string, id: string): Promise<string> {
    // TODO: Use operating system keychain to get credentials.
    // TODO: Fallback to read docker config to get credentials.

    // const githubToken = env['GITHUB_TOKEN'];

    // if (githubToken) {
    //     output.write('Found GITHUB_TOKEN');
    //     return 'Bearer ' + githubToken;
    // } else {
        console.log(env['GITHUB_TOKEN']);
        output.write(`Fetching GHCR token`);
        if (registry === 'ghcr.io') {
            const token = await getGHCRtoken(output, id);
            output.write(token);
            output.write('fetched');
            return 'Bearer ' + token;
        }
    // }

    return '';
}

export async function getGHCRtoken(output: Log, id: string) {
    const headers = {
        'user-agent': 'devcontainer',
    };

    const url = `https://ghcr.io/token?scope=repo:${id}:pull&service=ghcr.io`;

    const options = {
        type: 'GET',
        url: url,
        headers: headers
    };

    const token = JSON.parse((await request(options, output)).toString()).token;

    return token;
}