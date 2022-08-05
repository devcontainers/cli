import { assert } from 'chai';
import path from 'path';
import { createPlainLog, LogLevel, makeLog } from '../../spec-utils/log';
import { isLocalFile } from '../../spec-utils/pfs';
import { shellExec } from '../testUtils';
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

	it('features test subcommand', async function () {
		const collectionFolder = `${__dirname}/example-v2-features-sets/simple`;
		let success = false;
		try {
			await shellExec(`${cli} features test -c ${collectionFolder} --base-image mcr.microsoft.com/devcontainers/base:ubuntu --log-level trace`);
			success = true;
		} catch (error) {
			assert.fail('features test sub-command should not throw');
		}
		assert.isTrue(success);
	});

	it('features package subcommand (collection)', async function () {
		const collectionFolder = `${__dirname}/example-v2-features-sets/simple`;
		let success = false;
		try {
			await shellExec(`${cli} features package -o ${tmp}/output/test01 -f --log-level trace  ${collectionFolder} `);
			success = true;
		} catch (error) {
			assert.fail('features package sub-command should not throw');
		}
		assert.isTrue(success);

		const colorTgzExists = await isLocalFile(`${tmp}/output/test01/devcontainer-feature-color.tgz`);
		assert.isTrue(colorTgzExists);

		const helloTgzExists = await isLocalFile(`${tmp}/output/test01/devcontainer-feature-hello.tgz`);
		assert.isTrue(helloTgzExists);

		const collectionFileExists = await isLocalFile(`${tmp}/output/test01/devcontainer-collection.json`);
		assert.isTrue(collectionFileExists);
	});

	it('features package subcommand (single feature)', async function () {
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

		const collectionFileExists = await isLocalFile(`${tmp}/output/test02/devcontainer-collection.json`);
		assert.isTrue(collectionFileExists);
	});
});