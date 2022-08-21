import path from 'path';
import { Argv } from 'yargs';
import { CLIHost } from '../../spec-common/cliHost';
import { getFeatureRef, getPublishedVersions } from '../../spec-configuration/containerFeaturesOCI';
import { LogLevel, mapLogLevel } from '../../spec-utils/log';
import { createLog } from '../devContainers';
import { UnpackArgv } from '../devContainersSpecCLI';
import { getPackageConfig } from '../utils';

export function featuresInfoOptions(y: Argv) {
	return y
		.options({
			'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' },
		})
		.positional('featureId', { type: 'string', demandOption: true, description: 'Feature Id' })
		.check(_argv => {
			return true;
		});
}

export type FeaturesInfoArgs = UnpackArgv<ReturnType<typeof featuresInfoOptions>>;
export interface FeaturesInfoCommandInput {
	cliHost: CLIHost;
	featureId: string;
}

export function featuresInfoHandler(args: FeaturesInfoArgs) {
	(async () => await featuresInfo(args))().catch(console.error);
}

async function featuresInfo({
	'featureId': featureId,
	'log-level': inputLogLevel,
}: FeaturesInfoArgs) {
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

	const featureOciRef = getFeatureRef(output, featureId);

	const publishedVersions = await getPublishedVersions(featureOciRef, output);

	if (!publishedVersions) {
		output.write(`No published versions found for feature ${featureId}`, LogLevel.Error);
		process.exit(1);
	}

	output.write(`Published versions: ${publishedVersions.join(', ')}`, LogLevel.Info);


	await dispose();
	process.exit(0);
}
