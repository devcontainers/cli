import * as path from 'path';
import * as jsonc from 'jsonc-parser';
import { Argv } from 'yargs';
import { LogLevel, mapLogLevel } from '../../spec-utils/log';
import { getPackageConfig } from '../../spec-utils/product';
import { createLog } from '../devContainers';
import { UnpackArgv } from '../devContainersSpecCLI';
import { isLocalFile, readLocalFile } from '../../spec-utils/pfs';
import { DevContainerConfig, DevContainerFeature } from '../../spec-configuration/configuration';
import { buildDependencyGraph, computeDependsOnInstallationOrder, generateMermaidDiagram } from '../../spec-configuration/containerFeaturesOrder';
import { OCISourceInformation, processFeatureIdentifier, userFeaturesToArray } from '../../spec-configuration/containerFeaturesConfiguration';

interface JsonOutput {
	installOrder?: {
		id: string;
		options: string | boolean | Record<string, string | boolean | undefined>;
	}[];
}

export function featuresResolveDependenciesOptions(y: Argv) {
	return y
		.options({
			'log-level': { choices: ['error' as 'error', 'info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'error' as 'error', description: 'Log level.' },
			'workspace-folder': { type: 'string', description: 'Workspace folder to use for the configuration.', demandOption: true },
		});
}

export type featuresResolveDependenciesArgs = UnpackArgv<ReturnType<typeof featuresResolveDependenciesOptions>>;

export function featuresResolveDependenciesHandler(args: featuresResolveDependenciesArgs) {
	(async () => await featuresResolveDependencies(args))().catch(console.error);
}

async function featuresResolveDependencies({
	'workspace-folder': workspaceFolder,
	'log-level': inputLogLevel,
}: featuresResolveDependenciesArgs) {
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

	let jsonOutput: JsonOutput = {};

	// Detect path to dev container config
	let configPath = path.join(workspaceFolder, '.devcontainer.json');
	if (!(await isLocalFile(configPath))) {
		configPath = path.join(workspaceFolder, '.devcontainer', 'devcontainer.json');
	}

	// Load dev container config
	const buffer = await readLocalFile(configPath);
	if (!buffer) {
		output.write(`Could not load devcontainer.json file from path ${configPath}`, LogLevel.Error);
		process.exit(1);
	}

	//  Parse dev container config
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

	const graph = await buildDependencyGraph(params, processFeature, userFeaturesConfig, config);
	const worklist = graph?.worklist!;
	console.log(generateMermaidDiagram(worklist));

	const installOrder = await computeDependsOnInstallationOrder(params, processFeature, userFeaturesConfig, config, graph);

	if (!installOrder) {
		// Bold
		output.write(`\u001b[1mNo viable installation order!\u001b[22m`, LogLevel.Error);
		process.exit(1);
	}

	// Output the install order, if one exists.
	// JSON
	jsonOutput = {
		...jsonOutput,
		installOrder: installOrder.map(f => {
			const sourceInfo = f?.sourceInformation;
			switch (sourceInfo.type) {
				case 'oci':
					const featureRef = (sourceInfo as OCISourceInformation).featureRef;
					return {
						id: `${featureRef.resource}@${sourceInfo.manifestDigest}`,
						options: f?.features[0].value
					};
				default:
					return {
						id: f.sourceInformation.userFeatureId,
						options: f?.features[0].value
					};
			}
		})
	};


	console.log(JSON.stringify(jsonOutput, undefined, 2));
	await dispose();
	process.exit();
}