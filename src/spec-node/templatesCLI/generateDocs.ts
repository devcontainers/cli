import { Argv } from 'yargs';
import { UnpackArgv } from '../devContainersSpecCLI';
import { generateDocumentation, prepGenerateDocsCommand } from '../collectionCommonUtils/generateDocsCommandImpl';
import { createLog } from '../devContainers';
import { mapLogLevel } from '../../spec-utils/log';
import { getPackageConfig } from '../../spec-utils/product';
import { GenerateDocsCommandInput, GenerateDocsOptions } from '../collectionCommonUtils/generateDocs';
import { getCLIHost } from '../../spec-common/cliHost';
import { loadNativeModule } from '../../spec-common/commonUtils';
import { isLocalFolder } from '../../spec-utils/pfs';

const collectionType = 'template';

export function templatesGenerateDocsOptions(y: Argv) {
	return GenerateDocsOptions(y, collectionType);
}

export type TemplatesGenerateDocsArgs = UnpackArgv<ReturnType<typeof templatesGenerateDocsOptions>>;

export function templatesGenerateDocsHandler(args: TemplatesGenerateDocsArgs) {
	(async () => await templatesGenerateDocs(args))().catch(console.error);
}

export async function templatesGenerateDocs({
	'target': targetFolder,
	'github-owner': gitHubOwner,
	'github-repo': gitHubRepo,
	'log-level': inputLogLevel,
}: TemplatesGenerateDocsArgs) {
	const disposables: (() => Promise<unknown> | undefined)[] = [];
	const dispose = async () => {
		await Promise.all(disposables.map(d => d()));
	};

	const pkg = getPackageConfig();

	const cwd = process.cwd();
	const cliHost = await getCLIHost(cwd, loadNativeModule, true);
	const output = createLog({
		logLevel: mapLogLevel(inputLogLevel),
		logFormat: 'text',
		log: (str) => process.stderr.write(str),
		terminalDimensions: undefined,
	}, pkg, new Date(), disposables);

	const targetFolderResolved = cliHost.path.resolve(targetFolder);
	if (!(await isLocalFolder(targetFolderResolved))) {
		throw new Error(`Target folder '${targetFolderResolved}' does not exist`);
	}


	const args: GenerateDocsCommandInput = {
		cliHost,
		targetFolder,
		gitHubOwner,
		gitHubRepo,
		output,
		disposables,
	};

	const preparedArgs = await prepGenerateDocsCommand(args, collectionType);

	await generateDocumentation(preparedArgs, collectionType);

	await dispose();
	process.exit();
}
