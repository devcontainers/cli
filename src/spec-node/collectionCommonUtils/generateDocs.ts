import { Argv } from 'yargs';
import { CLIHost } from '../../spec-common/cliHost';
import { Log } from '../../spec-utils/log';

const targetPositionalDescription = (collectionType: GenerateDocsCollectionType) => `
Generate docs of ${collectionType}s at provided [target] (default is cwd), where [target] is either:
   1. A path to the src folder of the collection with [1..n] ${collectionType}s.
   2. A path to a single ${collectionType} that contains a devcontainer-${collectionType}.json.
`;

export function GenerateDocsOptions(y: Argv, collectionType: GenerateDocsCollectionType) {
	return y
		.options({
			'registry': { type: 'string', alias: 'r', default: 'ghcr.io', description: 'Name of the OCI registry.', hidden: collectionType !== 'feature' },
			'namespace': { type: 'string', alias: 'n', require: collectionType === 'feature', description: `Unique indentifier for the collection of features. Example: <owner>/<repo>`, hidden: collectionType !== 'feature' },
			'github-owner': { type: 'string', default: '', description: `GitHub owner for docs.` },
			'github-repo': { type: 'string', default: '', description: `GitHub repo for docs.` },
			'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' }
		})
		.positional('target', { type: 'string', default: '.', description: targetPositionalDescription(collectionType) })
		.check(_argv => {
			return true;
		});
}

export type GenerateDocsCollectionType = 'feature' | 'template';

export interface GenerateDocsCommandInput {
	cliHost: CLIHost;
	targetFolder: string;
	registry?: string;
	namespace?: string;
	gitHubOwner: string;
	gitHubRepo: string;
	output: Log;
	disposables: (() => Promise<unknown> | undefined)[];
	isSingle?: boolean; // Generating docs for a collection of many features/templates. Should autodetect.
}
