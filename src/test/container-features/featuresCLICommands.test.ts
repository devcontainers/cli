import { assert } from 'chai';
import path from 'path';
import { createPlainLog, LogLevel, makeLog } from '../../spec-utils/log';
import { isLocalFile, readLocalFile } from '../../spec-utils/pfs';
import { ExecResult, shellExec } from '../testUtils';
import { getSemanticVersions } from '../../spec-node/collectionCommonUtils/publishCommandImpl';
import { getRef, getPublishedVersions } from '../../spec-configuration/containerCollectionsOCI';
export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));

const pkg = require('../../../package.json');

describe('CLI features subcommands', async function () {
	this.timeout('240s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp2'));
	const cli = `npx --prefix ${tmp} devcontainer`;

	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`rm -rf ${tmp}/output`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
	});

	describe('features test', async function () {

		it('succeeds when using --project-folder', async function () {
			const collectionFolder = `${__dirname}/example-v2-features-sets/simple`;
			let success = false;
			let result: ExecResult | undefined = undefined;
			try {
				result = await shellExec(`${cli} features test --project-folder ${collectionFolder} --base-image mcr.microsoft.com/devcontainers/base:ubuntu --log-level trace`);
				success = true;

			} catch (error) {
				assert.fail('features test sub-command should not throw');
			}

			assert.isTrue(success);
			assert.isDefined(result);

			// '--preserve-test-containers' is not set, so containers from this test run should be deleted.
			const expectedCleanupString = /Cleaning up \d test containers/;
			assert.match(result.stdout, expectedCleanupString);

			const expectedTestReport = `  ================== TEST REPORT ==================
✅ Passed:      'color'
✅ Passed:      'specific_color_scenario'
✅ Passed:      'color duplicate'
✅ Passed:      'hello'
✅ Passed:      'custom_options'
✅ Passed:      'with_external_feature'`;
			const hasExpectedTestReport = result.stdout.includes(expectedTestReport);
			assert.isTrue(hasExpectedTestReport);
		});

		it('succeeds when setting --remote-user', async function () {
			const collectionFolder = `${__dirname}/example-v2-features-sets/autogenerated-set-flags`;
			let success = false;
			let result: ExecResult | undefined = undefined;
			try {
				result = await shellExec(`${cli} features test --project-folder ${collectionFolder} --base-image mcr.microsoft.com/devcontainers/base:ubuntu --remote-user root --log-level trace --preserve-test-containers`);
				success = true;

			} catch (error) {
				assert.fail('features test sub-command should not throw');
			}


			// '--preserve-test-containers' IS set, so containers from this test run should NOT be deleted.
			const expectedCleanupString = /Cleaning up \d test containers/;
			assert.notMatch(result.stdout, expectedCleanupString);

			assert.isTrue(success);
			assert.isDefined(result);

			const expectedTestReport = `  ================== TEST REPORT ==================
✅ Passed:      'hey'`;
			const hasExpectedTestReport = result.stdout.includes(expectedTestReport);
			assert.isTrue(hasExpectedTestReport);

			assert.isTrue(result.stdout.includes('Good day, root'));
		});

		it('succeeds when invoking another script from the same test folder', async function () {
			const collectionFolder = `${__dirname}/example-v2-features-sets/sharing-test-scripts`;
			let success = false;
			let result: ExecResult | undefined = undefined;
			try {
				result = await shellExec(`${cli} features test --project-folder ${collectionFolder} --base-image mcr.microsoft.com/devcontainers/base:ubuntu --log-level trace`);
				success = true;

			} catch (error) {
				assert.fail('features test sub-command should not throw');
			}

			assert.isTrue(success);
			assert.isDefined(result);

			const expectedTestReport = `  ================== TEST REPORT ==================
✅ Passed:      'util'
✅ Passed:      'some_scenario'
✅ Passed:      'some_scenario_2'
✅ Passed:      'random_scenario'`;
			const hasExpectedTestReport = result.stdout.includes(expectedTestReport);
			assert.isTrue(hasExpectedTestReport);

			assert.isTrue(result.stdout.includes('I AM A DIFFERENT SCRIPT'));
			assert.isTrue(result.stdout.includes('I AM A HELPER SCRIPT FOR A SCENARIO'));
		});

		it('succeeds when passing --filter some_scenario', async function () {
			const collectionFolder = `${__dirname}/example-v2-features-sets/sharing-test-scripts`;
			let success = false;
			let result: ExecResult | undefined = undefined;
			try {
				result = await shellExec(`${cli} features test --filter some_scenario --project-folder ${collectionFolder} --base-image mcr.microsoft.com/devcontainers/base:ubuntu --log-level trace`);
				success = true;

			} catch (error) {
				assert.fail('features test sub-command should not throw');
			}

			assert.isTrue(success);
			assert.isDefined(result);

			const expectedTestReport = `  ================== TEST REPORT ==================
✅ Passed:      'util'
✅ Passed:      'some_scenario'
✅ Passed:      'some_scenario_2'`;
			const hasExpectedTestReport = result.stdout.includes(expectedTestReport);
			assert.isTrue(hasExpectedTestReport);

			// Assert the output does not contain the random scenario we filtered out
			assert.isFalse(result.stdout.includes('random_scenario'));
		});

		it('succeeds with defaults', async function () {
			const collectionFolder = `${__dirname}/example-v2-features-sets/simple`;
			let success = false;
			let result: ExecResult | undefined = undefined;
			try {
				result = await shellExec(`${cli} features test --base-image mcr.microsoft.com/devcontainers/base:ubuntu --log-level trace ${collectionFolder}`);
				success = true;

			} catch (error) {
				assert.fail('features test sub-command should not throw');
			}

			assert.isTrue(success);
			assert.isDefined(result);

			const expectedTestReport = `  ================== TEST REPORT ==================
✅ Passed:      'color'
✅ Passed:      'specific_color_scenario'
✅ Passed:      'color duplicate'
✅ Passed:      'hello'
✅ Passed:      'custom_options'
✅ Passed:      'with_external_feature'`;
			const hasExpectedTestReport = result.stdout.includes(expectedTestReport);
			assert.isTrue(hasExpectedTestReport);

			assert.isTrue(result.stdout.includes('my favorite color is red'));
			assert.isTrue(result.stdout.includes('hey, vscode?????'));

			assert.isTrue(result.stdout.includes('my favorite color is Magenta'));
			assert.isTrue(result.stdout.includes('Ciao, vscode?????'));
		});

		it('succeeds --skip-autogenerated and subset of features and --skip-duplicate-test', async function () {
			const collectionFolder = `${__dirname}/example-v2-features-sets/simple`;
			let success = false;
			let result: ExecResult | undefined = undefined;
			try {
				result = await shellExec(`${cli} features test -f color --skip-autogenerated --skip-duplicate-test --log-level trace ${collectionFolder}`);
				success = true;

			} catch (error) {
				assert.fail('features test sub-command should not throw');
			}

			assert.isTrue(success);
			assert.isDefined(result);

			const expectedTestReport = `  ================== TEST REPORT ==================
✅ Passed:      'specific_color_scenario'`;
			const hasExpectedTestReport = result.stdout.includes(expectedTestReport);
			assert.isTrue(hasExpectedTestReport);

			assert.isTrue(result.stdout.includes('my favorite color is green'));

			// Given the '--skip-autogenerated' and '-f color' switches, these cases should not be exercised.
			assert.isFalse(result.stdout.includes('my favorite color is red'));
			assert.isFalse(result.stdout.includes('hey, root?????'));
			assert.isFalse(result.stdout.includes('Ciao, root?????'));
		});

		it('succeeds testing remoteUser', async function () {
			const collectionFolder = `${__dirname}/example-v2-features-sets/remote-user`;
			let success = false;
			let result: ExecResult | undefined = undefined;
			try {
				result = await shellExec(`${cli} features test --filter add_with_common_utils --projectFolder ${collectionFolder}`);
				success = true;

			} catch (error) {
				assert.fail('features test sub-command should not throw');
			}

			assert.isTrue(success);
			assert.isDefined(result);

			const expectedTestReport = `  ================== TEST REPORT ==================
✅ Passed:      'whoisremoteuser'
✅ Passed:      'add_with_common_utils'`;
			const hasExpectedTestReport = result.stdout.includes(expectedTestReport);
			assert.isTrue(hasExpectedTestReport);
		});

		it('succeeds with --global-scenarios-only', async function () {
			const collectionFolder = `${__dirname}/example-v2-features-sets/simple`;
			let success = false;
			let result: ExecResult | undefined = undefined;
			try {
				result = await shellExec(`${cli} features test --global-scenarios-only --log-level trace ${collectionFolder}`);
				success = true;
			} catch (error) {
				assert.fail('features test sub-command should not throw');
			}

			assert.isTrue(success);
			assert.isDefined(result);

			const expectedTestReport = `  ================== TEST REPORT ==================
✅ Passed:      'custom_options'
✅ Passed:      'with_external_feature'`;
			const hasExpectedTestReport = result.stdout.includes(expectedTestReport);
			assert.isTrue(hasExpectedTestReport);

			// With --global-scenarios-only, 
			// the default values should NOT be included in the test
			// and therefore we should NOT see the following outputs.
			assert.isFalse(result.stdout.includes('my favorite color is red'));
			assert.isFalse(result.stdout.includes('hey, vscode?????!'));

			assert.isTrue(result.stdout.includes('my favorite color is Magenta'));
			assert.isTrue(result.stdout.includes('Ciao, vscode?????'));

		});

		it('successfully reports a failing test', async function () {
			const collectionFolder = `${__dirname}/example-v2-features-sets/failing-test`;
			// shellExec's doNotThrow set to 'true'
			const result = await shellExec(`${cli} features test --base-image mcr.microsoft.com/devcontainers/base:ubuntu --log-level trace ${collectionFolder}`, undefined, undefined, true);

			const expectedTestReport = `  ================== TEST REPORT ==================
❌ Failed:      'hello'`;
			const hasExpectedTestReport = result.stdout.includes(expectedTestReport);
			assert.isTrue(hasExpectedTestReport);

			assert.isTrue(result.stderr.includes('❌ testThatShouldFail check failed.'));
			assert.isDefined(result.error);
		});

		// Feature A will crash in its install.sh if B has not already run.
		it('installsAfter B -> A', async function () {
			const collectionFolder = `${__dirname}/example-v2-features-sets/a-installs-after-b`;
			let success = false;
			let result: ExecResult | undefined = undefined;
			try {
				result = await shellExec(`${cli} features test --log-level trace ${collectionFolder}`);
				success = true;

			} catch (error) {
				assert.fail('features test sub-command should not throw');
			}

			assert.isTrue(success);
			assert.isDefined(result);

			const expectedTestReport = `  ================== TEST REPORT ==================
✅ Passed:      'a'
✅ Passed:      'b'`;
			const hasExpectedTestReport = result.stdout.includes(expectedTestReport);
			assert.isTrue(hasExpectedTestReport);
		});

		// Feature B will crash in its install.sh if A has not already run.
		it('installsAfter A -> B', async function () {
			const collectionFolder = `${__dirname}/example-v2-features-sets/b-installs-after-a`;
			let success = false;
			let result: ExecResult | undefined = undefined;
			try {
				result = await shellExec(`${cli} features test --log-level trace ${collectionFolder}`);
				success = true;

			} catch (error) {
				assert.fail('features test sub-command should not throw');
			}

			assert.isTrue(success);
			assert.isDefined(result);

			const expectedTestReport = `  ================== TEST REPORT ==================
✅ Passed:      'a'
✅ Passed:      'b'`;
			const hasExpectedTestReport = result.stdout.includes(expectedTestReport);
			assert.isTrue(hasExpectedTestReport);
		});

		it('lifecycle-hooks', async function () {
			const collectionFolder = `${__dirname}/example-v2-features-sets/lifecycle-hooks`;
			let success = false;
			let result: ExecResult | undefined = undefined;
			try {
				result = await shellExec(`${cli} features test --log-level trace ${collectionFolder}`);
				success = true;

			} catch (error) {
				assert.fail('features test sub-command should not throw');
			}

			assert.isTrue(success);
			assert.isDefined(result);

			const onCreateFiredFeatureA = result.stderr.includes('A-ON-CREATE-COMMAND');
			assert.isTrue(onCreateFiredFeatureA);
			const onCreateFiredFeatureB = result.stderr.includes('B-ON-CREATE-COMMAND');
			assert.isTrue(onCreateFiredFeatureB);

			const expectedTestReport = `  ================== TEST REPORT ==================
✅ Passed:      'a'
✅ Passed:      'b'`;
			const hasExpectedTestReport = result.stdout.includes(expectedTestReport);
			assert.isTrue(hasExpectedTestReport);
		});

		it('installsAfter fruit -> hello', async function () {
			const collectionFolder = `${__dirname}/configs/example-installsAfter`;
			let result: ExecResult | undefined = undefined;
			try {
				result = await shellExec(`${cli} up --workspace-folder ${collectionFolder} --log-level trace`);

			} catch (error) {
				assert.fail('devcontainers up should not throw - installsAfter logic failed');
			}

			const response = JSON.parse(result.stdout);
			assert.equal(response.outcome, 'success');
			const containerId: string = response.containerId;

			await shellExec(`docker rm -f ${containerId}`);
		});

		// 'hello' contains 'installsAfter' with a 'legacyId: color' https://github.com/codspace/features/blob/main/src/hello/devcontainer-feature.json#L20
		// 'color' is renamed to 'new-color' https://github.com/codspace/features/blob/main/src/new-color/devcontainer-feature.json#L19
		// .devcontainer.json
		// "features": {
		// 	  "ghcr.io/codspace/features/hello:1": {},
		// 	  "ghcr.io/codspace/features/new-color:1": {}
		// }
		it('installsAfter hello -> new-color (back compat check for legacyIds)', async function () {
			const collectionFolder = `${__dirname}/configs/example-legacyIds`;
			let result: ExecResult | undefined = undefined;
			try {
				result = await shellExec(`${cli} up --workspace-folder ${collectionFolder} --log-level trace`);

			} catch (error) {
				assert.fail('devcontainers up should not throw - installsAfter logic failed');
			}

			const response = JSON.parse(result.stdout);
			assert.equal(response.outcome, 'success');
			const containerId: string = response.containerId;

			await shellExec(`docker rm -f ${containerId}`);
		});

		// 'flower' contains 'installsAfter' with new ID 'new-color' https://github.com/codspace/features/blob/main/src/flower/devcontainer-feature.json#L19
		// 'color' is renamed to 'new-color' https://github.com/codspace/features/blob/main/src/new-color/devcontainer-feature.json#L19
		// .devcontainer.json
		// "features": {
		// 	  "ghcr.io/codspace/features/flower:1": {},
		// 	  "ghcr.io/codspace/features/color:1": {}
		// }
		it('installsAfter flower -> color (forward compat check for legacyIds)', async function () {
			const collectionFolder = `${__dirname}/configs/example-legacyIds-2`;
			let result: ExecResult | undefined = undefined;
			try {
				result = await shellExec(`${cli} up --workspace-folder ${collectionFolder} --log-level trace`);

			} catch (error) {
				assert.fail('devcontainers up should not throw - installsAfter logic failed');
			}

			const response = JSON.parse(result.stdout);
			assert.equal(response.outcome, 'success');
			const containerId: string = response.containerId;

			await shellExec(`docker rm -f ${containerId}`);
		});

		it('succeeds testing a scenario with a Dockerfile', async function () {
			const collectionFolder = `${__dirname}/example-v2-features-sets/dockerfile-scenario-test`;
			let success = false;
			let result: ExecResult | undefined = undefined;
			try {
				result = await shellExec(`${cli} features test --project-folder ${collectionFolder} --skip-autogenerated --log-level trace `);
				success = true;

			} catch (error) {
				assert.fail('features test sub-command should not throw');
			}

			assert.isTrue(success);
			assert.isDefined(result);

			const expectedTestReport = `  ================== TEST REPORT ==================
✅ Passed:      'smiling'
✅ Passed:      'frowning'
✅ Passed:      'frowning_with_a_dockerfile'`;
			const hasExpectedTestReport = result.stdout.includes(expectedTestReport);
			assert.isTrue(hasExpectedTestReport);
		});
	});

	describe('features package', function () {

		it('features package subcommand by collection', async function () {
			const srcFolder = `${__dirname}/example-v2-features-sets/simple/src`;
			let success = false;
			try {
				await shellExec(`${cli} features package -o ${tmp}/output/test01 -f --log-level trace  ${srcFolder} `);
				success = true;
			} catch (error) {
				assert.fail('features package sub-command should not throw');
			}
			assert.isTrue(success);

			const colorTgzExists = await isLocalFile(`${tmp}/output/test01/devcontainer-feature-color.tgz`);
			assert.isTrue(colorTgzExists);
			const tgzArchiveContentsColor = await shellExec(`tar -tvf ${tmp}/output/test01/devcontainer-feature-color.tgz`);
			assert.match(tgzArchiveContentsColor.stdout, /devcontainer-feature.json/);
			assert.match(tgzArchiveContentsColor.stdout, /install.sh/);

			const helloTgzExists = await isLocalFile(`${tmp}/output/test01/devcontainer-feature-hello.tgz`);
			assert.isTrue(helloTgzExists);
			const tgzArchiveContentsHello = await shellExec(`tar -tvf ${tmp}/output/test01/devcontainer-feature-hello.tgz`);
			assert.match(tgzArchiveContentsHello.stdout, /devcontainer-feature.json/);
			assert.match(tgzArchiveContentsHello.stdout, /install.sh/);

			const collectionFileExists = await isLocalFile(`${tmp}/output/test01/devcontainer-collection.json`);
			const json = JSON.parse((await readLocalFile(`${tmp}/output/test01/devcontainer-collection.json`)).toString());
			assert.strictEqual(json.features.length, 2);
			assert.isTrue(collectionFileExists);
		});

		it('features package subcommand by single feature', async function () {
			const singleFeatureFolder = `${__dirname}/example-v2-features-sets/simple/src/color`;
			let success = false;
			try {
				await shellExec(`${cli} features package -o ${tmp}/output/test02 -f --log-level trace  ${singleFeatureFolder} `);
				success = true;
			} catch (error) {
				assert.fail('features package sub-command should not throw');
			}
			assert.isTrue(success);

			const colorTgzExists = await isLocalFile(`${tmp}/output/test02/devcontainer-feature-color.tgz`);
			assert.isTrue(colorTgzExists);
			const tgzArchiveContentsColor = await shellExec(`tar -tvf ${tmp}/output/test02/devcontainer-feature-color.tgz`);
			assert.match(tgzArchiveContentsColor.stdout, /devcontainer-feature.json/);
			assert.match(tgzArchiveContentsColor.stdout, /install.sh/);

			const collectionFileExists = await isLocalFile(`${tmp}/output/test02/devcontainer-collection.json`);
			assert.isTrue(collectionFileExists);
			const json = JSON.parse((await readLocalFile(`${tmp}/output/test02/devcontainer-collection.json`)).toString());
			assert.strictEqual(json.features.length, 1);
			assert.isTrue(collectionFileExists);
		});
	});
});

describe('test function getSermanticVersions', () => {
	it('should generate correct semantic versions for first publishing', async () => {
		let version = '1.0.0';
		let publishedVersions: string[] = [];
		let expectedSemVer = ['1', '1.0', '1.0.0', 'latest'];

		let semanticVersions = getSemanticVersions(version, publishedVersions, output);
		assert.equal(semanticVersions?.toString(), expectedSemVer.toString());
	});

	it('should generate correct semantic versions for publishing new patch version', async () => {
		let version = '1.0.1';
		let publishedVersions = ['1', '1.0', '1.0.0', 'latest'];
		let expectedSemVer = ['1', '1.0', '1.0.1', 'latest'];

		let semanticVersions = getSemanticVersions(version, publishedVersions, output);
		assert.equal(semanticVersions?.toString(), expectedSemVer.toString());
	});

	it('should generate correct semantic versions for publishing new minor version', async () => {
		let version = '1.1.0';
		let publishedVersions = ['1', '1.0', '1.0.0', '1.0.1', 'latest'];
		let expectedSemVer = ['1', '1.1', '1.1.0', 'latest'];

		let semanticVersions = getSemanticVersions(version, publishedVersions, output);
		assert.equal(semanticVersions?.toString(), expectedSemVer.toString());
	});

	it('should generate correct semantic versions for publishing new major version', async () => {
		let version = '2.0.0';
		let publishedVersions = ['1', '1.0', '1.0.0', 'latest'];
		let expectedSemVer = ['2', '2.0', '2.0.0', 'latest'];

		let semanticVersions = getSemanticVersions(version, publishedVersions, output);
		assert.equal(semanticVersions?.toString(), expectedSemVer.toString());
	});

	it('should generate correct semantic versions for publishing hotfix patch version', async () => {
		let version = '1.0.2';
		let publishedVersions = ['1', '1.0', '1.0.0', '1.0.1', '1.1', '1.1.0', '2', '2.0', '2.0.0', 'latest'];
		let expectedSemVer = ['1.0', '1.0.2'];

		let semanticVersions = getSemanticVersions(version, publishedVersions, output);
		assert.equal(semanticVersions?.toString(), expectedSemVer.toString());
	});

	it('should generate correct semantic versions for publishing hotfix minor version', async () => {
		let version = '1.0.1';
		let publishedVersions = ['1', '1.0', '1.0.0', '2', '2.0', '2.0.0', 'latest'];
		let expectedSemVer = ['1', '1.0', '1.0.1'];

		let semanticVersions = getSemanticVersions(version, publishedVersions, output);
		assert.equal(semanticVersions?.toString(), expectedSemVer.toString());
	});

	it('should return undefined for already published version', async () => {
		let version = '1.0.1';
		let publishedVersions = ['1', '1.0', '1.0.0', '1.0.1', '2', '2.0', '2.0.0', 'latest'];

		let semanticVersions = getSemanticVersions(version, publishedVersions, output);
		assert.isUndefined(semanticVersions);
	});
});

describe('test function getPublishedVersions', async () => {
	it('should list published versions', async () => {
		const resource = 'ghcr.io/devcontainers/features/node';
		const featureRef = getRef(output, resource);
		if (!featureRef) {
			assert.fail('featureRef should not be undefined');
		}
		const versionsList = await getPublishedVersions({ output, env: process.env }, featureRef) ?? [];
		assert.includeMembers(versionsList, ['1', '1.0', '1.0.0', 'latest']);
	});
});
