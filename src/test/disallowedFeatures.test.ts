/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import * as jsonc from 'jsonc-parser';

import { ensureNoDisallowedFeatures, findDisallowedFeatureEntry } from '../spec-node/disallowedFeatures';
import { readLocalFile } from '../spec-utils/pfs';
import { ContainerError } from '../spec-common/errors';
import { createCLIParams } from './testUtils';


describe(`Disallowed features check`, function () {

	it(`passes with allowed features`, async () => {
		const hostPath = path.join(__dirname, 'configs', 'disallowed-features');
		const configFile = path.join(hostPath, '.devcontainer', 'allowed', 'devcontainer.json');
		const config = jsonc.parse((await readLocalFile(configFile)).toString());
		const cliParams = await createCLIParams(hostPath);

		await ensureNoDisallowedFeatures(cliParams, config, {}, []);
	});

	it(`fails with disallowed features`, async () => {
		const hostPath = path.join(__dirname, 'configs', 'disallowed-features');
		const configFile = path.join(hostPath, '.devcontainer', 'disallowed', 'devcontainer.json');
		const config = jsonc.parse((await readLocalFile(configFile)).toString());
		const cliParams = await createCLIParams(hostPath);

		let error: Error | undefined;
		try {
			await ensureNoDisallowedFeatures(cliParams, config, {}, []);
		} catch (err) {
			error = err;
		}
		assert.ok(error, 'Expected error');
		assert.ok(error instanceof ContainerError, `Expected ContainerError got: ${error.message}`);
	});

	it(`matches equal feature id and prefix`, () => {
		const controlManifest = {
			disallowedFeatures: [
				{
					featureIdPrefix: 'example.io/test/node',
				},
			],
			featureAdvisories: [],
		};
		assert.ok(findDisallowedFeatureEntry(controlManifest, 'example.io/test/node'));
		assert.strictEqual(findDisallowedFeatureEntry(controlManifest, 'example.io/test/nodej'), undefined);
		assert.strictEqual(findDisallowedFeatureEntry(controlManifest, 'example.io/test/nod'), undefined);
		
		assert.ok(findDisallowedFeatureEntry(controlManifest, 'example.io/test/node:1'));
		assert.ok(findDisallowedFeatureEntry(controlManifest, 'example.io/test/node/js'));
		assert.ok(findDisallowedFeatureEntry(controlManifest, 'example.io/test/node@abc'));
		assert.strictEqual(findDisallowedFeatureEntry(controlManifest, 'example.io/test/node.js'), undefined);
	});
});
