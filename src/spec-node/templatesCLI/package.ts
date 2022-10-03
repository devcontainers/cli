import { Argv } from 'yargs';
import { getCLIHost } from '../../spec-common/cliHost';
import { loadNativeModule } from '../../spec-common/commonUtils';
import { mapLogLevel } from '../../spec-utils/log';
import { getPackageConfig } from '../../spec-utils/product';
import { createLog } from '../devContainers';
import { UnpackArgv } from '../devContainersSpecCLI';
import { PackageCommandInput, PackageOptions } from '../collectionCommonUtils/package';
import { doTemplatesPackageCommand } from './packageCommandImpl';

export function templatesPackageOptions(y: Argv) {
	return PackageOptions(y, 'template');
}

export type TemplatesPackageArgs = UnpackArgv<ReturnType<typeof templatesPackageOptions>>;

export function templatesPackageHandler(args: TemplatesPackageArgs) {
	(async () => await templatesPackage(args))().catch(console.error);
}

async function templatesPackage({
	'target': targetFolder,
	'log-level': inputLogLevel,
	'output-folder': outputDir,
	'force-clean-output-folder': forceCleanOutputDir,
}: TemplatesPackageArgs) {
	const disposables: (() => Promise<unknown> | undefined)[] = [];
	const dispose = async () => {
		await Promise.all(disposables.map(d => d()));
	};

	const pkg = getPackageConfig();

	const cwd = process.cwd();
	const cliHost = await getCLIHost(cwd, loadNativeModule);
	const output = createLog({
		logLevel: mapLogLevel(inputLogLevel),
		logFormat: 'text',
		log: (str) => process.stdout.write(str),
		terminalDimensions: undefined,
	}, pkg, new Date(), disposables);

	const args: PackageCommandInput = {
		cliHost,
		targetFolder,
		outputDir,
		output,
		disposables,
		forceCleanOutputDir: forceCleanOutputDir
	};

	const exitCode = !!(await doTemplatesPackageCommand(args)) ? 0 : 1;

	await dispose();
	process.exit(exitCode);
}
