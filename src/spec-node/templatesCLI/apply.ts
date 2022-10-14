import { Argv } from 'yargs';
import { Log, LogLevel, mapLogLevel } from '../../spec-utils/log';
import { getPackageConfig } from '../../spec-utils/product';
import { createLog } from '../devContainers';
import * as jsonc from 'jsonc-parser';
import { UnpackArgv } from '../devContainersSpecCLI';
import { fetchTemplate, SelectedTemplate, TemplateFeatureOption, TemplateOptions } from '../../spec-configuration/containerTemplatesOCI';

export function templateApplyOptions(y: Argv) {
	return y
		.options({
			'workspace-folder': { type: 'string', alias: 'w', demandOption: true, default: '.', description: 'Target workspace folder to apply Template' },
			'template-id': { type: 'string', alias: 't', demandOption: true, description: 'Reference to a Template in a supported OCI registry' },
			'template-args': { type: 'string', alias: 'a', default: '{}', description: 'Arguments to replace within the provided Template, provided as JSON' },
			'features': { type: 'string', alias: 'f', default: '[]', description: 'Features to add to the provided Template, provided as JSON.' },
			'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' }
		})
		.check(_argv => {
			return true;
		});
}

export type TemplateApplyArgs = UnpackArgv<ReturnType<typeof templateApplyOptions>>;

export function templateApplyHandler(args: TemplateApplyArgs) {
	(async () => await templateApply(args))().catch(console.error);
}

async function templateApply({
	'workspace-folder': workspaceFolder,
	'template-id': templateId,
	'template-args': templateArgs,
	'features': featuresArgs,
	'log-level': inputLogLevel,
}: TemplateApplyArgs) {
	const disposables: (() => Promise<unknown> | undefined)[] = [];

	const pkg = getPackageConfig();

	// const cwd = process.cwd();
	// const cliHost = await getCLIHost(cwd, loadNativeModule);
	const output = createLog({
		logLevel: mapLogLevel(inputLogLevel),
		logFormat: 'text',
		log: (str) => process.stdout.write(str),
		terminalDimensions: undefined,
	}, pkg, new Date(), disposables);

	const id = templateId;
	if (!validateTemplateId(output, id)) {
		output.write(`Invalid template id '${id}'.`, LogLevel.Error);
		process.exit(1);
	}

	output.write(`Preparing to parse templateArgs: ${templateArgs}`, LogLevel.Trace);
	let templateArgsErrors: jsonc.ParseError[] = [];
	const options = jsonc.parse(templateArgs, templateArgsErrors);
	output.write(`Pared templateArgs as : ${JSON.stringify(options)}`, LogLevel.Trace);

	if (!options || !validateTemplateOptions(output, options, templateArgsErrors)) {
		output.write('Invalid template arguments provided.', LogLevel.Error);
		process.exit(1);
	}
	const features = jsonc.parse(featuresArgs);
	let featuresArgsErrors: jsonc.ParseError[] = [];
	if (!features || !validateTemplateFeatureOption(output, features, featuresArgsErrors)) {
		output.write('Invalid template arguments provided.', LogLevel.Error);
		process.exit(1);
	}

	const selectedTemplate: SelectedTemplate = {
		id: templateId,
		options,
		features
	};

	await fetchTemplate(output, selectedTemplate, workspaceFolder);
	process.exit();
}

function validateTemplateId(_output: Log, _target: unknown): _target is string {
	// TODO: Validate that the input is a valid OCI identifier for a Templatem
	return true;
}

function validateTemplateOptions(output: Log, _target: unknown, errors: jsonc.ParseError[]): _target is TemplateOptions {
	if (hasJsonParseError(output, errors)) {
		return false;
	}

	// TODO: Do validation of provided JSON string.
	return true;
}

function validateTemplateFeatureOption(output: Log, _target: unknown, errors: jsonc.ParseError[]): _target is TemplateFeatureOption[] {
	if (hasJsonParseError(output, errors)) {
		return false;
	}

	// TODO: Do validation of provided JSON string.
	return true;
}


function hasJsonParseError(output: Log, errors: jsonc.ParseError[]) {
	for (const error of errors) {
		output.write(`JSON parse error: ${jsonc.printParseErrorCode(error.error)}`, LogLevel.Error);
	}
	return errors.length > 0;
}

