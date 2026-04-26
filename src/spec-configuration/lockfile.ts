/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { DevContainerConfig } from './configuration';
import { readLocalFile, writeLocalFile } from '../spec-utils/pfs';
import { ContainerFeatureInternalParams, DirectTarballSourceInformation, FeatureSet, FeaturesConfig, OCISourceInformation } from './containerFeaturesConfiguration';


export interface Lockfile {
	features: Record<string, { version: string; resolved: string; integrity: string }>;
}

export async function generateLockfile(featuresConfig: FeaturesConfig): Promise<Lockfile> {
	return featuresConfig.featureSets
		.map(f => [f, f.sourceInformation] as const)
		.filter((tup): tup is [FeatureSet, OCISourceInformation | DirectTarballSourceInformation] => ['oci', 'direct-tarball'].indexOf(tup[1].type) !== -1)
		.map(([set, source]) => {
			const dependsOn = Object.keys(set.features[0].dependsOn || {});
			return {
				id: source.userFeatureId,
				version: set.features[0].version!,
				resolved: source.type === 'oci' ?
					`${source.featureRef.registry}/${source.featureRef.path}@${set.computedDigest}` :
					source.tarballUri,
				integrity: set.computedDigest!,
				dependsOn: dependsOn.length ? dependsOn : undefined,
			};
		})
		.sort((a, b) => a.id.localeCompare(b.id))
		.reduce((acc, cur) => {
			const feature = { ...cur };
			delete (feature as any).id;
			acc.features[cur.id] = feature;
			return acc;
		}, {
			features: {} as Record<string, { version: string; resolved: string; integrity: string }>,
		});
}

export async function writeLockfile(params: ContainerFeatureInternalParams, config: DevContainerConfig, lockfile: Lockfile): Promise<string | undefined> {
	if (params.noLockfile) {
		return;
	}

	const lockfilePath = getLockfilePath(config);
	const oldLockfileContent = await readLocalFile(lockfilePath)
		.catch(err => {
			if (err?.code !== 'ENOENT') {
				throw err;
			}
		});

	// Trailing newline per POSIX convention
	const newLockfileContentString = JSON.stringify(lockfile, null, 2) + '\n';
	const newLockfileContent = Buffer.from(newLockfileContentString);
	if ((params.frozenLockfile || params.experimentalFrozenLockfile) && !oldLockfileContent) {
		throw new Error('Lockfile does not exist.');
	}
	// Normalize the existing lockfile through JSON.parse -> JSON.stringify to produce
	// the same canonical format as newLockfileContentString, so that the string comparison
	// below ignores cosmetic differences (indentation, trailing whitespace, etc.).
	let oldLockfileNormalized: string | undefined;
	if (oldLockfileContent) {
		try {
			oldLockfileNormalized = JSON.stringify(JSON.parse(oldLockfileContent.toString()), null, 2) + '\n';
		} catch {
			// Empty or invalid JSON; treat as needing rewrite.
		}
	}
	if (!oldLockfileNormalized || oldLockfileNormalized !== newLockfileContentString) {
		if (params.frozenLockfile || params.experimentalFrozenLockfile) {
			throw new Error('Lockfile does not match.');
		}
		await writeLocalFile(lockfilePath, newLockfileContent);
	}
	return;
}

export async function readLockfile(config: DevContainerConfig): Promise<{ lockfile?: Lockfile; initLockfile?: boolean }> {
	try {
		const content = await readLocalFile(getLockfilePath(config));
		// If empty file, use as marker to initialize lockfile when build completes.
		if (content.toString().trim() === '') {
			return { initLockfile: true };
		}
		return { lockfile: JSON.parse(content.toString()) as Lockfile };
	} catch (err) {
		if (err?.code === 'ENOENT') {
			return {};
		}
		throw err;
	}
}

export function getLockfilePath(configOrPath: DevContainerConfig | string) {
	const configPath = typeof configOrPath === 'string' ? configOrPath : configOrPath.configFilePath!.fsPath;
	return path.join(path.dirname(configPath), path.basename(configPath).startsWith('.') ? '.devcontainer-lock.json' : 'devcontainer-lock.json');  
}
