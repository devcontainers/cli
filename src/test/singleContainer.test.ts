import { assert } from 'chai';
import { convertMountToVolume } from '../spec-node/singleContainer';

describe('convertMountToVolume (wslc -v syntax)', () => {

	it('converts a bind mount with source and target', () => {
		assert.deepEqual(
			convertMountToVolume('type=bind,source=/a,target=/b'),
			['-v', '/a:/b']);
	});

	it('preserves the readonly flag as :ro', () => {
		assert.deepEqual(
			convertMountToVolume('type=bind,source=/a,target=/b,readonly'),
			['-v', '/a:/b:ro']);
	});

	it('preserves readonly=true as :ro', () => {
		assert.deepEqual(
			convertMountToVolume('type=bind,source=/a,target=/b,readonly=true'),
			['-v', '/a:/b:ro']);
	});

	it('preserves the ro shorthand as :ro', () => {
		assert.deepEqual(
			convertMountToVolume('type=bind,source=/a,target=/b,ro'),
			['-v', '/a:/b:ro']);
	});

	it('ignores readonly=false', () => {
		assert.deepEqual(
			convertMountToVolume('type=bind,source=/a,target=/b,readonly=false'),
			['-v', '/a:/b']);
	});

	it('drops the consistency option', () => {
		assert.deepEqual(
			convertMountToVolume('type=bind,source=/a,target=/b,consistency=cached'),
			['-v', '/a:/b']);
	});

	it('converts a named volume mount', () => {
		assert.deepEqual(
			convertMountToVolume('type=volume,source=vol,target=/b,readonly'),
			['-v', 'vol:/b:ro']);
	});

	it('converts a Windows source path with a readonly flag', () => {
		assert.deepEqual(
			convertMountToVolume('type=bind,source=C:\\some\\folder,target=/b,readonly'),
			['-v', 'C:\\some\\folder:/b:ro']);
	});

	it('converts a target-only mount to an anonymous volume', () => {
		assert.deepEqual(
			convertMountToVolume('type=volume,target=/b'),
			['-v', '/b']);
	});

	it('falls back to --mount when no target is present', () => {
		assert.deepEqual(
			convertMountToVolume('type=tmpfs'),
			['--mount', 'type=tmpfs']);
	});
});
