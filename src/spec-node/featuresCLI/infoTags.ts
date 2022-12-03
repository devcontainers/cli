import { Argv } from 'yargs';
import { getPublishedVersions, getRef } from '../../spec-configuration/containerCollectionsOCI';
import { Log, LogLevel, mapLogLevel } from '../../spec-utils/log';
import { getPackageConfig } from '../../spec-utils/product';
import { createLog } from '../devContainers';
import { UnpackArgv } from '../devContainersSpecCLI';

export function featuresInfoTagsOptions(y: Argv) {
	return y
		.options({
			'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' },
			'output-format': { choices: ['text' as 'text', 'json' as 'json'], default: 'text', description: 'Output format.' },
		})
		.positional('feature', { type: 'string', demandOption: true, description: 'Feature Id' });
}

export type FeaturesInfoTagsArgs = UnpackArgv<ReturnType<typeof featuresInfoTagsOptions>>;

export function featureInfoTagsHandler(args: FeaturesInfoTagsArgs) {
	(async () => await featuresInfoTags(args))().catch(console.error);
}

async function featuresInfoTags({
	'feature': featureId,
	'log-level': inputLogLevel,
	'output-format': outputFormat,
}: FeaturesInfoTagsArgs) {
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

	const featureOciRef = getRef(output, featureId);
	if (!featureOciRef) {
		if (outputFormat === 'json') {
			console.log(JSON.stringify({}), LogLevel.Info);
		} else {
			console.log(`Failed to parse Feature identifier '${featureId}'\n`, LogLevel.Error);
		}
		process.exit(1);
	}

	const publishedVersions = await getPublishedVersions(featureOciRef, output, true);
	if (!publishedVersions || publishedVersions.length === 0) {
		if (outputFormat === 'json') {
			console.log(JSON.stringify({}), LogLevel.Info);
		} else {
			console.log(`No published versions found for feature '${featureId}'\n`, LogLevel.Error);
		}
		process.exit(1);
	}

	const data: { publishedVersions: string[] } = {
		publishedVersions
	};

	if (outputFormat === 'json') {
		printAsJson(data);
	} else {
		printAsPlainText(data);
	}

	await dispose();
	process.exit(0);
}

function printAsJson(data: { publishedVersions: string[] }) {
	console.log(JSON.stringify(data, null, 2));
}

function printAsPlainText(data: { publishedVersions: string[] }) {
	console.log(`Published Versions: \n   ${data.publishedVersions.join('\n   ')}\n`);
}
