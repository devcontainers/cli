/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { getKeepIdArgs, parseNumericUidGid } from '../spec-node/singleContainer';

describe('parseNumericUidGid', function () {
	it('should parse a plain numeric uid, defaulting gid to the uid', () => {
		assert.deepStrictEqual(parseNumericUidGid('1000'), { uid: '1000', gid: '1000' });
	});

	it('should parse a numeric uid:gid pair', () => {
		assert.deepStrictEqual(parseNumericUidGid('1000:1001'), { uid: '1000', gid: '1001' });
	});

	it('should return undefined for a named user', () => {
		assert.strictEqual(parseNumericUidGid('vscode'), undefined);
	});

	it('should return undefined for a named user with numeric group', () => {
		assert.strictEqual(parseNumericUidGid('vscode:1000'), undefined);
	});

	it('should return undefined for a numeric user with named group', () => {
		assert.strictEqual(parseNumericUidGid('1000:vscode'), undefined);
	});

	it('should return undefined for an empty or malformed spec', () => {
		assert.strictEqual(parseNumericUidGid(''), undefined);
		assert.strictEqual(parseNumericUidGid(':1000'), undefined);
	});
});

describe('getKeepIdArgs', function () {
	it('should return plain --userns=keep-id when uid/gid are not resolved', () => {
		assert.deepStrictEqual(getKeepIdArgs(undefined), ['--userns=keep-id']);
	});

	it('should return explicit uid/gid mapping when resolved', () => {
		assert.deepStrictEqual(
			getKeepIdArgs({ uid: '1000', gid: '1000' }),
			['--userns=keep-id:uid=1000,gid=1000']
		);
	});

	it('should return explicit mapping for a high (non-bakeable) uid', () => {
		assert.deepStrictEqual(
			getKeepIdArgs({ uid: '1400601103', gid: '1400600513' }),
			['--userns=keep-id:uid=1400601103,gid=1400600513']
		);
	});
});
