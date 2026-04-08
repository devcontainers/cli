/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import { normalizeDevContainerLabelPath } from '../spec-node/utils';

describe('normalizeDevContainerLabelPath', function () {
	it('lowercases Windows drive letters', function () {
		assert.equal(
			normalizeDevContainerLabelPath('win32', 'C:\\CodeBlocks\\remill'),
			'c:\\CodeBlocks\\remill'
		);
	});

	it('normalizes Windows path separators', function () {
		assert.equal(
			normalizeDevContainerLabelPath('win32', 'C:/CodeBlocks/remill/.devcontainer/devcontainer.json'),
			'c:\\CodeBlocks\\remill\\.devcontainer\\devcontainer.json'
		);
	});

	it('leaves non-Windows paths unchanged', function () {
		assert.equal(
			normalizeDevContainerLabelPath('linux', '/workspaces/remill'),
			'/workspaces/remill'
		);
	});
});
