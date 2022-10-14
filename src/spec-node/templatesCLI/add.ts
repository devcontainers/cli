import { Argv } from 'yargs';
import { mapLogLevel } from '../../spec-utils/log';
import { getPackageConfig } from '../../spec-utils/product';
import { createLog } from '../devContainers';
import { UnpackArgv } from '../devContainersSpecCLI';
import { fetchTemplate, SelectedTemplate } from '../../spec-configuration/containerTemplatesOCI';

export function templateAddOptions(y: Argv) {
	return y
		.options({
			'workspace-folder': { type: 'string', alias: 'w', default: '.', description: 'Target Directory' },
			'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' }
		})
		.positional('templateId', { type: 'string', demandOption: true, description: 'Name of reference to template in an OCI registry' })
		.check(_argv => {
			return true;
		});
}

export type TemplateAddArgs = UnpackArgv<ReturnType<typeof templateAddOptions>>;

export function templateAddHandler(args: TemplateAddArgs) {
	(async () => await templateAdd(args))().catch(console.error);
}

async function templateAdd({
	'templateId': templateId,
	'log-level': inputLogLevel,
	'workspace-folder': workspaceFolder,
}: TemplateAddArgs) {
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

	const selectedTemplate: SelectedTemplate = {
		id: templateId,
		options: {},
		features: []
	};

	await fetchTemplate(output, selectedTemplate, workspaceFolder);

	process.exit();
}
