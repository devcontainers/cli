/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

import { isBuildxCacheToInline } from '../spec-node/utils';

describe('Utils', function () {
	describe('isBuildxCacheToInline', function () {
		it('returns false for undefined or empty', () => {
			assert.strictEqual(isBuildxCacheToInline(undefined), false);
			assert.strictEqual(isBuildxCacheToInline(''), false);
		});

		it('returns true for inline cache type', () => {
			assert.strictEqual(isBuildxCacheToInline('type=inline'), true);
			assert.strictEqual(isBuildxCacheToInline('type = inline'), true);
			assert.strictEqual(isBuildxCacheToInline('type=INLINE'), true);
			assert.strictEqual(isBuildxCacheToInline('mode=max,type=inline,compression=zstd'), true);
		});

		it('returns false for non-inline cache type', () => {
			assert.strictEqual(isBuildxCacheToInline('type=registry'), false);
			assert.strictEqual(isBuildxCacheToInline('type=local'), false);
			assert.strictEqual(isBuildxCacheToInline('inline'), false);
		});
	});
});
