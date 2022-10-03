import { assert } from 'chai';
import path from 'path';
import { createPlainLog, LogLevel, makeLog } from '../../spec-utils/log';
import { isLocalFile, readLocalFile } from '../../spec-utils/pfs';
import { shellExec } from '../testUtils';
import { DevContainerCollectionMetadata, doTemplatesPackageCommand } from '../../spec-node/templatesCLI/packageImpl';
import { Template } from '../../spec-configuration/containerTemplatesConfiguration';
import { PackageCommandInput } from '../../spec-node/collectionCommonUtils/package';
import { getCLIHost } from '../../spec-common/cliHost';
import { loadNativeModule } from '../../spec-common/commonUtils';

export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));

const pkg = require('../../../package.json');

describe('tests doTemplatesPackageCommand()', async function () {
	this.timeout('120s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp3'));

	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`rm -rf ${tmp}/output`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
	});

    const cwd = process.cwd();
    const cliHost = await getCLIHost(cwd, loadNativeModule);

	let args: PackageCommandInput = {
		targetFolder: '',
		outputDir: '',
		output,
		cliHost,
		disposables: [],
		forceCleanOutputDir: true
	};

	// -- Packaging

	it('tests packaging for templates collection', async function () {
		const srcFolder = `${__dirname}/example-templates-sets/simple/src`;
		const outputDir = `${tmp}/output/test01`;

		args.targetFolder = srcFolder;
		args.outputDir = outputDir;

		const metadata = await doTemplatesPackageCommand(args);
		assert.isDefined(metadata);

		const alpineTgzExists = await isLocalFile(`${outputDir}/devcontainer-template-alpine.tgz`);
		assert.isTrue(alpineTgzExists);
		const tgzArchiveContentsAlpine = await shellExec(`tar -tvf ${outputDir}/devcontainer-template-alpine.tgz`);
		assert.match(tgzArchiveContentsAlpine.stdout, /devcontainer-template.json/);
		assert.match(tgzArchiveContentsAlpine.stdout, /.devcontainer.json/);

		const cppTgzExists = await isLocalFile(`${outputDir}/devcontainer-template-cpp.tgz`);
		assert.isTrue(cppTgzExists);
		const tgzArchiveContentsHello = await shellExec(`tar -tvf ${outputDir}/devcontainer-template-cpp.tgz`);
		assert.match(tgzArchiveContentsHello.stdout, /devcontainer-template.json/);
		assert.match(tgzArchiveContentsHello.stdout, /.devcontainer/);
		assert.match(tgzArchiveContentsHello.stdout, /.devcontainer\/Dockerfile/);
		assert.match(tgzArchiveContentsHello.stdout, /.devcontainer\/devcontainer.json/);

		const collectionFileExists = await isLocalFile(`${outputDir}/devcontainer-collection.json`);
		const json: DevContainerCollectionMetadata = JSON.parse((await readLocalFile(`${outputDir}/devcontainer-collection.json`)).toString());
		assert.strictEqual(json.templates.length, 3);
		assert.isTrue(collectionFileExists);

		// Checks if the automatically added properties are set correctly.
		const alpineProperties: Template | undefined = json?.templates.find(t => t.id === 'alpine');
		assert.isNotEmpty(alpineProperties);
		assert.equal(alpineProperties?.type, 'image');
		assert.equal(alpineProperties?.fileCount, 2);

		const cppProperties: Template | undefined = json?.templates.find(t => t.id === 'cpp');
		assert.isNotEmpty(cppProperties);
		assert.equal(cppProperties?.type, 'dockerfile');
		assert.equal(cppProperties?.fileCount, 3);

		const nodeProperties: Template | undefined = json?.templates.find(t => t.id === 'node-mongo');
		assert.isNotEmpty(nodeProperties);
		assert.equal(nodeProperties?.type, 'dockerCompose');
		assert.equal(nodeProperties?.fileCount, 3);
	});

	it('tests packaging for single template', async function () {
		const singleTemplateFolder = `${__dirname}/example-templates-sets/simple/src/alpine`;
		const outputDir = `${tmp}/output/test02`;

		args.targetFolder = singleTemplateFolder;
		args.outputDir = outputDir;

		const metadata = await doTemplatesPackageCommand(args);
		assert.isDefined(metadata);

		const alpineTgzExists = await isLocalFile(`${outputDir}/devcontainer-template-alpine.tgz`);
		assert.isTrue(alpineTgzExists);
		const tgzArchiveContentsAlpine = await shellExec(`tar -tvf ${outputDir}/devcontainer-template-alpine.tgz`);
		assert.match(tgzArchiveContentsAlpine.stdout, /devcontainer-template.json/);
		assert.match(tgzArchiveContentsAlpine.stdout, /.devcontainer.json/);

		const collectionFileExists = await isLocalFile(`${outputDir}/devcontainer-collection.json`);
		assert.isTrue(collectionFileExists);
		const json: DevContainerCollectionMetadata = JSON.parse((await readLocalFile(`${outputDir}/devcontainer-collection.json`)).toString());
		assert.strictEqual(json.templates.length, 1);
		assert.isTrue(collectionFileExists);

		// Checks if the automatically added `type` property is set correctly.
		const alpineProperties: Template | undefined = json?.templates.find(t => t.id === 'alpine');
		assert.isNotEmpty(alpineProperties);
		assert.equal(alpineProperties?.type, 'image');
		assert.equal(alpineProperties?.fileCount, 2);
	});
});
