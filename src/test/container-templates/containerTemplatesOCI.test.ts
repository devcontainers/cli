import { createPlainLog, LogLevel, makeLog } from '../../spec-utils/log';
import * as assert from 'assert';
export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));
import { fetchTemplate } from '../../spec-configuration/containerTemplatesOCI';
import * as path from 'path';
import { readLocalFile } from '../../spec-utils/pfs';

describe('fetchTemplate', async function () {

	it('succeeds on docker-from-docker template', async () => {
		const dest = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
		const files = await fetchTemplate(output, 'ghcr.io/devcontainers/templates/docker-from-docker:latest', dest);
		assert.ok(files);
		// Should only container 1 file '.devcontainer.json'.  The other 3 in this repo should be ignored.
		// https://github.com/devcontainers/templates/tree/main/src/docker-from-docker
		assert.strictEqual(files.length, 1);

		// Read File
		const file = await readLocalFile(path.join(dest, files[0]));
		assert.match(file.toString(), /"name": "Docker from Docker"/);
	});
});