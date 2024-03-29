import { Argv } from 'yargs';
import { UnpackArgv } from '../devContainersSpecCLI';
import { createLog } from '../devContainers';
import { mapLogLevel } from '../../spec-utils/log';
import { getPackageConfig } from '../../spec-utils/product';
import { isLocalFolder } from '../../spec-utils/pfs';
import { getCLIHost } from '../../spec-common/cliHost';
import { loadNativeModule } from '../../spec-common/commonUtils';
import { GenerateDocsCommandInput, GenerateDocsOptions } from '../collectionCommonUtils/generateDocs';
import { generateDocumentation, prepGenerateDocsCommand } from '../collectionCommonUtils/generateDocsCommandImpl';

const collectionType = 'feature';

export function featuresGenerateDocsOptions(y: Argv) {
	return GenerateDocsOptions(y, collectionType);
}

export type FeaturesGenerateDocsArgs = UnpackArgv<ReturnType<typeof featuresGenerateDocsOptions>>;

export function featuresGenerateDocsHandler(args: FeaturesGenerateDocsArgs) {
	(async () => await featuresGenerateDocs(args))().catch(console.error);
}

export async function featuresGenerateDocs({
	'target': targetFolder,
	'registry': registry,
	'namespace': namespace,
	'github-owner': gitHubOwner,
	'github-repo': gitHubRepo,
	'log-level': inputLogLevel,
}: FeaturesGenerateDocsArgs) {
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
		registry,
		namespace,
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
