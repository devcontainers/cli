/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { readLocalFile } from './pfs';

export interface PackageConfiguration {
	name: string;
	publisher?: string;
	version: string;
	aiKey?: string;
}

export async function getPackageConfig(packageFolder: string): Promise<PackageConfiguration> {
	const raw = await readLocalFile(path.join(packageFolder, 'package.json'), 'utf8');
	return JSON.parse(raw);
}
export const includeAllConfiguredFeatures = true;
