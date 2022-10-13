import { createPlainLog, LogLevel, makeLog } from '../../spec-utils/log';
import * as assert from 'assert';
export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));
import { fetchTemplate, SelectedTemplate } from '../../spec-configuration/containerTemplatesOCI';
import * as path from 'path';
import { readLocalFile } from '../../spec-utils/pfs';

describe('fetchTemplate', async function () {
	this.timeout('120s');

	it('succeeds on docker-from-docker template', async () => {

		// https://github.com/devcontainers/templates/tree/main/src/docker-from-docker
		const selectedTemplate: SelectedTemplate = {
			id: 'ghcr.io/devcontainers/templates/docker-from-docker:latest',
			options: {'installZsh': 'false', 'upgradePackages': 'true', 'dockerVersion': '20.10', 'moby': 'true', 'enableNonRootDocker': 'true' }
		};

		const dest = path.relative(process.cwd(), path.join(__dirname, 'tmp1'));
		const files = await fetchTemplate(output, selectedTemplate, dest);
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
	});

	it('succeeds on anaconda-postgres template', async () => {

		// https://github.com/devcontainers/templates/tree/main/src/anaconda-postgres
		const selectedTemplate: SelectedTemplate = {
			id: 'ghcr.io/devcontainers/templates/anaconda-postgres:latest',
			options: { 'nodeVersion': 'lts/*' }
		};

		const dest = path.relative(process.cwd(), path.join(__dirname, 'tmp2'));
		const files = await fetchTemplate(output, selectedTemplate, dest);
		assert.ok(files);
		// Expected:
		// ./environment.yml, ./.devcontainer/.env, ./.devcontainer/Dockerfile, ./.devcontainer/devcontainer.json, ./.devcontainer/docker-compose.yml, ./.devcontainer/noop.txt
		assert.strictEqual(files.length, 6);

		// Read File
		const file = (await readLocalFile(path.join(dest, '.devcontainer', 'Dockerfile'))).toString();
		assert.match(file, /ARG NODE_VERSION="lts\/\*"/);

	});
});