/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import * as semver from 'semver';
import { shellExec } from '../testUtils';
import { cpLocal, readLocalFile, rmLocal, writeLocalFile } from '../../spec-utils/pfs';

const pkg = require('../../../package.json');

describe('Lockfile', function () {
	this.timeout('240s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
	const cli = `npx --prefix ${tmp} devcontainer`;

	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
	});

	it('write lockfile', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile');

		const lockfilePath = path.join(workspaceFolder, '.devcontainer-lock.json');
		await rmLocal(lockfilePath, { force: true });

		const res = await shellExec(`${cli} build --workspace-folder ${workspaceFolder} --experimental-lockfile`);
		const response = JSON.parse(res.stdout);
		assert.equal(response.outcome, 'success');
		const actual = await readLocalFile(lockfilePath);
		const expected = await readLocalFile(path.join(workspaceFolder, 'expected.devcontainer-lock.json'));
		assert.equal(actual.toString(), expected.toString());
	});

	it('lockfile with dependencies', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-dependson');

		const lockfilePath = path.join(workspaceFolder, '.devcontainer-lock.json');
		await rmLocal(lockfilePath, { force: true });

		const res = await shellExec(`${cli} build --workspace-folder ${workspaceFolder} --experimental-lockfile`);
		const response = JSON.parse(res.stdout);
		assert.equal(response.outcome, 'success');
		const actual = await readLocalFile(lockfilePath);
		const expected = await readLocalFile(path.join(workspaceFolder, 'expected.devcontainer-lock.json'));
		assert.equal(actual.toString(), expected.toString());
	});

	it('frozen lockfile', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-frozen');
		const lockfilePath = path.join(workspaceFolder, '.devcontainer-lock.json');
		const expected = await readLocalFile(lockfilePath);
		const res = await shellExec(`${cli} build --workspace-folder ${workspaceFolder} --experimental-lockfile --experimental-frozen-lockfile`);
		const response = JSON.parse(res.stdout);
		assert.equal(response.outcome, 'success');
		const actual = await readLocalFile(lockfilePath);
		assert.equal(actual.toString(), expected.toString());
	});

	it('outdated lockfile', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-outdated');

		const lockfilePath = path.join(workspaceFolder, '.devcontainer-lock.json');
		await cpLocal(path.join(workspaceFolder, 'original.devcontainer-lock.json'), lockfilePath);

		{
			try {
				throw await shellExec(`${cli} build --workspace-folder ${workspaceFolder} --experimental-lockfile --experimental-frozen-lockfile`);
			} catch (res) {
				const response = JSON.parse(res.stdout);
				assert.equal(response.outcome, 'error');
			}
		}

		{
			const res = await shellExec(`${cli} build --workspace-folder ${workspaceFolder} --experimental-lockfile`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			const actual = await readLocalFile(lockfilePath);
			const expected = await readLocalFile(path.join(workspaceFolder, 'expected.devcontainer-lock.json'));
			assert.equal(actual.toString(), expected.toString());
		}
	});

	it('outdated command with json output', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-outdated-command');

		const res = await shellExec(`${cli} outdated --workspace-folder ${workspaceFolder} --output-format json`);
		const response = JSON.parse(res.stdout);
		
		const git = response.features['ghcr.io/devcontainers/features/git:1.0'];
		assert.ok(git);
		assert.strictEqual(git.current, '1.0.4');
		assert.ok(semver.gt(git.wanted, git.current), `semver.gt(${git.wanted}, ${git.current}) is false`);
		assert.ok(semver.gt(git.latest, git.wanted), `semver.gt(${git.latest}, ${git.wanted}) is false`);

		const lfs = response.features['ghcr.io/devcontainers/features/git-lfs@sha256:24d5802c837b2519b666a8403a9514c7296d769c9607048e9f1e040e7d7e331c'];
		assert.ok(lfs);
		assert.strictEqual(lfs.current, '1.0.6');
		assert.strictEqual(lfs.current, lfs.wanted);
		assert.ok(semver.gt(lfs.latest, lfs.wanted), `semver.gt(${lfs.latest}, ${lfs.wanted}) is false`);

		const github = response.features['ghcr.io/devcontainers/features/github-cli'];
		assert.ok(github);
		assert.strictEqual(github.current, github.latest);
		assert.strictEqual(github.wanted, github.latest);

		const azure = response.features['ghcr.io/devcontainers/features/azure-cli:0'];
		assert.ok(azure);
		assert.strictEqual(azure.current, undefined);
		assert.strictEqual(azure.wanted, undefined);
		assert.ok(azure.latest);

		const foo = response.features['ghcr.io/codspace/versioning/foo:0.3.1'];
		assert.ok(foo);
		assert.strictEqual(foo.current, '0.3.1');
		assert.strictEqual(foo.wanted, '0.3.1');
		assert.strictEqual(foo.wantedMajor, '0');
		assert.strictEqual(foo.latest, '2.11.1');
		assert.strictEqual(foo.latestMajor, '2');

		const doesnotexist = response.features['ghcr.io/codspace/doesnotexist:0.1.2'];
		assert.ok(doesnotexist);
		assert.strictEqual(doesnotexist.current, undefined);
		assert.strictEqual(doesnotexist.wanted, undefined);
		assert.strictEqual(doesnotexist.wantedMajor, undefined);
		assert.strictEqual(doesnotexist.latest, undefined);
		assert.strictEqual(doesnotexist.latestMajor, undefined);
	});

	it('outdated command with text output', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-outdated-command');

		const res = await shellExec(`${cli} outdated --workspace-folder ${workspaceFolder} --output-format text`);
		const response = res.stdout;
		// Count number of lines of output
		assert.strictEqual(response.split('\n').length, 8); // 5 valid Features + header + empty line

		// Check that the header is present
		assert.ok(response.includes('Current'), 'Current column is missing');
		assert.ok(response.includes('Wanted'), 'Wanted column is missing');
		assert.ok(response.includes('Latest'), 'Latest column is missing');

		// Check that the features are present
		// The version values are checked for correctness in the json variant of this test
		assert.ok(response.includes('ghcr.io/devcontainers/features/git'), 'git Feature is missing');
		assert.ok(response.includes('ghcr.io/devcontainers/features/git-lfs'), 'git-lfs Feature is missing');
		assert.ok(response.includes('ghcr.io/devcontainers/features/github-cli'), 'github-cli Feature is missing');
		assert.ok(response.includes('ghcr.io/devcontainers/features/azure-cli'), 'azure-cli Feature is missing');
		assert.ok(response.includes('ghcr.io/codspace/versioning/foo'), 'foo Feature is missing');
		assert.ok(response.includes('ghcr.io/codspace/doesnotexist'), 'doesnotexist Feature is missing');

		// Check that filtered Features are not present
		assert.ok(!response.includes('mylocalfeature'));
		assert.ok(!response.includes('terraform'));
		assert.ok(!response.includes('myfeatures'));
	});

	it('upgrade command', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-upgrade-command');

		const lockfilePath = path.join(workspaceFolder, '.devcontainer-lock.json');
		await cpLocal(path.join(workspaceFolder, 'outdated.devcontainer-lock.json'), lockfilePath);

		await shellExec(`${cli} upgrade --workspace-folder ${workspaceFolder}`);
		const actual = await readLocalFile(lockfilePath);
		const expected = await readLocalFile(path.join(workspaceFolder, 'upgraded.devcontainer-lock.json'));
		assert.equal(actual.toString(), expected.toString());
	});

	it('upgrade command in --dry-run mode', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-dependson');
		const res = await shellExec(`${cli} upgrade --dry-run --workspace-folder ${workspaceFolder}`);
		const lockfile = JSON.parse(res.stdout);
		assert.ok(lockfile);
		assert.ok(lockfile.features);
		assert.ok(lockfile.features['ghcr.io/codspace/dependson/A:2']);
	});

	it('upgrade command with --feature', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-upgrade-feature');
		await cpLocal(path.join(workspaceFolder, 'input.devcontainer.json'), path.join(workspaceFolder, '.devcontainer.json'));

		const res = await shellExec(`${cli} upgrade --dry-run --workspace-folder ${workspaceFolder} --feature ghcr.io/codspace/versioning/foo --target-version 2`);

		// Check devcontainer.json was updated
		const actual = await readLocalFile(path.join(workspaceFolder, '.devcontainer.json'));
		const expected = await readLocalFile(path.join(workspaceFolder, 'expected.devcontainer.json'));
		assert.equal(actual.toString(), expected.toString());

		// Check lockfile was updated
		const lockfile = JSON.parse(res.stdout);
		assert.ok(lockfile);
		assert.ok(lockfile.features);
		assert.ok(lockfile.features['ghcr.io/codspace/versioning/foo:2'].version === '2.11.1');
	});

	it('OCI feature integrity', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-oci-integrity');

		try {
			throw await shellExec(`${cli} build --workspace-folder ${workspaceFolder} --experimental-lockfile`);
		} catch (res) {
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'error');
		}
	});

	it('tarball URI feature integrity', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-tarball-integrity');

		try {
			throw await shellExec(`${cli} build --workspace-folder ${workspaceFolder} --experimental-lockfile`);
		} catch (res) {
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'error');
		}
	});

	it('empty lockfile should init', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-generate-from-empty-file');
		const lockfilePath = path.join(workspaceFolder, '.devcontainer', 'devcontainer-lock.json');
		const cleanup = async () => {
			await rmLocal(lockfilePath, { force: true });
			await shellExec(`touch ${lockfilePath}`);
		};

		await cleanup();
		const res = await shellExec(`${cli} build --workspace-folder ${workspaceFolder}`);
		const response = JSON.parse(res.stdout);
		assert.equal(response.outcome, 'success');
		const actual = JSON.parse((await readLocalFile(lockfilePath)).toString());
		assert.ok(actual.features['ghcr.io/devcontainers/features/dotnet:2']);
		await cleanup();
	});

	it('empty lockfile should not init when frozen', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-generate-from-empty-file-frozen');
		const lockfilePath = path.join(workspaceFolder, '.devcontainer', 'devcontainer-lock.json');
		const cleanup = async () => {
			await rmLocal(lockfilePath, { force: true });
			await shellExec(`touch ${lockfilePath}`);
		};

		await cleanup();
		try {
			await shellExec(`${cli} build --workspace-folder ${workspaceFolder} --experimental-frozen-lockfile`);
			await cleanup();
		} catch (res) {
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'error');
			assert.equal(response.message, 'Lockfile does not match.');
			await cleanup();
		}
	});

	it('outdated command should work with default workspace folder', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-outdated-command');
		const absoluteTmpPath = path.resolve(__dirname, 'tmp');
		const absoluteCli = `npx --prefix ${absoluteTmpPath} devcontainer`;

		const originalCwd = process.cwd();
		try {
			process.chdir(workspaceFolder);
			const res = await shellExec(`${absoluteCli} outdated --output-format json`);
			const response = JSON.parse(res.stdout);

			// Should have same structure as the test with explicit workspace-folder
			assert.ok(response.features);
			assert.ok(response.features['ghcr.io/devcontainers/features/git:1.0']);
			assert.strictEqual(response.features['ghcr.io/devcontainers/features/git:1.0'].current, '1.0.4');
		} finally {
			process.chdir(originalCwd);
		}
	});

	it('lockfile ends with trailing newline', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile');

		const lockfilePath = path.join(workspaceFolder, '.devcontainer-lock.json');
		await rmLocal(lockfilePath, { force: true });

		const res = await shellExec(`${cli} build --workspace-folder ${workspaceFolder} --experimental-lockfile`);
		const response = JSON.parse(res.stdout);
		assert.equal(response.outcome, 'success');
		const actual = (await readLocalFile(lockfilePath)).toString();
		assert.ok(actual.endsWith('\n'), 'Lockfile should end with a trailing newline');
	});

	it('frozen lockfile matches despite formatting differences', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-frozen');
		const lockfilePath = path.join(workspaceFolder, '.devcontainer-lock.json');

		// Read the existing lockfile, strip trailing newline to create a byte-different but semantically identical file
		const original = (await readLocalFile(lockfilePath)).toString();
		const stripped = original.replace(/\n$/, '');
		assert.notEqual(original, stripped, 'Test setup: should have removed trailing newline');
		assert.deepEqual(JSON.parse(original), JSON.parse(stripped), 'Test setup: JSON content should be identical');

		try {
			await writeLocalFile(lockfilePath, Buffer.from(stripped));

			// Frozen lockfile should succeed because JSON content is the same
			const res = await shellExec(`${cli} build --workspace-folder ${workspaceFolder} --experimental-lockfile --experimental-frozen-lockfile`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success', 'Frozen lockfile should not fail when only formatting differs');
			const actual = (await readLocalFile(lockfilePath)).toString();
			assert.strictEqual(actual, stripped, 'Frozen lockfile should remain unchanged when only formatting differs');
		} finally {
			// Restore original lockfile
			await writeLocalFile(lockfilePath, Buffer.from(original));
		}
	});

	it('upgrade command should work with default workspace folder', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-upgrade-command');
		const absoluteTmpPath = path.resolve(__dirname, 'tmp');
		const absoluteCli = `npx --prefix ${absoluteTmpPath} devcontainer`;

		const lockfilePath = path.join(workspaceFolder, '.devcontainer-lock.json');
		await cpLocal(path.join(workspaceFolder, 'outdated.devcontainer-lock.json'), lockfilePath);

		const originalCwd = process.cwd();
		try {
			process.chdir(workspaceFolder);
			await shellExec(`${absoluteCli} upgrade`);
			const actual = await readLocalFile(lockfilePath);
			const expected = await readLocalFile(path.join(workspaceFolder, 'upgraded.devcontainer-lock.json'));
			assert.equal(actual.toString(), expected.toString());
		} finally {
			process.chdir(originalCwd);
		}
	});

	it('frozen lockfile fails when lockfile does not exist', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile-frozen-no-lockfile');
		const lockfilePath = path.join(workspaceFolder, '.devcontainer-lock.json');
		await rmLocal(lockfilePath, { force: true });

		try {
			throw await shellExec(`${cli} build --workspace-folder ${workspaceFolder} --experimental-lockfile --experimental-frozen-lockfile`);
		} catch (res) {
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'error');
			assert.equal(response.message, 'Lockfile does not exist.');
		}
	});

	it('corrupt lockfile causes build error', async () => {
		const workspaceFolder = path.join(__dirname, 'configs/lockfile');
		const lockfilePath = path.join(workspaceFolder, '.devcontainer-lock.json');
		const expectedPath = path.join(workspaceFolder, 'expected.devcontainer-lock.json');

		try {
			// Write invalid JSON to the lockfile
			await writeLocalFile(lockfilePath, Buffer.from('this is not valid json{{{'));

			try {
				throw await shellExec(`${cli} build --workspace-folder ${workspaceFolder} --experimental-lockfile`);
			} catch (res) {
				const response = JSON.parse(res.stdout);
				assert.equal(response.outcome, 'error');
			}
		} finally {
			// Restore from the known-good expected lockfile
			await cpLocal(expectedPath, lockfilePath);
		}
	});

	// -- Graduated lockfile tests --

	async function isolateFixture(name: string): Promise<string> {
		const src = path.join(__dirname, 'configs', name);
		const dst = path.join(__dirname, 'tmp-fixtures', `${name}-${process.hrtime.bigint()}`);
		await shellExec(`mkdir -p ${path.dirname(dst)} && cp -r ${src} ${dst}`);
		return dst;
	}

	async function lockfileExists(p: string): Promise<boolean> {
		return readLocalFile(p).then(() => true, err => {
			if (err?.code === 'ENOENT') {
				return false;
			}
			throw err;
		});
	}

	after(async () => {
		await shellExec(`rm -rf ${path.join(__dirname, 'tmp-fixtures')}`);
	});

	it('auto-generates lockfile by default without any flags', async () => {
		const tmpDir = await isolateFixture('lockfile');
		const lockfilePath = path.join(tmpDir, '.devcontainer-lock.json');
		// Remove the committed lockfile so we can verify auto-creation from scratch.
		await rmLocal(lockfilePath, { force: true });

		const res = await shellExec(`${cli} build --workspace-folder ${tmpDir}`);
		const response = JSON.parse(res.stdout);
		assert.equal(response.outcome, 'success');

		const actual = await readLocalFile(lockfilePath);
		const expected = await readLocalFile(path.join(tmpDir, 'expected.devcontainer-lock.json'));
		assert.equal(actual.toString(), expected.toString());
	});

	it('--no-lockfile prevents lockfile creation', async () => {
		const tmpDir = await isolateFixture('lockfile-no-lockfile');
		const lockfilePath = path.join(tmpDir, '.devcontainer-lock.json');

		const res = await shellExec(`${cli} build --workspace-folder ${tmpDir} --no-lockfile`);
		const response = JSON.parse(res.stdout);
		assert.equal(response.outcome, 'success');

		assert.equal(await lockfileExists(lockfilePath), false, 'Lockfile should not be created when --no-lockfile is set');
	});

	it('--no-lockfile ignores existing lockfile', async () => {
		const tmpDir = await isolateFixture('lockfile-frozen');
		const lockfilePath = path.join(tmpDir, '.devcontainer-lock.json');

		const lockfileBefore = (await readLocalFile(lockfilePath)).toString();

		const res = await shellExec(`${cli} build --workspace-folder ${tmpDir} --no-lockfile`);
		const response = JSON.parse(res.stdout);
		assert.equal(response.outcome, 'success');

		const lockfileAfter = (await readLocalFile(lockfilePath)).toString();
		assert.equal(lockfileAfter, lockfileBefore, 'Lockfile should be unchanged when --no-lockfile is set');
	});

	it('--frozen-lockfile succeeds with matching lockfile', async () => {
		const tmpDir = await isolateFixture('lockfile-frozen');
		const lockfilePath = path.join(tmpDir, '.devcontainer-lock.json');
		const lockfileBefore = (await readLocalFile(lockfilePath)).toString();

		const res = await shellExec(`${cli} build --workspace-folder ${tmpDir} --frozen-lockfile`);
		const response = JSON.parse(res.stdout);
		assert.equal(response.outcome, 'success');

		const lockfileAfter = (await readLocalFile(lockfilePath)).toString();
		assert.equal(lockfileAfter, lockfileBefore, 'Lockfile should be unchanged');
	});

	it('--frozen-lockfile fails when lockfile missing', async () => {
		const tmpDir = await isolateFixture('lockfile-no-lockfile');

		try {
			throw await shellExec(`${cli} build --workspace-folder ${tmpDir} --frozen-lockfile`);
		} catch (res) {
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'error');
			assert.equal(response.message, 'Lockfile does not exist.');
		}
	});

	for (const secondFlag of ['--frozen-lockfile', '--experimental-frozen-lockfile', '--experimental-lockfile']) {
		it(`--no-lockfile and ${secondFlag} are mutually exclusive`, async () => {
			const tmpDir = await isolateFixture('lockfile-no-lockfile');

			try {
				throw await shellExec(`${cli} build --workspace-folder ${tmpDir} --no-lockfile ${secondFlag}`);
			} catch (res) {
				assert.match(res.stderr, /mutually exclusive/i, 'Should fail with mutually exclusive error');
			}
		});
	}

	for (const { fixture, flag } of [
		{ fixture: 'lockfile', flag: '--experimental-lockfile' },
		{ fixture: 'lockfile-frozen', flag: '--experimental-frozen-lockfile' },
	]) {
		it(`deprecation warning for ${flag}`, async () => {
			const tmpDir = await isolateFixture(fixture);

			const res = await shellExec(`${cli} build --workspace-folder ${tmpDir} ${flag}`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');
			assert.ok(res.stderr.includes(`${flag} is deprecated`), 'Should emit deprecation warning');
		});
	}

	it('devcontainer up auto-generates lockfile by default', async () => {
		const tmpDir = await isolateFixture('lockfile-no-lockfile');
		const lockfilePath = path.join(tmpDir, '.devcontainer-lock.json');
		const idLabel = `test-lockfile-up=${process.hrtime.bigint()}`;

		try {
			const res = await shellExec(`${cli} up --workspace-folder ${tmpDir} --id-label ${idLabel}`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');

			const actual = await readLocalFile(lockfilePath);
			assert.ok(actual.toString().trim().length > 0, 'Lockfile should have been created');
			const parsed = JSON.parse(actual.toString());
			assert.ok(parsed.features, 'Lockfile should contain features');
		} finally {
			// Clean up by id-label so cleanup happens even if `up` failed before returning a containerId.
			await shellExec(`docker rm -f $(docker ps -aq --filter label=${idLabel}) 2>/dev/null || true`, undefined, true, true);
		}
	});

	it('devcontainer up --frozen-lockfile succeeds with matching lockfile', async () => {
		const tmpDir = await isolateFixture('lockfile-frozen');
		const lockfilePath = path.join(tmpDir, '.devcontainer-lock.json');
		const lockfileBefore = (await readLocalFile(lockfilePath)).toString();
		const idLabel = `test-lockfile-up-frozen=${process.hrtime.bigint()}`;

		try {
			const res = await shellExec(`${cli} up --workspace-folder ${tmpDir} --id-label ${idLabel} --frozen-lockfile`);
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'success');

			const lockfileAfter = (await readLocalFile(lockfilePath)).toString();
			assert.equal(lockfileAfter, lockfileBefore, 'Lockfile should be unchanged');
		} finally {
			await shellExec(`docker rm -f $(docker ps -aq --filter label=${idLabel}) 2>/dev/null || true`, undefined, true, true);
		}
	});

	it('devcontainer up --frozen-lockfile fails when lockfile missing', async () => {
		const tmpDir = await isolateFixture('lockfile-no-lockfile');
		const idLabel = `test-lockfile-up-frozen-fail=${process.hrtime.bigint()}`;

		try {
			throw await shellExec(`${cli} up --workspace-folder ${tmpDir} --id-label ${idLabel} --frozen-lockfile`);
		} catch (res) {
			const response = JSON.parse(res.stdout);
			assert.equal(response.outcome, 'error');
			assert.equal(response.message, 'Lockfile does not exist.');
		} finally {
			await shellExec(`docker rm -f $(docker ps -aq --filter label=${idLabel}) 2>/dev/null || true`, undefined, true, true);
		}
	});

	it('read-only commands do not create a lockfile', async () => {
		const readConfigTmpDir = await isolateFixture('lockfile-no-lockfile');
		const readConfigLockfilePath = path.join(readConfigTmpDir, '.devcontainer-lock.json');

		// read-configuration should not create a lockfile
		await shellExec(`${cli} read-configuration --workspace-folder ${readConfigTmpDir} --include-features-configuration`, undefined, true);
		assert.equal(await lockfileExists(readConfigLockfilePath), false, 'read-configuration should not create a lockfile');

		const resolveDepsTmpDir = await isolateFixture('lockfile-no-lockfile');
		const resolveDepsLockfilePath = path.join(resolveDepsTmpDir, '.devcontainer-lock.json');

		await shellExec(`${cli} features resolve-dependencies --workspace-folder ${resolveDepsTmpDir}`, undefined, true);
		assert.equal(await lockfileExists(resolveDepsLockfilePath), false, 'features resolve-dependencies should not create a lockfile');
	});
});