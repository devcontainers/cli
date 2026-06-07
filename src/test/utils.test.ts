/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

import { isBuildxCacheToInline, platformInfoFromBuildxPlatform } from '../spec-node/utils';
import { findPlatformArg, removePlatformArg } from '../spec-node/singleContainer';

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

	describe('platformInfoFromBuildxPlatform', function () {
		it('parses os/arch without a variant', () => {
			assert.deepStrictEqual(platformInfoFromBuildxPlatform('linux/amd64'), { os: 'linux', arch: 'amd64' });
			assert.deepStrictEqual(platformInfoFromBuildxPlatform('windows/amd64'), { os: 'windows', arch: 'amd64' });
		});

		it('parses os/arch/variant', () => {
			assert.deepStrictEqual(platformInfoFromBuildxPlatform('linux/arm64/v8'), { os: 'linux', arch: 'arm64', variant: 'v8' });
			assert.deepStrictEqual(platformInfoFromBuildxPlatform('linux/amd64/v3'), { os: 'linux', arch: 'amd64', variant: 'v3' });
		});
	});

	describe('findPlatformArg', function () {
		it('returns undefined when runArgs is missing or has no --platform', () => {
			assert.strictEqual(findPlatformArg(), undefined);
			assert.strictEqual(findPlatformArg([]), undefined);
			assert.strictEqual(findPlatformArg(['--user=foo', '--rm']), undefined);
		});

		it('parses the --platform=value form', () => {
			assert.strictEqual(findPlatformArg(['--platform=linux/amd64']), 'linux/amd64');
		});

		it('parses the separate --platform value form', () => {
			assert.strictEqual(findPlatformArg(['--rm', '--platform', 'linux/arm64/v8', '-it']), 'linux/arm64/v8');
		});

		it('returns the last occurrence when --platform is repeated', () => {
			assert.strictEqual(findPlatformArg(['--platform=linux/amd64', '--platform', 'linux/arm64']), 'linux/arm64');
		});

		it('ignores a trailing --platform with no value', () => {
			assert.strictEqual(findPlatformArg(['--foo', '--platform']), undefined);
		});
	});

	describe('removePlatformArg', function () {
		it('returns an empty array for missing or empty runArgs', () => {
			assert.deepStrictEqual(removePlatformArg(), []);
			assert.deepStrictEqual(removePlatformArg([]), []);
		});

		it('leaves runArgs without --platform untouched', () => {
			assert.deepStrictEqual(removePlatformArg(['--rm', '--user=foo']), ['--rm', '--user=foo']);
		});

		it('removes the --platform=value form', () => {
			assert.deepStrictEqual(removePlatformArg(['--rm', '--platform=linux/amd64', '-it']), ['--rm', '-it']);
		});

		it('removes the separate --platform value form including its value', () => {
			assert.deepStrictEqual(removePlatformArg(['--rm', '--platform', 'linux/arm64/v8', '-it']), ['--rm', '-it']);
		});

		it('removes all occurrences', () => {
			assert.deepStrictEqual(removePlatformArg(['--platform=linux/amd64', '--rm', '--platform', 'linux/arm64']), ['--rm']);
		});
	});
});
