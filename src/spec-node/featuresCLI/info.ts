import { Argv } from 'yargs';
import { getPublishedVersions, getRef } from '../../spec-configuration/containerCollectionsOCI';
import { Log, LogLevel, mapLogLevel } from '../../spec-utils/log';
import { getPackageConfig } from '../../spec-utils/product';
import { createLog } from '../devContainers';
import { UnpackArgv } from '../devContainersSpecCLI';

export function featuresInfoOptions(y: Argv) {
	return y
		.options({
			'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' },
			'output-format': { choices: ['text' as 'text', 'json' as 'json'], default: 'text', description: 'Output format.' },
		})
		.positional('featureId', { type: 'string', demandOption: true, description: 'Feature Id' });
}

export type FeaturesInfoArgs = UnpackArgv<ReturnType<typeof featuresInfoOptions>>;

export function featuresInfoHandler(args: FeaturesInfoArgs) {
	(async () => await featuresInfo(args))().catch(console.error);
}

async function featuresInfo({
	'featureId': featureId,
	'log-level': inputLogLevel,
	'output-format': outputFormat,
}: FeaturesInfoArgs) {
	const disposables: (() => Promise<unknown> | undefined)[] = [];
	const dispose = async () => {
		await Promise.all(disposables.map(d => d()));
	};

	const pkg = getPackageConfig();

	const output = createLog({
		logLevel: mapLogLevel(inputLogLevel),
		logFormat: 'text',
		log: (str) => process.stdout.write(str),
		terminalDimensions: undefined,
	}, pkg, new Date(), disposables, true);

	const featureOciRef = getRef(output, featureId);
	if (!featureOciRef) {
		if (outputFormat === 'json') {
			output.raw(JSON.stringify({}), LogLevel.Info);
		} else {
			output.raw(`Failed to parse Feature identifier '${featureId}'\n`, LogLevel.Error);
		}
		process.exit(1);
	}

	const publishedVersions = await getPublishedVersions(featureOciRef, output, true);
	if (!publishedVersions || publishedVersions.length === 0) {
		if (outputFormat === 'json') {
			output.raw(JSON.stringify({}), LogLevel.Info);
		} else {
			output.raw(`No published versions found for feature '${featureId}'\n`, LogLevel.Error);
		}
		process.exit(1);
	}

	const data: { publishedVersions: string[] } = {
		publishedVersions
	};

	if (outputFormat === 'json') {
		printAsJson(output, data);
	} else {
		printAsPlainText(output, data);
	}

	await dispose();
	process.exit(0);
}

function printAsJson(output: Log, data: { publishedVersions: string[] }) {
	output.raw(JSON.stringify(data, null, 2), LogLevel.Info);
}

function printAsPlainText(output: Log, data: { publishedVersions: string[] }) {
	output.raw(`Published Versions: \n   ${data.publishedVersions.join('\n   ')}\n`, LogLevel.Info);
}
