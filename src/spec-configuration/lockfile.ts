/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { DevContainerConfig } from './configuration';
import { readLocalFile, writeLocalFile } from '../spec-utils/pfs';
import { ContainerFeatureInternalParams, FeatureSet, FeaturesConfig, OCISourceInformation } from './containerFeaturesConfiguration';


export interface Lockfile {
	features: Record<string, { version: string; resolved: string; integrity: string }>;
}

export async function writeLockfile(params: ContainerFeatureInternalParams, config: DevContainerConfig, featuresConfig: FeaturesConfig) {
	const lockfilePath = getLockfilePath(config);
	const oldLockfileContent = await readLocalFile(lockfilePath)
		.catch(err => {
			if (err?.code !== 'ENOENT') {
				throw err;
			}
		});

	if (!oldLockfileContent && !params.experimentalLockfile && !params.experimentalFrozenLockfile) {
		return;
	}

	const lockfile: Lockfile = featuresConfig.featureSets
		.map(f => [f, f.sourceInformation] as const)
		.filter((tup): tup is [FeatureSet, OCISourceInformation] => tup[1].type === 'oci')
		.map(([set, source]) => ({
			id: source.userFeatureId,
			version: set.features[0].version!,
			resolved: `${source.featureRef.registry}/${source.featureRef.path}@${set.computedDigest}`,
			integrity: set.computedDigest!,
		}))
		.sort((a, b) => a.id.localeCompare(b.id))
		.reduce((acc, cur) => {
			const feature = { ...cur };
			delete (feature as any).id;
			acc.features[cur.id] = feature;
			return acc;
		}, {
			features: {} as Record<string, { version: string; resolved: string; integrity: string }>,
		});

	const newLockfileContent = Buffer.from(JSON.stringify(lockfile, null, 2));
	if (params.experimentalFrozenLockfile && !oldLockfileContent) {
		throw new Error('Lockfile does not exist.');
	}
	if (!oldLockfileContent || !newLockfileContent.equals(oldLockfileContent)) {
		if (params.experimentalFrozenLockfile) {
			throw new Error('Lockfile does not match.');
		}
		await writeLocalFile(lockfilePath, newLockfileContent);
	}
}

export async function readLockfile(config: DevContainerConfig): Promise<Lockfile | undefined> {
	try {
		const content = await readLocalFile(getLockfilePath(config));
		return JSON.parse(content.toString()) as Lockfile;
	} catch (err) {
		if (err?.code === 'ENOENT') {
			return undefined;
		}
		throw err;
	}
}

export function getLockfilePath(configOrPath: DevContainerConfig | string) {
	const configPath = typeof configOrPath === 'string' ? configOrPath : configOrPath.configFilePath!.fsPath;
	return path.join(path.dirname(configPath), path.basename(configPath).startsWith('.') ? '.devcontainer-lock.json' : 'devcontainer-lock.json');  
}
