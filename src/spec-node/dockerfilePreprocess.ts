/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CLIHost } from '../spec-common/cliHost';
import { ContainerError } from '../spec-common/errors';
import { randomUUID } from 'crypto';

const preprocessorDirective = /^\s*#\s*(\w+)\b(.*)$/;
const includeLine = /^\s*"([^"]+)"\s*$/;
const defineLine = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(.*))?$/;
const undefLine = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*$/;
const ifdefLine = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*$/;
const fromLine = /^\s*FROM(?:\s|$)/mi;

interface ConditionalState {
	parentActive: boolean;
	thisActive: boolean;
	hasMatched: boolean;
}

export interface ResolvedDockerfile {
	originalDockerfilePath: string;
	effectiveDockerfileContent: string;
	preprocessed: boolean;
}

export interface MaterializedDockerfile {
	dockerfilePath: string;
	dispose(): Promise<void>;
}


/**
 * Preprocesses a Dockerfile, simulating cpp -E style preprocessing for Podman compatibility.
 * If the file ends with .in, it will resolve #include statements recursively and return the rewritten Dockerfile content.
 * Otherwise, returns the original Dockerfile content.
 *
 * @param cliHost CLIHost for file operations
 * @param dockerfilePath Path to the Dockerfile (may be .in)
 * @returns { originalDockerfilePath, effectiveDockerfileContent, preprocessed }
 */
export async function resolveDockerfileIncludesIfNeeded(cliHost: CLIHost, dockerfilePath: string): Promise<ResolvedDockerfile> {
	const dockerfileText = (await cliHost.readFile(dockerfilePath)).toString();
	if (!dockerfilePath.toLowerCase().endsWith('.in')) {
		return {
			originalDockerfilePath: dockerfilePath,
			effectiveDockerfileContent: dockerfileText,
			preprocessed: false,
		};
	}

	const rewrittenContent = await preprocessDockerfileIncludes(cliHost, dockerfilePath, [], new Map<string, string>());
	validateResolvedFromInstruction(dockerfilePath, rewrittenContent);

	return {
		originalDockerfilePath: dockerfilePath,
		effectiveDockerfileContent: rewrittenContent,
		preprocessed: true,
	};
}

export async function materializeResolvedDockerfileForBuild(cliHost: CLIHost, resolvedDockerfile: ResolvedDockerfile): Promise<MaterializedDockerfile> {
	if (!resolvedDockerfile.preprocessed) {
		return {
			dockerfilePath: resolvedDockerfile.originalDockerfilePath,
			dispose: async () => { },
		};
	}

	const dockerfilePath = await writePreprocessedDockerfile(cliHost, resolvedDockerfile.originalDockerfilePath, resolvedDockerfile.effectiveDockerfileContent);
	return {
		dockerfilePath,
		dispose: async () => {
			if (cliHost.deleteFile) {
				await cliHost.deleteFile(dockerfilePath);
			}
		},
	};
}

async function preprocessDockerfileIncludes(cliHost: CLIHost, currentPath: string, stack: string[], macros: Map<string, string>): Promise<string> {
	if (stack.includes(currentPath)) {
		const chain = [...stack, currentPath].join(' -> ');
		throw new ContainerError({ description: `Cyclic #include detected while preprocessing Dockerfile: ${chain}` });
	}
	if (!(await cliHost.isFile(currentPath))) {
		throw new ContainerError({ description: `Included Dockerfile not found: ${currentPath}` });
	}

	const currentText = (await cliHost.readFile(currentPath)).toString();
	const lines = currentText.split(/\r?\n/);
	const expanded: string[] = [];
	const nextStack = [...stack, currentPath];
	const conditionals: ConditionalState[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineNumber = i + 1;
		const currentActive = conditionals.length === 0 ? true : conditionals[conditionals.length - 1].thisActive;
		const directive = preprocessorDirective.exec(line);

		if (!directive) {
			if (currentActive) {
				expanded.push(substituteMacros(line, macros));
			}
			continue;
		}

		const directiveName = directive[1].toLowerCase();
		const directiveBody = directive[2] ?? '';

		if (directiveName === 'if' || directiveName === 'ifdef' || directiveName === 'ifndef') {
			const parentActive = currentActive;
			const condition = evaluateIfDirectiveCondition(currentPath, lineNumber, directiveName, directiveBody, macros);
			const thisActive = parentActive && condition;
			conditionals.push({
				parentActive,
				thisActive,
				hasMatched: thisActive,
			});
			continue;
		}

		if (directiveName === 'elif') {
			const state = conditionals[conditionals.length - 1];
			if (!state) {
				throw new ContainerError({ description: `#elif without matching #if in ${currentPath}:${lineNumber}` });
			}
			if (!state.parentActive || state.hasMatched) {
				state.thisActive = false;
				continue;
			}
			const elifCondition = evaluateIfDirectiveCondition(currentPath, lineNumber, directiveName, directiveBody, macros);
			state.thisActive = state.parentActive && elifCondition;
			if (state.thisActive) {
				state.hasMatched = true;
			}
			continue;
		}

		if (directiveName === 'else') {
			const state = conditionals[conditionals.length - 1];
			if (!state) {
				throw new ContainerError({ description: `#else without matching #if in ${currentPath}:${lineNumber}` });
			}
			state.thisActive = state.parentActive && !state.hasMatched;
			state.hasMatched = true;
			continue;
		}

		if (directiveName === 'endif') {
			const state = conditionals.pop();
			if (!state) {
				throw new ContainerError({ description: `#endif without matching #if in ${currentPath}:${lineNumber}` });
			}
			continue;
		}

		if (!currentActive) {
			continue;
		}

		switch (directiveName) {
			case 'include': {
				const includeMatch = includeLine.exec(directiveBody);
				if (!includeMatch) {
					throw new ContainerError({ description: `Invalid #include directive in ${currentPath}:${lineNumber}. Use #include "path".` });
				}
				const includePath = substituteMacros(includeMatch[1], macros);
				const resolvedIncludePath = cliHost.path.isAbsolute(includePath)
					? includePath
					: cliHost.path.resolve(cliHost.path.dirname(currentPath), includePath);
				expanded.push(await preprocessDockerfileIncludes(cliHost, resolvedIncludePath, nextStack, macros));
				break;
			}
			case 'define': {
				const defineMatch = defineLine.exec(directiveBody);
				if (!defineMatch) {
					throw new ContainerError({ description: `Invalid #define directive in ${currentPath}:${lineNumber}.` });
				}
				macros.set(defineMatch[1], defineMatch[2] ?? '1');
				break;
			}
			case 'undef': {
				const undefMatch = undefLine.exec(directiveBody);
				if (!undefMatch) {
					throw new ContainerError({ description: `Invalid #undef directive in ${currentPath}:${lineNumber}.` });
				}
				macros.delete(undefMatch[1]);
				break;
			}
			case 'error': {
				const message = substituteMacros(directiveBody.trim(), macros);
				throw new ContainerError({ description: `#error in ${currentPath}:${lineNumber}: ${message}` });
			}
			case 'warning': {
				const message = substituteMacros(directiveBody.trim(), macros);
				expanded.push(`# warning: ${message}`);
				break;
			}
			default:
				expanded.push(substituteMacros(line, macros));
				break;
		}
	}

	if (conditionals.length > 0) {
		throw new ContainerError({ description: `Unterminated preprocessor conditionals in ${currentPath}. Missing #endif.` });
	}

	return expanded.join('\n');
}

function evaluateIfDirectiveCondition(currentPath: string, lineNumber: number, directiveName: string, body: string, macros: Map<string, string>): boolean {
	if (directiveName === 'ifdef' || directiveName === 'ifndef') {
		const ifdefMatch = ifdefLine.exec(body);
		if (!ifdefMatch) {
			throw new ContainerError({ description: `Invalid #${directiveName} directive in ${currentPath}:${lineNumber}.` });
		}
		const isDefined = macros.has(ifdefMatch[1]);
		return directiveName === 'ifdef' ? isDefined : !isDefined;
	}

	return evaluateBooleanExpression(body.trim(), macros);
}

function evaluateBooleanExpression(expression: string, macros: Map<string, string>): boolean {
	if (!expression) {
		return false;
	}

	const tokens = tokenizeExpression(expression);
	let index = 0;

	const parseExpression = (): boolean => {
		let value = parseTerm();
		while (tokens[index] === '||') {
			index++;
			value = value || parseTerm();
		}
		return value;
	};

	const parseTerm = (): boolean => {
		let value = parseFactor();
		while (tokens[index] === '&&') {
			index++;
			value = value && parseFactor();
		}
		return value;
	};

	const parseFactor = (): boolean => {
		const token = tokens[index];
		if (token === '!') {
			index++;
			return !parseFactor();
		}
		if (token === '(') {
			index++;
			const value = parseExpression();
			if (tokens[index] !== ')') {
				throw new ContainerError({ description: `Invalid #if expression: missing ')' in '${expression}'` });
			}
			index++;
			return value;
		}
		if (token === 'defined') {
			index++;
			if (tokens[index] === '(') {
				index++;
				const name = tokens[index++];
				if (!name || !isIdentifier(name)) {
					throw new ContainerError({ description: `Invalid #if expression: expected identifier after defined(` });
				}
				if (tokens[index] !== ')') {
					throw new ContainerError({ description: `Invalid #if expression: missing ')' after defined(${name}` });
				}
				index++;
				return macros.has(name);
			}
			const name = tokens[index++];
			if (!name || !isIdentifier(name)) {
				throw new ContainerError({ description: 'Invalid #if expression: expected identifier after defined' });
			}
			return macros.has(name);
		}

		if (!token) {
			throw new ContainerError({ description: `Invalid #if expression: unexpected end of expression '${expression}'` });
		}
		index++;
		if (/^[+-]?\d+$/.test(token)) {
			return Number(token) !== 0;
		}
		if (isIdentifier(token)) {
			return evaluateMacroTruthiness(token, macros, new Set<string>());
		}
		throw new ContainerError({ description: `Invalid #if expression token '${token}'` });
	};

	const result = parseExpression();
	if (index !== tokens.length) {
		throw new ContainerError({ description: `Invalid #if expression near '${tokens.slice(index).join(' ')}'` });
	}
	return result;
}

function tokenizeExpression(expression: string): string[] {
	const tokens = expression.match(/\s+|\|\||&&|!|\(|\)|defined|[a-zA-Z_][a-zA-Z0-9_]*|[+-]?\d+/g) || [];
	let reconstructed = '';
	const filtered = tokens.filter(token => token.trim().length > 0);
	for (const token of tokens) {
		reconstructed += token;
	}
	const normalizedExpression = expression.replace(/\s+/g, '');
	if (reconstructed.replace(/\s+/g, '') !== normalizedExpression) {
		throw new ContainerError({ description: `Unsupported token in #if expression '${expression}'` });
	}
	return filtered;
}

function isIdentifier(token: string): boolean {
	return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(token);
}

function evaluateMacroTruthiness(name: string, macros: Map<string, string>, seen: Set<string>): boolean {
	if (seen.has(name)) {
		return false;
	}
	const value = macros.get(name);
	if (typeof value !== 'string') {
		return false;
	}
	const trimmed = value.trim();
	if (!trimmed || trimmed === '0' || trimmed.toLowerCase() === 'false') {
		return false;
	}
	if (/^[+-]?\d+$/.test(trimmed)) {
		return Number(trimmed) !== 0;
	}
	if (isIdentifier(trimmed)) {
		seen.add(name);
		return evaluateMacroTruthiness(trimmed, macros, seen);
	}
	return true;
}

function substituteMacros(line: string, macros: Map<string, string>): string {
	if (!macros.size) {
		return line;
	}

	let result = line;
	for (let i = 0; i < 10; i++) {
		let changed = false;
		const names = [...macros.keys()].sort((a, b) => b.length - a.length);
		for (const name of names) {
			const value = macros.get(name)!;
			const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'g');
			const replaced = result.replace(pattern, value);
			if (replaced !== result) {
				changed = true;
				result = replaced;
			}
		}
		if (!changed) {
			break;
		}
	}

	return result;
}

function escapeRegExp(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validateResolvedFromInstruction(originalDockerfilePath: string, dockerfileContent: string) {
	if (!fromLine.test(dockerfileContent)) {
		throw new ContainerError({
			description: `Preprocessed Dockerfile '${originalDockerfilePath}' contains no resolved FROM instruction. Ensure preprocessing directives produce at least one final FROM line.`,
		});
	}
}

async function writePreprocessedDockerfile(cliHost: CLIHost, originalDockerfilePath: string, dockerfileContent: string): Promise<string> {
	const dockerfileFolder = cliHost.path.dirname(originalDockerfilePath);
	const outputFileName = `${Date.now()}-${randomUUID()}-${cliHost.path.basename(originalDockerfilePath).replace(/\.in$/i, '')}`;
	const effectiveDockerfilePath = cliHost.path.join(dockerfileFolder, outputFileName);
	await cliHost.writeFile(effectiveDockerfilePath, Buffer.from(dockerfileContent));
	return effectiveDockerfilePath;
}