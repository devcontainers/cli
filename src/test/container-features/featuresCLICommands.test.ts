import { assert } from 'chai';
import path from 'path';
import { createPlainLog, LogLevel, makeLog } from '../../spec-utils/log';
import { isLocalFile, readLocalFile } from '../../spec-utils/pfs';
import { ExecResult, shellExec } from '../testUtils';
export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));

const pkg = require('../../../package.json');

describe('CLI features subcommands', async function () {
	this.timeout('120s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp2'));
	const cli = `npx --prefix ${tmp} devcontainer`;

	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`rm -rf ${tmp}/output`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
	});

	it('features test subcommand with defaults', async function () {
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
✅ Passed:      'hello'
✅ Passed:      'custom_options'`;
		const hasExpectedTestReport = result.stdout.includes(expectedTestReport);
		assert.isTrue(hasExpectedTestReport);

		assert.isTrue(result.stderr.includes('my favorite color is red'));
		assert.isTrue(result.stderr.includes('hey, root!'));

		assert.isTrue(result.stderr.includes('my favorite color is Magenta'));
		assert.isTrue(result.stderr.includes('Ciao, root!'));
	});

	it('features test subcommand with --global-scenarios-only', async function () {
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
✅ Passed:      'custom_options'`;
		const hasExpectedTestReport = result.stdout.includes(expectedTestReport);
		assert.isTrue(hasExpectedTestReport);

		// With --global-scenarios-only, 
		// the default values should NOT be included in the test
		// and therefore we should NOT see the following outputs.
		assert.isFalse(result.stderr.includes('my favorite color is red'));
		assert.isFalse(result.stderr.includes('hey, root!'));

		assert.isTrue(result.stderr.includes('my favorite color is Magenta'));
		assert.isTrue(result.stderr.includes('Ciao, root!'));

	});

	it('features test subcommand with a failing test', async function () {
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

	// -- Packaging

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