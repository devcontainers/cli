import * as path from 'path';
import * as jsonc from 'jsonc-parser';

import { Argv } from 'yargs';
import { LogLevel, mapLogLevel } from '../../spec-utils/log';
import { getPackageConfig } from '../../spec-utils/product';
import { createLog } from '../devContainers';
import { UnpackArgv } from '../devContainersSpecCLI';
import { readLocalFile } from '../../spec-utils/pfs';
import { DevContainerConfig, DevContainerFeature } from '../../spec-configuration/configuration';
import { computeDependsOnInstallationOrder } from '../../spec-configuration/containerFeaturesOrder';
import { SourceInformation, processFeatureIdentifier, userFeaturesToArray } from '../../spec-configuration/containerFeaturesConfiguration';

export function featuresReadConfigurationOptions(y: Argv) {
	return y
		.options({
			'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' },
			'output-format': { choices: ['text' as 'text', 'json' as 'json'], default: 'json', description: 'Output format.' },
			'workspace-folder': { type: 'string', description: 'Workspace folder to use for the configuration.', demandOption: true },
		});
}

export type featuresReadConfigurationArgs = UnpackArgv<ReturnType<typeof featuresReadConfigurationOptions>>;

export function featuresReadConfigurationHandler(args: featuresReadConfigurationArgs) {
	(async () => await featuresReadConfiguration(args))().catch(console.error);
}


interface InstallOrderItem {
	// TODO
	sourceInformation: SourceInformation;
}

interface JsonOutput {
	installOrder?: InstallOrderItem[];
}

async function featuresReadConfiguration({
	'workspace-folder': workspaceFolder,
	'log-level': inputLogLevel,
	'output-format': outputFormat,
}: featuresReadConfigurationArgs) {
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

	// const params = { output, env: process.env, outputFormat };

	const jsonOutput: JsonOutput = {};

	// Get dev container from workspace folder
	// TODO, do better.
	const configPath = path.join(workspaceFolder, '.devcontainer.json');

	// ---- Load dev container config
	const buffer = await readLocalFile(configPath);
	if (!buffer) {
		output.write(`Could not load devcontainer.json file from path ${configPath}`, LogLevel.Error);
		process.exit(1);
	}
	//  -- Parse dev container config
	const config: DevContainerConfig = jsonc.parse(buffer.toString());
	if (!config || !config.features) {
		output.write(`No Features object in configuration '${configPath}'`, LogLevel.Error);
		process.exit(1);
	}
	const userFeaturesConfig = userFeaturesToArray(config);
	if (!userFeaturesConfig) {
		output.write(`Could not parse features object in configuration '${configPath}'`, LogLevel.Error);
		process.exit(1);
	}
	const params = {
		output,
		env: process.env,
	};

	const processFeature = async (_userFeature: DevContainerFeature) => {
		return await processFeatureIdentifier(params, configPath, workspaceFolder, _userFeature);
	};

	const installOrder = await computeDependsOnInstallationOrder(params, processFeature, userFeaturesConfig);

	if (!installOrder) {
		output.write(`Could not calculate install order`, LogLevel.Error);
		process.exit(1);
	}

	if (outputFormat === 'text') {
		output.raw('\n');
		for (let i = 0; i < installOrder.length; i++) {
			const featureSet = installOrder[i];
			const sourceInfo = featureSet.sourceInformation;
			const userFeatureId = sourceInfo.userFeatureId;
			const options = featureSet.features[0].value;
			// TODO: Temp for debugging
			if (sourceInfo.type === 'oci') {
				const str = `${sourceInfo.featureRef.resource}\n${sourceInfo.manifestDigest}\n${options ? JSON.stringify(options) : ''}\n(Resolved from: '${userFeatureId}')`;
				const box = encloseStringInBox(str);
				output.raw(`${box}\n`, LogLevel.Info);
			} else {
				const str = `${sourceInfo.userFeatureId}\n${options ? JSON.stringify(options) : ''}\n(Resolved from: '${userFeatureId}')`;
				const box = encloseStringInBox(str);
				output.raw(`${box}\n`, LogLevel.Info);
			}

		}
	} else {
		// JSON
		jsonOutput.installOrder = [];
		for (let i = 0; i < installOrder.length; i++) {
			const { sourceInformation } = installOrder[i];
			jsonOutput.installOrder.push({ sourceInformation });
		}
	}

	// -- Output and clean up
	if (outputFormat === 'json') {
		console.log(JSON.stringify(jsonOutput, undefined, 4));
	}
	await dispose();
	process.exit();
}


function encloseStringInBox(str: string, indent: number = 0) {
	const lines = str.split('\n');
	lines[0] = `\u001b[1m${lines[0]}\u001b[22m`; // Bold
	const maxWidth = Math.max(...lines.map(l => l.length - (l.includes('\u001b[1m') ? 9 : 0)));
	const box = [
		'┌' + '─'.repeat(maxWidth) + '┐',
		...lines.map(l => '│' + l.padEnd(maxWidth + (lines.length > 1 && l.includes('\u001b[1m') ? 9 : 0)) + '│'),
		'└' + '─'.repeat(maxWidth) + '┘',
	];
	return box.map(t => `${' '.repeat(indent)}${t}`).join('\n');
}

