import { assert } from 'chai';
import path from 'path';
import { createPlainLog, LogLevel, makeLog } from '../../spec-utils/log';
import { isLocalFile, readLocalFile } from '../../spec-utils/pfs';
import { shellExec } from '../testUtils';
export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));

const pkg = require('../../../package.json');

describe('CLI templates subcommands', async function () {
	this.timeout('120s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp3'));
	const cli = `npx --prefix ${tmp} devcontainer`;

	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`rm -rf ${tmp}/output`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
	});

	// -- Packaging

	it('templates package subcommand by collection', async function () {
		const srcFolder = `${__dirname}/example-templates-sets/simple/src`;
		let success = false;
		try {
			await shellExec(`${cli} templates package -o ${tmp}/output/test01 -f --log-level trace  ${srcFolder} `);
			success = true;
		} catch (error) {
			assert.fail('templates package sub-command should not throw');
		}
		assert.isTrue(success);

		const alpineTgzExists = await isLocalFile(`${tmp}/output/test01/devcontainer-template-alpine.tgz`);
		assert.isTrue(alpineTgzExists);
		const tgzArchiveContentsAlpine = await shellExec(`tar -tvf ${tmp}/output/test01/devcontainer-template-alpine.tgz`);
		assert.match(tgzArchiveContentsAlpine.stdout, /devcontainer-template.json/);
		assert.match(tgzArchiveContentsAlpine.stdout, /.devcontainer.json/);

		const cppTgzExists = await isLocalFile(`${tmp}/output/test01/devcontainer-template-cpp.tgz`);
		assert.isTrue(cppTgzExists);
		const tgzArchiveContentsHello = await shellExec(`tar -tvf ${tmp}/output/test01/devcontainer-template-cpp.tgz`);
		assert.match(tgzArchiveContentsHello.stdout, /devcontainer-template.json/);
		assert.match(tgzArchiveContentsHello.stdout, /.devcontainer/);
		assert.match(tgzArchiveContentsHello.stdout, /.devcontainer\/Dockerfile/);
		assert.match(tgzArchiveContentsHello.stdout, /.devcontainer\/devcontainer.json/);

		const collectionFileExists = await isLocalFile(`${tmp}/output/test01/devcontainer-collection.json`);
		const json = JSON.parse((await readLocalFile(`${tmp}/output/test01/devcontainer-collection.json`)).toString());
		assert.strictEqual(json.templates.length, 2);
		assert.isTrue(collectionFileExists);
	});

	it('templates package subcommand by single template', async function () {
		const singleTemplateFolder = `${__dirname}/example-templates-sets/simple/src/alpine`;
		let success = false;
		try {
			await shellExec(`${cli} templates package -o ${tmp}/output/test02 -f --log-level trace  ${singleTemplateFolder} `);
			success = true;
		} catch (error) {
			assert.fail('templates package sub-command should not throw');
		}
		assert.isTrue(success);

		const alpineTgzExists = await isLocalFile(`${tmp}/output/test01/devcontainer-template-alpine.tgz`);
		assert.isTrue(alpineTgzExists);
		const tgzArchiveContentsAlpine = await shellExec(`tar -tvf ${tmp}/output/test01/devcontainer-template-alpine.tgz`);
		assert.match(tgzArchiveContentsAlpine.stdout, /devcontainer-template.json/);
		assert.match(tgzArchiveContentsAlpine.stdout, /.devcontainer.json/);

		const collectionFileExists = await isLocalFile(`${tmp}/output/test02/devcontainer-collection.json`);
		assert.isTrue(collectionFileExists);
		const json = JSON.parse((await readLocalFile(`${tmp}/output/test02/devcontainer-collection.json`)).toString());
		assert.strictEqual(json.templates.length, 1);
		assert.isTrue(collectionFileExists);
	});
});
