import * as http from 'http';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';

import { assert } from 'chai';

import { OCICollectionRef } from '../spec-configuration/containerCollectionsOCI';
import { canForwardCredentialToTokenService, isAllowedTokenServiceRealm, parseCrossOriginAuthHosts, requestEnsureAuthenticated } from '../spec-configuration/httpOCIRegistry';
import { nullLog } from '../spec-utils/log';

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

	describe('canForwardCredentialToTokenService', () => {
		it('allows Basic and refresh credentials for exact HTTP localhost authority', () => {
			const realm = 'http://localhost:5000/token';
			assert.isTrue(canForwardCredentialToTokenService(realm, 'https://localhost:5000/v2/', 'basic'));
			assert.isTrue(canForwardCredentialToTokenService(realm, 'https://localhost:5000/v2/', 'refreshToken'));
		});

		it('rejects credentials over remote HTTP even for the same authority', () => {
			const realm = 'http://registry.example/token';
			assert.isFalse(canForwardCredentialToTokenService(realm, 'https://registry.example/v2/', 'basic'));
			assert.isFalse(canForwardCredentialToTokenService(realm, 'https://registry.example/v2/', 'refreshToken'));
		});

		it('allows Basic and refresh credentials for the Docker Hub token service', () => {
			const realm = 'https://auth.docker.io/token';
			assert.isTrue(canForwardCredentialToTokenService(realm, 'https://registry-1.docker.io/v2/', 'basic'));
			assert.isTrue(canForwardCredentialToTokenService(realm, 'https://registry-1.docker.io/v2/', 'refreshToken'));
		});

		it('allows Basic and refresh credentials for an explicitly configured mapping', () => {
			const realm = 'https://auth.example/token';
			const registryUrl = 'https://registry.example/v2/';
			const configured = ['registry.example=auth.example'];
			assert.isTrue(canForwardCredentialToTokenService(realm, registryUrl, 'basic', configured));
			assert.isTrue(canForwardCredentialToTokenService(realm, registryUrl, 'refreshToken', configured));
		});

		it('rejects credentials for token services owned by another registry', () => {
			assert.isFalse(canForwardCredentialToTokenService('https://auth.docker.io/token', 'https://attacker.example/v2/', 'basic'));
			assert.isFalse(canForwardCredentialToTokenService('https://ghcr.io/token', 'https://attacker.example/v2/', 'basic'));
			assert.isFalse(canForwardCredentialToTokenService('https://registry.azurecr.io/token', 'https://attacker.example/v2/', 'refreshToken'));
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
				registry,
				path: 'test/features',
				resource: `${registry}/test/features`,
				tag: 'latest',
				version: 'latest',
			};
			const cachedAuthHeader: Record<string, string> = {};

			const result = await requestEnsureAuthenticated({ env: {}, output: nullLog, cachedAuthHeader }, {
				type: 'GET',
				url: `http://${registry}/v2/test/features/manifests/latest`,
				headers: {},
			}, ociRef);

			assert.isUndefined(result);
			assert.equal(registryRequests, 1);
			assert.equal(tokenRequests, 0);
			assert.notProperty(cachedAuthHeader, registry);
		} finally {
			await Promise.all([close(registryServer), close(tokenServer)]);
		}
	});

	it('forwards a refresh token to an explicitly configured auth host', async () => {
		const token = 'registry-token';
		const refreshToken = 'registry-refresh-token';
		const bearerScheme = 'Bearer';
		let tokenRequests = 0;
		const tokenServer = http.createServer(async (request, response) => {
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
		const previousDockerConfig = process.env.DOCKER_CONFIG;
		process.env.DOCKER_CONFIG = dockerConfig;

		try {
			const ociRef: OCICollectionRef = {
				registry,
				path: 'test/features',
				resource: `${registry}/test/features`,
				tag: 'latest',
				version: 'latest',
			};

			const result = await requestEnsureAuthenticated({
				env: {},
				output: nullLog,
				allowedCrossOriginAuthHosts: [`${registry}=localhost:${tokenPort}`],
			}, {
				type: 'GET',
				url: `http://${registry}/v2/test/features/manifests/latest`,
				headers: {},
			}, ociRef);

			assert.equal(result?.statusCode, 200);
			assert.equal(registryRequests, 2);
			assert.equal(tokenRequests, 1);
		} finally {
			if (previousDockerConfig === undefined) {
				delete process.env.DOCKER_CONFIG;
			} else {
				process.env.DOCKER_CONFIG = previousDockerConfig;
			}
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
				registry,
				path: 'test/features',
				resource: `${registry}/test/features`,
				tag: 'latest',
				version: 'latest',
			};

			const result = await requestEnsureAuthenticated({
				env: { DEVCONTAINERS_OCI_AUTH: `${registry}|user|token` },
				output: nullLog,
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
				registry,
				path: 'test/features',
				resource: `${registry}/test/features`,
				tag: 'latest',
				version: 'latest',
			};

			const result = await requestEnsureAuthenticated({
				env: { DEVCONTAINERS_OCI_AUTH: `${registry}|user|token` },
				output: nullLog,
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