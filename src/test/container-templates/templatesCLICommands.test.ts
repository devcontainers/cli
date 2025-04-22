import { assert } from 'chai';
import path from 'path';
import { createPlainLog, LogLevel, makeLog } from '../../spec-utils/log';
import { isLocalFile, readLocalFile } from '../../spec-utils/pfs';
import { ExecResult, shellExec } from '../testUtils';
import { DevContainerCollectionMetadata, packageTemplates } from '../../spec-node/templatesCLI/packageImpl';
import { Template } from '../../spec-configuration/containerTemplatesConfiguration';
import { PackageCommandInput } from '../../spec-node/collectionCommonUtils/package';
import { getCLIHost } from '../../spec-common/cliHost';
import { loadNativeModule } from '../../spec-common/commonUtils';
import { generateTemplatesDocumentation } from '../../spec-node/collectionCommonUtils/generateDocsCommandImpl';

export const output = makeLog(createPlainLog(text => process.stderr.write(text), () => LogLevel.Trace));

const pkg = require('../../../package.json');

describe('tests apply command', async function () {
	this.timeout('120s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp6'));
	const cli = `npx --prefix ${tmp} devcontainer`;

	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`rm -rf ${tmp}/output`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
	});

	it('templates apply subcommand', async function () {
		let success = false;
		let result: ExecResult | undefined = undefined;
		try {
			result = await shellExec(`${cli} templates apply --workspace-folder ${path.join(tmp, 'template-output')} \
			--template-id     ghcr.io/devcontainers/templates/docker-from-docker:latest \
			--template-args   '{ "installZsh": "false", "upgradePackages": "true", "dockerVersion": "20.10", "moby": "true", "enableNonRootDocker": "true" }' \
			--features        '[{ "id": "ghcr.io/devcontainers/features/azure-cli:1", "options": { "version" : "1" } }]' \
			--log-level trace`);
			success = true;

		} catch (error) {
			assert.fail('features test sub-command should not throw');
		}

		assert.isTrue(success);
		assert.isDefined(result);
		assert.strictEqual(result.stdout.trim(), '{"files":["./.devcontainer/devcontainer.json"]}');

		const file = (await readLocalFile(path.join(tmp, 'template-output', '.devcontainer', 'devcontainer.json'))).toString();

		assert.match(file, /"name": "Docker from Docker"/);
		assert.match(file, /"installZsh": "false"/);
		assert.match(file, /"upgradePackages": "true"/);
		assert.match(file, /"version": "20.10"/);
		assert.match(file, /"moby": "true"/);
		assert.match(file, /"enableNonRootDocker": "true"/);

		// Assert that the Features included in the template were not removed.
		assert.match(file, /"ghcr.io\/devcontainers\/features\/common-utils:1": {\n/);
		assert.match(file, /"ghcr.io\/devcontainers\/features\/docker-from-docker:1": {\n/);

		// Assert that the Feature included in the command was added.
		assert.match(file, /"ghcr.io\/devcontainers\/features\/azure-cli:1": {\n/);
	});
});

describe('tests packageTemplates()', async function () {
	this.timeout('120s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp3'));

	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`rm -rf ${tmp}/output`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
	});

    const cwd = process.cwd();
    const cliHost = await getCLIHost(cwd, loadNativeModule, true);

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

		const metadata = await packageTemplates(args);
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
		assert.strictEqual(json.templates.length, 4);
		assert.isTrue(collectionFileExists);

		// Checks if the automatically added properties are set correctly.
		const alpineProperties: Template | undefined = json?.templates.find(t => t.id === 'alpine');
		assert.isNotEmpty(alpineProperties);
		assert.equal(alpineProperties?.type, 'image');
		assert.equal(alpineProperties?.fileCount, 2);
		assert.equal(alpineProperties?.featureIds?.length, 0);

		const cppProperties: Template | undefined = json?.templates.find(t => t.id === 'cpp');
		assert.isNotEmpty(cppProperties);
		assert.equal(cppProperties?.type, 'dockerfile');
		assert.equal(cppProperties?.fileCount, 3);
		assert.equal(cppProperties?.featureIds?.length, 1);
		assert.equal(cppProperties?.featureIds?.[0], 'ghcr.io/devcontainers/features/common-utils');

		const nodeProperties: Template | undefined = json?.templates.find(t => t.id === 'node-mongo');
		assert.isNotEmpty(nodeProperties);
		assert.equal(nodeProperties?.type, 'dockerCompose');
		assert.equal(nodeProperties?.fileCount, 3);
		assert.equal(nodeProperties?.featureIds?.length, 2);
		assert.isTrue(nodeProperties?.featureIds?.some(f => f === 'ghcr.io/devcontainers/features/common-utils'));
		assert.isTrue(nodeProperties?.featureIds?.some(f => f === 'ghcr.io/devcontainers/features/git'));

		const mytemplateProperties: Template | undefined = json?.templates.find(t => t.id === 'mytemplate');
		console.log(JSON.stringify(mytemplateProperties, null, 4));
		assert.isNotEmpty(mytemplateProperties);
		// -- optionalPaths
		assert.strictEqual(mytemplateProperties?.optionalPaths?.length, 3);
		assert.deepEqual(mytemplateProperties?.optionalPaths,
			[
				'.github/dependabot.yml',  // NOTE: Packaging step replaces the original value '.github/*' here since there's only a single file in the folder
				'example-projects/exampleA/*',
				'c1.ts'
			]);
		// -- files
		assert.strictEqual(mytemplateProperties?.files?.length, 14);
		assert.deepEqual(mytemplateProperties?.files.sort(), [
			'c1.ts',
			'c2.ts',
			'c3.ts',
			'devcontainer-template.json',
			'.devcontainer/devcontainer.json',
			'.github/dependabot.yml',
			'assets/hello.md',
			'assets/hi.md',
			'example-projects/exampleA/a1.ts',
			'example-projects/exampleA/.github/dependabot.yml',
			'example-projects/exampleA/subFolderA/a2.ts',
			'example-projects/exampleB/b1.ts',
			'example-projects/exampleB/.github/dependabot.yml',
			'example-projects/exampleB/subFolderB/b2.ts'
		].sort()); // Order isn't guaranteed
		// -- featureIds
		assert.strictEqual(mytemplateProperties?.featureIds?.length, 4);
		assert.deepEqual(mytemplateProperties?.featureIds, [
			'ghcr.io/devcontainers/features/azure-cli',
			'ghcr.io/devcontainers/features/aws-cli',
			'ghcr.io/devcontainers/features/common-utils',
			'ghcr.io/devcontainers/features/docker-in-docker'
		]);


	});

	it('tests packaging for single template', async function () {
		const singleTemplateFolder = `${__dirname}/example-templates-sets/simple/src/alpine`;
		const outputDir = `${tmp}/output/test02`;

		args.targetFolder = singleTemplateFolder;
		args.outputDir = outputDir;

		const metadata = await packageTemplates(args);
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

describe('tests generateTemplateDocumentation()', async function () {
	this.timeout('120s');

	const projectFolder = `${__dirname}/example-templates-sets/simple/src`;

	after('clean', async () => {
		await shellExec(`rm ${projectFolder}/**/README.md`);
	});

	it('tests generate-docs', async function () {
		await generateTemplatesDocumentation(projectFolder, 'devcontainers', 'cli', output);

		const alpineDocsExists = await isLocalFile(`${projectFolder}/alpine/README.md`);
		assert.isTrue(alpineDocsExists);

		const cppDocsExists = await isLocalFile(`${projectFolder}/cpp/README.md`);
		assert.isTrue(cppDocsExists);

		const nodeMongoDocsExists = await isLocalFile(`${projectFolder}/node-mongo/README.md`);
		assert.isTrue(nodeMongoDocsExists);

		const invalidDocsExists = await isLocalFile(`${projectFolder}/not-a-template/README.md`);
		assert.isFalse(invalidDocsExists);
	});
});

describe('template metadata', async function () {
	this.timeout('120s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp7'));
	const cli = `npx --prefix ${tmp} devcontainer`;

	// https://github.com/codspace/templates/pkgs/container/templates%2Fmytemplate/255979159?tag=1.0.4
	const templateId = 'ghcr.io/codspace/templates/mytemplate@sha256:57cbf968907c74c106b7b2446063d114743ab3f63345f7c108c577915c535185';

	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`rm -rf ${tmp}/output`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
	});

	it('successfully fetches metdata off a published Template', async function () {
		let success = false;
		let result: ExecResult | undefined = undefined;
		try {
			result = await shellExec(`${cli} templates metadata ${templateId} --log-level trace`);
			success = true;

		} catch (error) {
			assert.fail('features test sub-command should not throw');
		}

		assert.isTrue(success);
		assert.isDefined(result);
		const json = JSON.parse(result.stdout);
		assert.strictEqual('mytemplate', json.id);
		assert.strictEqual('Simple test', json.description);

	});
});