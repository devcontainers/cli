import { createPlainLog, LogLevel, makeLog } from '../../spec-utils/log';
import * as assert from 'assert';
export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));
import { fetchTemplate, SelectedTemplate } from '../../spec-configuration/containerTemplatesOCI';
import * as path from 'path';
import { readLocalFile } from '../../spec-utils/pfs';

describe('fetchTemplate', async function () {

	it('succeeds on docker-from-docker template', async () => {

		// https://github.com/devcontainers/templates/tree/main/src/docker-from-docker
		const selectedTempate: SelectedTemplate = {
			id: 'ghcr.io/devcontainers/templates/docker-from-docker:latest',
			options: {'installZsh': 'false', 'upgradePackages': 'true', 'dockerVersion': '20.10', 'moby': 'true', 'enableNonRootDocker': 'true' }
		}

		const dest = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
		const files = await fetchTemplate(output, selectedTempate, dest);
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
});