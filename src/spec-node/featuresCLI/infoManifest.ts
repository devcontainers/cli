import { Argv } from 'yargs';
import { fetchAuthorization, fetchOCIManifestIfExists, getPublishedVersions, getRef } from '../../spec-configuration/containerCollectionsOCI';
import { fetchOCIFeatureManifestIfExistsFromUserIdentifier } from '../../spec-configuration/containerFeaturesOCI';
import { Log, LogLevel, mapLogLevel } from '../../spec-utils/log';
import { getPackageConfig } from '../../spec-utils/product';
import { createLog } from '../devContainers';
import { UnpackArgv } from '../devContainersSpecCLI';

export function featuresInfoManifestOptions(y: Argv) {
	return y
		.options({
			'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' },
			'output-format': { choices: ['text' as 'text', 'json' as 'json'], default: 'text', description: 'Output format.' },
		})
		.positional('feature', { type: 'string', demandOption: true, description: 'Feature Id' });
}

export type FeaturesInfoManifestArgs = UnpackArgv<ReturnType<typeof featuresInfoManifestOptions>>;

export function featuresInfoManifestHandler(args: FeaturesInfoManifestArgs) {
	(async () => await featuresInfoManifest(args))().catch(console.error);
}

async function featuresInfoManifest({
	'feature': featureId,
	'log-level': inputLogLevel,
	'output-format': outputFormat,
}: FeaturesInfoManifestArgs) {
	const disposables: (() => Promise<unknown> | undefined)[] = [];
	const dispose = async () => {
		await Promise.all(disposables.map(d => d()));
	};

	const pkg = getPackageConfig();

	const output = createLog({
		logLevel: mapLogLevel(inputLogLevel),
		logFormat: 'text',
		log: (str) => process.stderr.write(str),
		terminalDimensions: undefined,
	}, pkg, new Date(), disposables, true);


	const featureRef = getRef(output, featureId);
	if (!featureRef) {
		return undefined;
	}
	const authorization = await fetchAuthorization(output, featureRef.registry, featureRef.path, process.env, 'pull');
	const manifest = await fetchOCIManifestIfExists(output, process.env, featureRef, undefined, authorization);

	console.log(JSON.stringify(manifest, undefined, 4));
	process.exit();
}
