import { execFile } from 'child_process';
import * as http from 'http';
import * as https from 'https';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

import { assert } from 'chai';

import { OCICollectionRef } from '../spec-configuration/containerCollectionsOCI';
import { isAllowedTokenServiceRealm, parseCrossOriginAuthHosts, requestEnsureAuthenticated } from '../spec-configuration/httpOCIRegistry';
import { nullLog } from '../spec-utils/log';
import { createTestCommonParams } from './testUtils';

const execFileAsync = promisify(execFile);
const certificateFolder = join(__dirname, 'fixtures');
const certificatePath = join(certificateFolder, 'localhost-cert.pem');
const privateKeyPath = join(certificateFolder, 'localhost-key.pem');

async function getLocalhostCertificate() {
	try {
		return {
			cert: await readFile(certificatePath),
			key: await readFile(privateKeyPath),
		};
	} catch (error) {
		if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
			throw error;
		}
	}

	await mkdir(certificateFolder, { recursive: true });
	await execFileAsync('openssl', [
		'req',
		'-x509',
		'-newkey', 'rsa:2048',
		'-nodes',
		'-keyout', privateKeyPath,
		'-out', certificatePath,
		'-days', '3650',
		'-subj', '/CN=localhost',
		'-addext', 'subjectAltName=DNS:localhost',
	]);
	return {
		cert: await readFile(certificatePath),
		key: await readFile(privateKeyPath),
	};
}

describe('OCI registry authentication', () => {
	describe('isAllowedTokenServiceRealm', () => {
		const cases = [
			{ realm: 'https://registry.example/token', registryUrl: 'https://registry.example/v2/', expected: true },
			{ realm: 'https://REGISTRY.EXAMPLE/token', registryUrl: 'https://registry.example/v2/', expected: true },
			{ realm: 'https://registry.example/token', registryUrl: 'https://registry.example:443/v2/', expected: true },
			{ realm: 'https://registry.example:8443/token', registryUrl: 'https://registry.example:8443/v2/', expected: true },
			{ realm: 'https://registry.example:8443/token', registryUrl: 'https://registry.example/v2/', expected: false },
			{ realm: 'http://registry.example/token', registryUrl: 'https://registry.example/v2/', expected: false },
			{ realm: 'http://localhost:5000/token', registryUrl: 'https://localhost:5000/v2/', expected: true },
			{ realm: 'http://localhost:5001/token', registryUrl: 'https://localhost:5000/v2/', expected: false },
			{ realm: 'not-a-url', registryUrl: 'https://registry.example/v2/', expected: false },
			{ realm: '/token', registryUrl: 'https://registry.example/v2/', expected: false },
			{ realm: 'https://auth.docker.io/token', registryUrl: 'https://registry-1.docker.io/v2/', expected: true },
			{ realm: 'https://auth.docker.io/token', registryUrl: 'https://docker.io/v2/', expected: true },
			{ realm: 'https://auth.docker.io/token', registryUrl: 'https://attacker.example/v2/', expected: false },
			{ realm: 'http://auth.docker.io/token', registryUrl: 'https://registry-1.docker.io/v2/', expected: false },
			{ realm: 'https://gitlab.com/jwt/auth', registryUrl: 'https://registry.gitlab.com/v2/', expected: true },
			{ realm: 'https://gitlab.com/jwt/auth', registryUrl: 'https://attacker.example/v2/', expected: false },
			{ realm: 'https://ghcr.io/token', registryUrl: 'https://ghcr.io/v2/', expected: true },
			{ realm: 'https://ghcr.io/token', registryUrl: 'https://containers.example/v2/', expected: false },
			{ realm: 'https://registry.azurecr.io/oauth2/token', registryUrl: 'https://registry.azurecr.io/v2/', expected: true },
			{ realm: 'https://registry.azurecr.io/oauth2/token', registryUrl: 'https://containers.example/v2/', expected: false },
			{ realm: 'https://auth.docker.io.attacker.example/token', registryUrl: 'https://registry-1.docker.io/v2/', expected: false },
			{ realm: 'https://auth.docker.io:8443/token', registryUrl: 'https://registry-1.docker.io/v2/', expected: false },
			{ realm: 'http://127.0.0.1/token', registryUrl: 'https://attacker.example/v2/', expected: false },
			{ realm: 'http://169.254.169.254/token', registryUrl: 'https://attacker.example/v2/', expected: false },
		];

		for (const { realm, registryUrl, expected } of cases) {
			it(`${expected ? 'allows' : 'rejects'} '${realm}' for '${registryUrl}'`, () => {
				assert.equal(isAllowedTokenServiceRealm(realm, registryUrl), expected);
			});
		}

		it('allows an explicitly configured registry-to-auth-host mapping', () => {
			assert.isTrue(isAllowedTokenServiceRealm(
				'https://auth.example/token',
				'https://registry.example/v2/',
				['registry.example=auth.example'],
			));
		});
	});

	describe('parseCrossOriginAuthHosts', () => {
		it('normalizes authorities and preserves ports', () => {
			const parsed = parseCrossOriginAuthHosts(['REGISTRY.EXAMPLE:8443=AUTH.EXAMPLE:9443']);
			assert.deepEqual([...parsed.get('registry.example:8443')!], ['auth.example:9443']);
		});

		for (const entry of [
			'auth.example',
			'=auth.example',
			'registry.example=',
			'https://registry.example=auth.example',
			'registry.example=https://auth.example',
			'registry.example/path=auth.example',
		]) {
			it(`rejects malformed mapping '${entry}'`, () => {
				assert.throws(() => parseCrossOriginAuthHosts([entry]));
			});
		}
	});

	it('does not request a rejected bearer token realm', async () => {
		let registryRequests = 0;
		let tokenRequests = 0;
		const tokenServer = http.createServer((_request, response) => {
			tokenRequests++;
			response.end(JSON.stringify({ token: 'internal-secret' }));
		});
		const tokenPort = await listen(tokenServer);
		const registryServer = http.createServer((_request, response) => {
			registryRequests++;
			response.writeHead(401, {
				'WWW-Authenticate': `Bearer realm="http://localhost:${tokenPort}/token",service="attacker.example",scope="repository:test:pull"`,
			});
			response.end();
		});
		const registryPort = await listen(registryServer);

		try {
			const registry = `127.0.0.1:${registryPort}`;
			const ociRef: OCICollectionRef = {
				scheme: 'http',
				registry,
				path: 'test/features',
				resource: `${registry}/test/features`,
				tag: 'latest',
				version: 'latest',
			};
			const cachedAuthHeader: Record<string, string> = {};
			const params = createTestCommonParams(nullLog, {});

			const result = await requestEnsureAuthenticated({ ...params, cachedAuthHeader, ociAuthHardening: true }, {
				type: 'GET',
				url: `http://${registry}/v2/test/features/manifests/latest`,
				headers: {},
			}, ociRef);

			assert.isUndefined(result);
			assert.equal(registryRequests, 1);
			assert.equal(tokenRequests, 0);
			assert.notProperty(cachedAuthHeader, registry);
			assert.isTrue(params.ociAuthDiagnostics.authLookupWouldBeBlocked);
		} finally {
			await Promise.all([close(registryServer), close(tokenServer)]);
		}
	});

	it('surfaces shadow diagnostics when hardening is disabled', async () => {
		const token = 'registry-token';
		const bearerScheme = 'Bearer';
		let redirectTargetRequests = 0;
		const redirectTargetServer = http.createServer((_request, response) => {
			redirectTargetRequests++;
			response.end(JSON.stringify({ token }));
		});
		const redirectTargetPort = await listen(redirectTargetServer);

		let tokenRequests = 0;
		const tokenServer = http.createServer((_request, response) => {
			tokenRequests++;
			response.writeHead(307, {
				location: `http://localhost:${redirectTargetPort}/token`,
			});
			response.end();
		});
		const tokenPort = await listen(tokenServer);

		let challengeRegistryRequests = 0;
		const challengeRegistryServer = http.createServer((_request, response) => {
			challengeRegistryRequests++;
			response.writeHead(401, {
				'WWW-Authenticate': `${bearerScheme} realm="http://localhost:${tokenPort}/token",service="attacker.example",scope="repository:test:pull"`,
			});
			response.end();
		});
		const challengeRegistryPort = await listen(challengeRegistryServer);

		let registryRequests = 0;
		const registryServer = http.createServer((request, response) => {
			registryRequests++;
			response.writeHead(307, {
				location: `http://localhost:${challengeRegistryPort}${request.url}`,
			});
			response.end();
		});
		const registryPort = await listen(registryServer);
		const registry = `127.0.0.1:${registryPort}`;
		const logMessages: string[] = [];
		const output = {
			...nullLog,
			write: (text: string) => logMessages.push(text),
		};

		try {
			const ociRef: OCICollectionRef = {
				scheme: 'http',
				registry,
				path: 'test/features',
				resource: `${registry}/test/features`,
				tag: 'latest',
				version: 'latest',
			};

			const result = await requestEnsureAuthenticated(createTestCommonParams(output, {}), {
				type: 'GET',
				url: `http://${registry}/v2/test/features/manifests/latest`,
				headers: {},
			}, ociRef);

			assert.equal(result?.statusCode, 401);
			assert.equal(registryRequests, 2);
			assert.equal(challengeRegistryRequests, 2);
			assert.equal(tokenRequests, 1);
			assert.equal(redirectTargetRequests, 1);
			assert.deepEqual(result?.ociAuthDiagnostics, {
				authLookupWouldBeBlocked: true,
				registryRedirectWouldPreventCredentialForwarding: true,
				authServerRedirect: true,
			});
			assert.lengthOf(logMessages.filter(message => message.includes('OCI auth diagnostics:')), 3);
		} finally {
			await Promise.all([close(registryServer), close(challengeRegistryServer), close(tokenServer), close(redirectTargetServer)]);
		}
	});

	it('ignores cross-origin redirects that do not produce an auth challenge', async () => {
		const contentServer = http.createServer((_request, response) => {
			response.writeHead(200);
			response.end('blob');
		});
		const contentPort = await listen(contentServer);
		const registryServer = http.createServer((_request, response) => {
			response.writeHead(307, {
				location: `http://localhost:${contentPort}/blob`,
			});
			response.end();
		});
		const registryPort = await listen(registryServer);
		const registry = `127.0.0.1:${registryPort}`;

		try {
			const ociRef: OCICollectionRef = {
				scheme: 'http',
				registry,
				path: 'test/features',
				resource: `${registry}/test/features`,
				tag: 'latest',
				version: 'latest',
			};
			const params = createTestCommonParams(nullLog, {});

			const result = await requestEnsureAuthenticated(params, {
				type: 'GET',
				url: `http://${registry}/v2/test/features/blobs/sha256:test`,
				headers: {},
			}, ociRef);

			assert.equal(result?.statusCode, 200);
			assert.isFalse(params.ociAuthDiagnostics.registryRedirectWouldPreventCredentialForwarding);
		} finally {
			await Promise.all([close(registryServer), close(contentServer)]);
		}
	});

	it('forwards a refresh token to an explicitly configured auth host', async () => {
		const token = 'registry-token';
		const refreshToken = 'registry-refresh-token';
		const bearerScheme = 'Bearer';
		let tokenRequests = 0;
		const tokenServer = https.createServer(await getLocalhostCertificate(), async (request, response) => {
			tokenRequests++;
			try {
				const chunks: Buffer[] = [];
				for await (const chunk of request) {
					chunks.push(chunk as Buffer);
				}
				const body = new URLSearchParams(Buffer.concat(chunks).toString());
				assert.equal(request.method, 'POST');
				assert.equal(body.get('refresh_token'), refreshToken);
				response.end(JSON.stringify({ token }));
			} catch (err) {
				response.destroy(err as Error);
			}
		});
		const tokenPort = await listen(tokenServer);

		let registryRequests = 0;
		const registryServer = http.createServer((request, response) => {
			registryRequests++;
			if (request.headers.authorization === `${bearerScheme} ${token}`) {
				response.writeHead(200);
				response.end();
				return;
			}
			response.writeHead(401, {
				'WWW-Authenticate': `${bearerScheme} realm="https://localhost:${tokenPort}/token",service="registry.example",scope="repository:test:pull"`,
			});
			response.end();
		});
		const registryPort = await listen(registryServer);
		const registry = `localhost:${registryPort}`;
		const dockerConfig = await mkdtemp(join(tmpdir(), 'devcontainers-oci-auth-'));
		await writeFile(join(dockerConfig, 'config.json'), JSON.stringify({
			auths: {
				[registry]: {
					auth: '',
					identitytoken: refreshToken,
				},
			},
		}));

		try {
			const { stdout } = await execFileAsync(process.execPath, [
				'-r',
				'ts-node/register',
				join(__dirname, 'httpOCIRegistryRefreshTokenClient.ts'),
			], {
				cwd: join(__dirname, '..', '..'),
				encoding: 'utf8',
				env: {
					...process.env,
					DOCKER_CONFIG: dockerConfig,
					NODE_EXTRA_CA_CERTS: certificatePath,
					TEST_REGISTRY: registry,
					TEST_TOKEN_PORT: `${tokenPort}`,
					TS_NODE_PROJECT: join(__dirname, 'tsconfig.json'),
				},
			});
			const result = JSON.parse(stdout);

			assert.equal(result.statusCode, 200);
			assert.equal(registryRequests, 2);
			assert.equal(tokenRequests, 1);
			assert.deepEqual(result.ociAuthDiagnostics, {
				authLookupWouldBeBlocked: false,
				registryRedirectWouldPreventCredentialForwarding: false,
				authServerRedirect: false,
			});
		} finally {
			await rm(dockerConfig, { recursive: true });
			await Promise.all([close(registryServer), close(tokenServer)]);
		}
	});

	it('does not follow redirects from a bearer token realm', async () => {
		let redirectTargetRequests = 0;
		const redirectTargetServer = http.createServer((_request, response) => {
			redirectTargetRequests++;
			response.end(JSON.stringify({ token: 'internal-secret' }));
		});
		const redirectTargetPort = await listen(redirectTargetServer);

		let registryRequests = 0;
		const registryServer = http.createServer((request, response) => {
			registryRequests++;
			if (request.url?.startsWith('/token')) {
				response.writeHead(302, { location: `http://localhost:${redirectTargetPort}/token` });
				response.end();
				return;
			}

			const registryPort = (registryServer.address() as AddressInfo).port;
			response.writeHead(401, {
				'WWW-Authenticate': `Bearer realm="http://localhost:${registryPort}/token",service="localhost:${registryPort}",scope="repository:test:pull"`,
			});
			response.end();
		});
		const registryPort = await listen(registryServer);
		const registry = `localhost:${registryPort}`;

		try {
			const ociRef: OCICollectionRef = {
				scheme: 'http',
				registry,
				path: 'test/features',
				resource: `${registry}/test/features`,
				tag: 'latest',
				version: 'latest',
			};

			const result = await requestEnsureAuthenticated({
				...createTestCommonParams(nullLog, { DEVCONTAINERS_OCI_AUTH: `${registry}|user|token` }),
				ociAuthHardening: true,
			}, {
				type: 'GET',
				url: `http://${registry}/v2/test/features/manifests/latest`,
				headers: {},
			}, ociRef);

			assert.isUndefined(result);
			assert.equal(registryRequests, 2);
			assert.equal(redirectTargetRequests, 0);
		} finally {
			await Promise.all([close(registryServer), close(redirectTargetServer)]);
		}
	});

	it('encodes bearer token service and scope query values', async () => {
		const service = 'registry.example&injected=service#fragment';
		const scope = 'repository:test:pull&injected=scope#fragment';
		const token = 'registry-token';
		let registryRequests = 0;
		let tokenRequests = 0;
		const registryServer = http.createServer((request, response) => {
			const registryPort = (registryServer.address() as AddressInfo).port;
			if (request.url?.startsWith('/token')) {
				tokenRequests++;
				const tokenUrl = new URL(request.url, `http://localhost:${registryPort}`);
				assert.equal(tokenUrl.searchParams.get('existing'), 'value');
				assert.equal(tokenUrl.searchParams.get('service'), service);
				assert.equal(tokenUrl.searchParams.get('scope'), scope);
				assert.isFalse(tokenUrl.searchParams.has('injected'));
				response.end(JSON.stringify({ token }));
				return;
			}

			registryRequests++;
			if (request.headers.authorization === `Bearer ${token}`) {
				response.writeHead(200);
				response.end();
				return;
			}

			response.writeHead(401, {
				'WWW-Authenticate': `Bearer realm="http://localhost:${registryPort}/token?existing=value#realm-fragment",service="${service}",scope="${scope}"`,
			});
			response.end();
		});
		const registryPort = await listen(registryServer);
		const registry = `localhost:${registryPort}`;

		try {
			const ociRef: OCICollectionRef = {
				scheme: 'http',
				registry,
				path: 'test/features',
				resource: `${registry}/test/features`,
				tag: 'latest',
				version: 'latest',
			};

			const result = await requestEnsureAuthenticated({
				...createTestCommonParams(nullLog, { DEVCONTAINERS_OCI_AUTH: `${registry}|user|token` }),
			}, {
				type: 'GET',
				url: `http://${registry}/v2/test/features/manifests/latest`,
				headers: {},
			}, ociRef);

			assert.equal(result?.statusCode, 200);
			assert.equal(registryRequests, 2);
			assert.equal(tokenRequests, 1);
		} finally {
			await close(registryServer);
		}
	});
});

function listen(server: http.Server): Promise<number> {
	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			server.removeListener('error', reject);
			resolve((server.address() as AddressInfo).port);
		});
	});
}

function close(server: http.Server): Promise<void> {
	return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}