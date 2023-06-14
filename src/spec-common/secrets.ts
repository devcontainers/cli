import { Log, LogLevel } from '../spec-utils/log';
import { CLIHost } from './commonUtils';
import * as jsonc from 'jsonc-parser';
import { ContainerError } from './errors';
import { ParseError } from 'jsonc-parser';

const MASK = '********';

export async function readSecretsFromFile(params: { output?: Log; secretsFile?: string; cliHost: CLIHost }) {
	const { secretsFile, cliHost, output } = params;
	if (!secretsFile) {
		return {};
	}

	try {
		const fileBuff = await cliHost.readFile(secretsFile);
		const parseErrors: ParseError[] = [];
		const secrets = jsonc.parse(fileBuff.toString(), parseErrors) as Record<string, string>;
		if (parseErrors.length) {
			throw new Error('Invalid json data');
		}

		return secrets;
	}
	catch (e) {
		if (output) {
			output.write(`Failed to read/parse secrets from file '${secretsFile}'`, LogLevel.Error);
		}

		throw new ContainerError({
			description: 'Failed to read/parse secrets',
			originalError: e
		});
	}
}

export async function maskSecrets(secretsP: Promise<Record<string, string>>, text: string) {
	const secretValues = Object.values(await secretsP);
	secretValues.forEach(secret => {
		const regex = new RegExp(secret, 'g');
		text = text.replace(regex, MASK);
	});

	return text;
}