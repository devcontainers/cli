/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as semver from 'semver';

export { getConfigFilePath, getDockerfilePath, isDockerFileConfig, resolveConfigFilePath } from '../spec-configuration/configuration';
export { uriToFsPath, parentURI } from '../spec-configuration/configurationCommonUtils';
export { CLIHostDocuments, Documents, createDocuments, Edit, fileDocuments, RemoteDocuments } from '../spec-configuration/editableFiles';


const findFromLines = new RegExp(/^(?<line>\s*FROM.*)/, 'gm');
const parseFromLine = /FROM\s+(?<platform>--platform=\S+\s+)?(?<image>\S+)(\s+[Aa][Ss]\s+(?<label>[^\s]+))?/;

const fromStatement = /^\s*FROM\s+(?<platform>--platform=\S+\s+)?(?<image>\S+)(\s+[Aa][Ss]\s+(?<label>[^\s]+))?/m;
const userStatements = /^\s*USER\s+(?<user>\S+)/gm;
const argStatementsWithValue = /^\s*ARG\s+(?<name>\S+)=("(?<value1>\S+)"|(?<value2>\S+))/gm;
const directives = /^\s*#\s*(?<name>\S+)\s*=\s*(?<value>.+)/;

export interface Dockerfile {
	preamble: {
		version: string | undefined;
		directives: Record<string, string>;
		args: Record<string, string>;
	};
	stages: Stage[];
	stagesByLabel: Record<string, Stage>;
}

export interface Stage {
	from: From;
	args: Record<string, string>;
	users: string[];
}

export interface From {
	platfrom?: string;
	image: string;
	label?: string;
}

export function extractDockerfile(dockerfile: string): Dockerfile {
	const fromStatementsAhead = /(?=^\s*FROM)/gm;
	const parts = dockerfile.split(fromStatementsAhead);
	const preambleStr = fromStatementsAhead.test(parts[0] || '') ? '' : parts.shift()!;
	const stageStrs = parts;
	const stages = stageStrs.map(stageStr => ({
		from: fromStatement.exec(stageStr)?.groups as unknown as From || { image: 'unknown' },
		args: extractArgs(stageStr),
		users: [...stageStr.matchAll(userStatements)].map(m => m.groups!.user),
	}));
	const directives = extractDirectives(preambleStr);
	const versionMatch = directives.syntax && /^(?:docker.io\/)?docker\/dockerfile(?::(?<version>\S+))?/.exec(directives.syntax) || undefined;
	const version = versionMatch && (versionMatch.groups?.version || 'latest');
	return {
		preamble: {
			version,
			directives,
			args: extractArgs(preambleStr),
		},
		stages,
		stagesByLabel: stages.reduce((obj, stage) => {
			if (stage.from.label) {
				obj[stage.from.label] = stage;
			}
			return obj;
		}, {} as Record<string, Stage>),
	} as Dockerfile;
}

export function findUserStatement(dockerfile: Dockerfile, buildArgs: Record<string, string>, target: string | undefined) {
	let stage: Stage | undefined = target ? dockerfile.stagesByLabel[target] : dockerfile.stages[dockerfile.stages.length - 1];
	const seen = new Set<Stage>();
	while (stage) {
		if (seen.has(stage)) {
			return undefined;
		}
		seen.add(stage);

		if (stage.users.length) {
			return replaceArgs(stage.users[stage.users.length - 1], { ...stage.args, ...buildArgs });
		}
		const image = replaceArgs(stage.from.image, { ...dockerfile.preamble.args, ...buildArgs });
		stage = dockerfile.stagesByLabel[image];
	}
	return undefined;
}

export function findBaseImage(dockerfile: Dockerfile, buildArgs: Record<string, string>, target: string | undefined) {
	let stage: Stage | undefined = target ? dockerfile.stagesByLabel[target] : dockerfile.stages[dockerfile.stages.length - 1];
	const seen = new Set<Stage>();
	while (stage) {
		if (seen.has(stage)) {
			return undefined;
		}
		seen.add(stage);

		const image = replaceArgs(stage.from.image, { ...dockerfile.preamble.args, ...buildArgs });
		const nextStage = dockerfile.stagesByLabel[image];
		if (!nextStage) {
			return image;
		}
		stage = nextStage;
	}
	return undefined;
}

function extractDirectives(preambleStr: string) {
	const map: Record<string, string> = {};
	for (const line of preambleStr.split(/\r?\n/)) {
		const groups = line.match(directives)?.groups;
		if (groups) {
			if (!map[groups.name]) {
				map[groups.name] = groups.value;
			}
		} else {
			break;
		}
	}
	return map;
}

function extractArgs(stageStr: string) {
	return [...stageStr.matchAll(argStatementsWithValue)]
		.reduce((obj, match) => {
			const groups = match.groups!;
			obj[groups.name] = groups.value1 || groups.value2;
			return obj;
		}, {} as Record<string, string>);
}

function replaceArgs(str: string, args: Record<string, string>) {
	return Object.keys(args)
		.sort((a, b) => b.length - a.length) // Sort by length to replace longest first.
		.reduce((current, arg) => current.replace(new RegExp(`\\$${arg}|\\$\\{${arg}\\}`, 'g'), args[arg]), str);
}

// not expected to be called externally (exposed for testing)
export function ensureDockerfileHasFinalStageName(dockerfile: string, defaultLastStageName: string): { lastStageName: string; modifiedDockerfile: string | undefined } {

	// Find the last line that starts with "FROM" (possibly preceeded by white-space)
	const fromLines = [...dockerfile.matchAll(findFromLines)];
	const lastFromLineMatch = fromLines[fromLines.length - 1];
	const lastFromLine = lastFromLineMatch.groups?.line as string;

	// Test for "FROM [--platform=someplat] base [as label]"
	// That is, match against optional platform and label
	const fromMatch = lastFromLine.match(parseFromLine);
	if (!fromMatch) {
		throw new Error('Error parsing Dockerfile: failed to parse final FROM line');
	}
	if (fromMatch.groups?.label) {
		return {
			lastStageName: fromMatch.groups.label,
			modifiedDockerfile: undefined,
		};
	}

	// Last stage doesn't have a name, so modify the Dockerfile to set the name to defaultLastStageName
	const lastLineStartIndex = (lastFromLineMatch.index as number) + (fromMatch.index as number);
	const lastLineEndIndex = lastLineStartIndex + lastFromLine.length;
	const matchedFromText = fromMatch[0];
	let modifiedDockerfile = dockerfile.slice(0, lastLineStartIndex + matchedFromText.length);

	modifiedDockerfile += ` AS ${defaultLastStageName}`;
	const remainingFromLineLength = lastFromLine.length - matchedFromText.length;
	modifiedDockerfile += dockerfile.slice(lastLineEndIndex - remainingFromLineLength);

	return { lastStageName: defaultLastStageName, modifiedDockerfile: modifiedDockerfile };
}

export function supportsBuildContexts(dockerfile: Dockerfile) {
	const version = dockerfile.preamble.version;
	if (!version) {
		return dockerfile.preamble.directives.syntax ? 'unknown' : false;
	}
	const numVersion = (/^\d+(\.\d+){0,2}/.exec(version) || [])[0];
	if (!numVersion) {
		return true; // latest, labs or no tag.
	}
	return semver.intersects(numVersion, '>=1.4');
}
