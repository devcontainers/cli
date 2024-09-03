import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import { createPlainLog, LogLevel, makeLog } from '../../spec-utils/log';
export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));
import { fetchTemplate, SelectedTemplate } from '../../spec-configuration/containerTemplatesOCI';
import { readLocalFile } from '../../spec-utils/pfs';

describe('fetchTemplate', async function () {
	this.timeout('120s');

	it('template apply docker-from-docker without features and with user options', async () => {

		// https://github.com/devcontainers/templates/tree/main/src/docker-from-docker
		const selectedTemplate: SelectedTemplate = {
			id: 'ghcr.io/devcontainers/templates/docker-from-docker:latest',
			options: { 'installZsh': 'false', 'upgradePackages': 'true', 'dockerVersion': '20.10', 'moby': 'true' },
			features: [],
			omitPaths: [],
		};

		const dest = path.relative(process.cwd(), path.join(__dirname, 'tmp1'));
		const files = await fetchTemplate({ output, env: process.env }, selectedTemplate, dest);
		assert.ok(files);
		// Should only container 1 file '.devcontainer.json'.  The other 3 in this repo should be ignored.
		assert.strictEqual(files.length, 1);

		// Read File
		const file = (await readLocalFile(path.join(dest, files[0]))).toString();
		assert.match(file, /"name": "Docker from Docker"/);
		assert.match(file, /"installZsh": "false"/);
		assert.match(file, /"upgradePackages": "true"/);
		assert.match(file, /"version": "20.10"/);
		assert.match(file, /"moby": "true"/);
		assert.match(file, /"enableNonRootDocker": "true"/);

		// Assert that the Features included in the template were not removed.
		assert.match(file, /"ghcr.io\/devcontainers\/features\/common-utils:1": {\n/);
		assert.match(file, /"ghcr.io\/devcontainers\/features\/docker-from-docker:1": {\n/);
	});

	it('template apply docker-from-docker without features and without user options (default only)', async () => {

		// https://github.com/devcontainers/templates/tree/main/src/docker-from-docker
		const selectedTemplate: SelectedTemplate = {
			id: 'ghcr.io/devcontainers/templates/docker-from-docker:latest',
			options: {},
			features: [],
			omitPaths: [],
		};

		const dest = path.relative(process.cwd(), path.join(__dirname, 'tmp2'));
		const files = await fetchTemplate({ output, env: process.env }, selectedTemplate, dest);
		assert.ok(files);
		// Should only container 1 file '.devcontainer.json'.  The other 3 in this repo should be ignored.
		assert.strictEqual(files.length, 1);

		// Read File
		const file = (await readLocalFile(path.join(dest, files[0]))).toString();
		assert.match(file, /"name": "Docker from Docker"/);
		assert.match(file, /"installZsh": "true"/);
		assert.match(file, /"upgradePackages": "false"/);
		assert.match(file, /"version": "latest"/);
		assert.match(file, /"moby": "true"/);
		assert.match(file, /"enableNonRootDocker": "true"/);

		// Assert that the Features included in the template were not removed.
		assert.match(file, /"ghcr.io\/devcontainers\/features\/common-utils:1": {\n/);
		assert.match(file, /"ghcr.io\/devcontainers\/features\/docker-from-docker:1": {\n/);
	});

	it('template apply docker-from-docker with features and with user options', async () => {

		// https://github.com/devcontainers/templates/tree/main/src/docker-from-docker
		const selectedTemplate: SelectedTemplate = {
			id: 'ghcr.io/devcontainers/templates/docker-from-docker:latest',
			options: { 'installZsh': 'false', 'upgradePackages': 'true', 'dockerVersion': '20.10', 'moby': 'true', 'enableNonRootDocker': 'true' },
			features: [{ id: 'ghcr.io/devcontainers/features/azure-cli:1', options: {} }],
			omitPaths: [],
		};

		const dest = path.relative(process.cwd(), path.join(__dirname, 'tmp3'));
		const files = await fetchTemplate({ output, env: process.env }, selectedTemplate, dest);
		assert.ok(files);
		// Should only container 1 file '.devcontainer.json'.  The other 3 in this repo should be ignored.
		assert.strictEqual(files.length, 1);

		// Read File
		const file = (await readLocalFile(path.join(dest, files[0]))).toString();
		assert.match(file, /"name": "Docker from Docker"/);
		assert.match(file, /"installZsh": "false"/);
		assert.match(file, /"upgradePackages": "true"/);
		assert.match(file, /"version": "20.10"/);
		assert.match(file, /"moby": "true"/);
		assert.match(file, /"enableNonRootDocker": "true"/);

		// Assert that the Features included in the template were not removed.
		assert.match(file, /"ghcr.io\/devcontainers\/features\/common-utils:1": {\n/);
		assert.match(file, /"ghcr.io\/devcontainers\/features\/docker-from-docker:1": {\n/);

		// Assert that our new Feature is included
		assert.match(file, /"ghcr.io\/devcontainers\/features\/azure-cli:1": {}/);
	});

	it('template apply docker-from-docker with features and with user options', async () => {

		// https://github.com/devcontainers/templates/tree/main/src/anaconda-postgres
		const selectedTemplate: SelectedTemplate = {
			id: 'ghcr.io/devcontainers/templates/anaconda-postgres:latest',
			options: { 'nodeVersion': 'lts/*' },
			features: [{ id: 'ghcr.io/devcontainers/features/azure-cli:1', options: {} }, { id: 'ghcr.io/devcontainers/features/git:1', options: { 'version': 'latest', ppa: true } }],
			omitPaths: [],
		};

		const dest = path.relative(process.cwd(), path.join(__dirname, 'tmp4'));
		const files = await fetchTemplate({ output, env: process.env }, selectedTemplate, dest);
		assert.ok(files);
		// Expected:
		// ./environment.yml, ./.devcontainer/.env, ./.devcontainer/Dockerfile, ./.devcontainer/devcontainer.json, ./.devcontainer/docker-compose.yml, ./.devcontainer/noop.txt, ./.github/dependabot.yml
		assert.strictEqual(files.length, 7);

		// Read file modified by templated value
		const dockerfile = (await readLocalFile(path.join(dest, '.devcontainer', 'Dockerfile'))).toString();
		assert.match(dockerfile, /FROM mcr.microsoft.com\/devcontainers\/anaconda:/);

		// Read file modified by adding Features
		const devcontainer = (await readLocalFile(path.join(dest, '.devcontainer', 'devcontainer.json'))).toString();
		assert.match(devcontainer, /"ghcr.io\/devcontainers\/features\/azure-cli:1": {}/);
		assert.match(devcontainer, /"ghcr.io\/devcontainers\/features\/git:1": {\n\t\t\t"version": "latest",\n\t\t\t"ppa": true/);
	});

	describe('omit-path', async function () {
		this.timeout('120s');

		// https://github.com/codspace/templates/pkgs/container/templates%2Fmytemplate/255979159?tag=1.0.4
		const id = 'ghcr.io/codspace/templates/mytemplate@sha256:57cbf968907c74c106b7b2446063d114743ab3f63345f7c108c577915c535185';
		const templateFiles = [
			'./c1.ts',
			'./c2.ts',
			'./c3.ts',
			'./.devcontainer/devcontainer.json',
			'./.github/dependabot.yml',
			'./assets/hello.md',
			'./assets/hi.md',
			'./example-projects/exampleA/a1.ts',
			'./example-projects/exampleA/.github/dependabot.yml',
			'./example-projects/exampleA/subFolderA/a2.ts',
			'./example-projects/exampleB/b1.ts',
			'./example-projects/exampleB/.github/dependabot.yml',
			'./example-projects/exampleB/subFolderB/b2.ts',
		];

		// NOTE: Certain files, like the 'devcontainer-template.json', are always filtered
		//	     out as they are not part of the Template.
		it('Omit nothing', async () => {
			const selectedTemplate: SelectedTemplate = {
				id,
				options: {},
				features: [],
				omitPaths: [],
			};

			const files = await fetchTemplate(
				{ output, env: process.env },
				selectedTemplate,
				path.join(os.tmpdir(), 'vsch-test-template-temp', `${Date.now()}`)
			);

			assert.ok(files);
			assert.strictEqual(files.length, templateFiles.length);
			for (const file of templateFiles) {
				assert.ok(files.includes(file));
			}
		});

		it('Omit nested folder', async () => {
			const selectedTemplate: SelectedTemplate = {
				id,
				options: {},
				features: [],
				omitPaths: ['example-projects/exampleB/*'],
			};

			const files = await fetchTemplate(
				{ output, env: process.env },
				selectedTemplate,
				path.join(os.tmpdir(), 'vsch-test-template-temp', `${Date.now()}`)
			);

			const expectedRemovedFiles = [
				'./example-projects/exampleB/b1.ts',
				'./example-projects/example/.github/dependabot.yml',
				'./example-projects/exampleB/subFolderB/b2.ts',
			];

			assert.ok(files);
			assert.strictEqual(files.length, templateFiles.length - 3);
			for (const file of expectedRemovedFiles) {
				assert.ok(!files.includes(file));
			}
		});

		it('Omit single file, root folder, and nested folder', async () => {
			const selectedTemplate: SelectedTemplate = {
				id,
				options: {},
				features: [],
				omitPaths: ['.github/*', 'example-projects/exampleA/*', 'c1.ts'],
			};

			const files = await fetchTemplate(
				{ output, env: process.env },
				selectedTemplate,
				path.join(os.tmpdir(), 'vsch-test-template-temp', `${Date.now()}`)
			);

			const expectedRemovedFiles = [
				'./c1.ts',
				'./.github/dependabot.yml',
				'./example-projects/exampleA/a1.ts',
				'./example-projects/exampleA/.github/dependabot.yml',
				'./example-projects/exampleA/subFolderA/a2.ts',
			];

			assert.ok(files);
			assert.strictEqual(files.length, templateFiles.length - 5);
			for (const file of expectedRemovedFiles) {
				assert.ok(!files.includes(file));
			}
		});
	});


});


