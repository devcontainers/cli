import * as http from 'http';
import { AddressInfo } from 'net';

import { assert } from 'chai';

import { OCICollectionRef } from '../spec-configuration/containerCollectionsOCI';
import { canForwardCredentialToTokenService, isAllowedTokenServiceRealm, requestEnsureAuthenticated } from '../spec-configuration/httpOCIRegistry';
import { nullLog } from '../spec-utils/log';

describe('OCI registry authentication', () => {
	describe('isAllowedTokenServiceRealm', () => {
		const cases = [
			{ realm: 'https://registry.example/token', registry: 'registry.example', expected: true },
			{ realm: 'https://REGISTRY.EXAMPLE/token', registry: 'registry.example', expected: true },
			{ realm: 'https://registry.example:8443/token', registry: 'registry.example:8443', expected: true },
			{ realm: 'https://registry.example:8443/token', registry: 'registry.example', expected: false },
			{ realm: 'https://registry.example/token', registry: 'registry.example:8443', expected: false },
			{ realm: 'http://registry.example/token', registry: 'registry.example', expected: false },
			{ realm: 'http://localhost:5000/token', registry: 'localhost:5000', expected: true },
			{ realm: 'http://localhost:5001/token', registry: 'localhost:5000', expected: false },
			{ realm: 'not-a-url', registry: 'registry.example', expected: false },
			{ realm: '/token', registry: 'registry.example', expected: false },
			{ realm: 'https://auth.docker.io/token', registry: 'registry-1.docker.io', expected: true },
			{ realm: 'https://auth.docker.io/token', registry: 'docker.io', expected: true },
			{ realm: 'https://auth.docker.io/token', registry: 'attacker.example', expected: true },
			{ realm: 'http://auth.docker.io/token', registry: 'registry-1.docker.io', expected: false },
			{ realm: 'https://ghcr.io/token', registry: 'ghcr.io', expected: true },
			{ realm: 'https://ghcr.io/token', registry: 'containers.example', expected: true },
			{ realm: 'http://ghcr.io/token', registry: 'containers.example', expected: false },
			{ realm: 'https://registry.azurecr.io/oauth2/token', registry: 'registry.azurecr.io', expected: true },
			{ realm: 'https://registry.azurecr.io/oauth2/token', registry: 'containers.example', expected: true },
			{ realm: 'http://registry.azurecr.io/oauth2/token', registry: 'containers.example', expected: false },
			{ realm: 'https://nested.registry.azurecr.io/oauth2/token', registry: 'nested.registry.azurecr.io', expected: true },
			{ realm: 'https://nested.registry.azurecr.io/oauth2/token', registry: 'containers.example', expected: true },
			{ realm: 'https://azurecr.io/oauth2/token', registry: 'containers.example', expected: false },
			{ realm: 'https://.azurecr.io/oauth2/token', registry: 'containers.example', expected: false },
			{ realm: 'https://registry.azurecr.io.attacker.example/token', registry: 'containers.example', expected: false },
			{ realm: 'https://auth.docker.io.attacker.example/token', registry: 'containers.example', expected: false },
			{ realm: 'https://auth.docker.io:8443/token', registry: 'containers.example', expected: false },
			{ realm: 'http://127.0.0.1/token', registry: 'attacker.example', expected: false },
			{ realm: 'http://169.254.169.254/token', registry: 'attacker.example', expected: false },
		];

		for (const { realm, registry, expected } of cases) {
			it(`${expected ? 'allows' : 'rejects'} '${realm}' for '${registry}'`, () => {
				assert.equal(isAllowedTokenServiceRealm(realm, registry), expected);
			});
		}
	});

	describe('canForwardCredentialToTokenService', () => {
		it('allows Basic and refresh credentials for exact HTTP localhost authority', () => {
			const realm = 'http://localhost:5000/token';
			assert.isTrue(canForwardCredentialToTokenService(realm, 'localhost:5000', 'basic'));
			assert.isTrue(canForwardCredentialToTokenService(realm, 'localhost:5000', 'refreshToken'));
		});

		it('rejects credentials over remote HTTP even for the same authority', () => {
			const realm = 'http://registry.example/token';
			assert.isFalse(canForwardCredentialToTokenService(realm, 'registry.example', 'basic'));
			assert.isFalse(canForwardCredentialToTokenService(realm, 'registry.example', 'refreshToken'));
		});

		it('allows only Basic credentials for the Docker Hub token service', () => {
			const realm = 'https://auth.docker.io/token';
			assert.isTrue(canForwardCredentialToTokenService(realm, 'registry-1.docker.io', 'basic'));
			assert.isFalse(canForwardCredentialToTokenService(realm, 'registry-1.docker.io', 'refreshToken'));
		});

		it('rejects credentials for token services owned by another registry', () => {
			assert.isFalse(canForwardCredentialToTokenService('https://auth.docker.io/token', 'attacker.example', 'basic'));
			assert.isFalse(canForwardCredentialToTokenService('https://ghcr.io/token', 'attacker.example', 'basic'));
			assert.isFalse(canForwardCredentialToTokenService('https://registry.azurecr.io/token', 'attacker.example', 'refreshToken'));
		});
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

			let error: NodeJS.ErrnoException | undefined;
			try {
				await requestEnsureAuthenticated({
					env: { DEVCONTAINERS_OCI_AUTH: `${registry}|user|token` },
					output: nullLog,
				}, {
					type: 'GET',
					url: `http://${registry}/v2/test/features/manifests/latest`,
					headers: {},
				}, ociRef);
			} catch (err) {
				error = err;
			}

			assert.equal(error?.code, 'ERR_FR_TOO_MANY_REDIRECTS');
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

			const result = await requestEnsureAuthenticated({ env: {}, output: nullLog }, {
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