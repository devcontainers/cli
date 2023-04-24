import * as path from 'path';
import * as jsonc from 'jsonc-parser';

import { Argv } from 'yargs';
import { OCIManifest } from '../../spec-configuration/containerCollectionsOCI';
import { LogLevel, mapLogLevel } from '../../spec-utils/log';
import { getPackageConfig } from '../../spec-utils/product';
import { createLog } from '../devContainers';
import { UnpackArgv } from '../devContainersSpecCLI';
import { FNode, buildDependencyGraphFromConfig } from '../../spec-configuration/containerFeaturesOrder';
import { readLocalFile } from '../../spec-utils/pfs';
import { DevContainerConfig } from '../../spec-configuration/configuration';

export function featuresReadConfigurationOptions(y: Argv) {
	return y
		.options({
			'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' },
			'output-format': { choices: ['text' as 'text', 'json' as 'json'], default: 'text', description: 'Output format.' },
			'workspace-folder': { type: 'string', description: 'Workspace folder to use for the configuration.', demandOption: true },
		});
}

export type featuresReadConfigurationArgs = UnpackArgv<ReturnType<typeof featuresReadConfigurationOptions>>;

export function featuresReadConfigurationHandler(args: featuresReadConfigurationArgs) {
	(async () => await featuresReadConfiguration(args))().catch(console.error);
}

interface InfoJsonOutput {
	manifest?: OCIManifest;
	canonicalId?: string;
	publishedVersions?: string[];
	dependsOn?: FNode[];
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

	const params = { output, env: process.env, outputFormat };

	const jsonOutput: InfoJsonOutput = {};

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
	const installOrder = await buildDependencyGraphFromConfig(params, config);

	if (!installOrder) {
		output.write(`Could not calculate install order`, LogLevel.Error);
		process.exit(1);
	}

	output.raw('\n');
	for (const node of installOrder) {
		const { id, options, /*version*/ } = node;
		const str = `${id}\n${options ? JSON.stringify(options) : ''}`;
		const box = encloseStringInBox(str);
		output.raw(`${box}\n`, LogLevel.Info);
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

