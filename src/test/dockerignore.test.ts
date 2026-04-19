import { assert } from 'chai';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getCLIHost } from '../spec-common/cliHost';
import { buildAndExtendDockerCompose } from '../spec-node/dockerCompose';
import { nullLog } from '../spec-utils/log';
import { testSubstitute } from './testUtils';

describe('dockerignore handling', () => {
	it('copies Dockerfile-specific dockerignore files next to generated compose Dockerfiles', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dockerignore-compose-'));
		const workspace = path.join(root, 'workspace');
		const devcontainerDir = path.join(workspace, '.devcontainer', 'app');
		const composeFile = path.join(devcontainerDir, 'docker-compose.yaml');
		const dockerfile = path.join(devcontainerDir, 'dev.Dockerfile');
		const sourceDockerIgnore = `${dockerfile}.dockerignore`;
		const dockerIgnoreContent = '*\n!/app/requirements.txt\n';
		let generatedFolder: string | undefined;

		try {
			await fs.mkdir(devcontainerDir, { recursive: true });
			await fs.writeFile(dockerfile, 'FROM ubuntu:24.04\nRUN echo hello\n');
			await fs.writeFile(sourceDockerIgnore, dockerIgnoreContent);
			await fs.writeFile(composeFile, [
				'services:',
				'  app:',
				'    build:',
				'      context: ../..',
				'      dockerfile: .devcontainer/app/dev.Dockerfile',
				'',
			].join('\n'));

			const fakeDocker = path.join(root, 'fake-docker');
			await fs.writeFile(fakeDocker, `#!/bin/sh
set -eu
mode=""
for arg in "$@"; do
	case "$arg" in
		config) mode="config" ;;
		build) mode="build" ;;
	esac
done
if [ "$1" = "inspect" ]; then
	printf '%s' '[{"Id":"img","Architecture":"amd64","Os":"linux","Config":{"User":"","Env":[],"Labels":{}}}]'
	exit 0
fi
if [ "$1" = "compose" ] && [ "$mode" = "config" ]; then
	cat <<'EOF'
services:
  app:
    build:
      context: ${workspace}
      dockerfile: .devcontainer/app/dev.Dockerfile
EOF
	exit 0
fi
if [ "$1" = "compose" ] && [ "$mode" = "build" ]; then
	exit 0
fi
printf 'unexpected %s\n' "$*" >&2
exit 1
`);
			await fs.chmod(fakeDocker, 0o755);

			const cliHost = await getCLIHost(workspace, async () => undefined, false);
			const common = {
				cliHost,
				env: process.env,
				output: nullLog,
				package: { name: 'test', version: '0.0.0' },
				persistedFolder: path.join(root, 'persisted'),
				skipPersistingCustomizationsFromFeatures: false,
				omitSyntaxDirective: false,
			} as any;
			const params = {
				common,
				dockerCLI: fakeDocker,
				dockerComposeCLI: async () => ({ version: '2.20.0', cmd: fakeDocker, args: ['compose'] }),
				dockerEnv: process.env,
				isPodman: false,
				buildKitVersion: undefined,
				dockerEngineVersion: undefined,
				isTTY: false,
				buildPlatformInfo: { os: 'linux', arch: 'amd64' },
				targetPlatformInfo: { os: 'linux', arch: 'amd64' },
			} as any;
			const config = { service: 'app' };

			const result = await buildAndExtendDockerCompose(
				{ config, raw: config, substitute: testSubstitute } as any,
				'proj',
				params,
				[composeFile],
				undefined,
				[],
				[],
				false,
				common.persistedFolder,
				'docker-compose.devcontainer.build',
				'',
				{},
				true,
				undefined,
				true
			);

			assert.lengthOf(result.additionalComposeOverrideFiles, 1);
			const override = await fs.readFile(result.additionalComposeOverrideFiles[0], 'utf8');
			const match = override.match(/dockerfile: (.+)/);
			assert.isNotNull(match);
			const generatedDockerfile = match![1].trim();
			const generatedDockerIgnore = `${generatedDockerfile}.dockerignore`;

			generatedFolder = path.dirname(generatedDockerfile);
			assert.strictEqual(await fs.readFile(generatedDockerIgnore, 'utf8'), dockerIgnoreContent);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
			if (generatedFolder) {
				await fs.rm(generatedFolder, { recursive: true, force: true });
			}
		}
	});
});
