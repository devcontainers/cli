import { Argv } from 'yargs';
import { UnpackArgv } from '../devContainersSpecCLI';
import { outdated } from './outdatedCommandImpl';

export function outdatedOptions(y: Argv) {
	return y.options({
		'user-data-folder': { type: 'string', description: 'Host path to a directory that is intended to be persisted and share state between sessions.' },
		'workspace-folder': { type: 'string', required: true, description: 'Workspace folder path. The devcontainer.json will be looked up relative to this path.' },
		'config': { type: 'string', description: 'devcontainer.json path. The default is to use .devcontainer/devcontainer.json or, if that does not exist, .devcontainer.json in the workspace folder.' },
		'output-format': { choices: ['text' as 'text', 'json' as 'json'], default: 'text', description: 'Output format.' },
		'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level for the --terminal-log-file. When set to trace, the log level for --log-file will also be set to trace.' },
		'log-format': { choices: ['text' as 'text', 'json' as 'json'], default: 'text' as 'text', description: 'Log format.' },
		'terminal-columns': { type: 'number', implies: ['terminal-rows'], description: 'Number of columns to render the output for. This is required for some of the subprocesses to correctly render their output.' },
		'terminal-rows': { type: 'number', implies: ['terminal-columns'], description: 'Number of rows to render the output for. This is required for some of the subprocesses to correctly render their output.' },
	});
}

export type OutdatedArgs = UnpackArgv<ReturnType<typeof outdatedOptions>>;

export function outdatedHandler(args: OutdatedArgs) {
	(async () => outdated(args))().catch(console.error);
}
