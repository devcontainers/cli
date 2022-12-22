import { request, requestResolveHeaders } from '../spec-utils/httpRequest';
import { Log, LogLevel } from '../spec-utils/log';
import { CommonParams } from './containerCollectionsOCI';

export type HEADERS = { 'authorization'?: string; 'user-agent': string; 'content-type'?: string; 'accept'?: string; 'content-length'?: string };

// https://docs.docker.com/registry/spec/auth/token/#how-to-authenticate
export async function requestEnsureAuthenticated(params: CommonParams, registry: string, ociRepoPath: string, httpOptions: { type: string; url: string; headers: HEADERS; data?: Buffer }, existingAuthHeader?: string) {
	const { output } = params;

	if (existingAuthHeader) {
		httpOptions.headers.authorization = existingAuthHeader;
	}

	const responseAttempt = await requestResolveHeaders(httpOptions, output);

	// Per the specification, on 401 retry the request after 
	// fetching a Bearer token for the appropriate realm provided at the 'WWW-Authenticate' header.
	if (responseAttempt.statusCode === 401) {
		const wwwAuthenticate = responseAttempt.resHeaders['www-authenticate'];
		if (wwwAuthenticate) {
			// Www-Authenticate: Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:samalba/my-app:pull,push"
			const wwwAuthenticateParts = wwwAuthenticate.split(' ');
			if (wwwAuthenticateParts[0] === 'Bearer') {
				const realm = wwwAuthenticateParts[1].split('=')[1];
				const service = wwwAuthenticateParts[2].split('=')[1];
				const scope = wwwAuthenticateParts[3].split('=')[1];
				const bearerToken = await fetchRegistryBearerToken(params, ociRepoPath, realm, service, scope);
				if (bearerToken) {
					httpOptions.headers.authorization = `Bearer ${bearerToken}`;
					const responseWithBearerToken = await requestResolveHeaders(httpOptions, output);
					if (responseWithBearerToken.statusCode === 401) {
						// Provided token was not valid.
						return;
					}
					return {
						response: responseWithBearerToken,
						authHeader: `Bearer ${bearerToken}`, // Cache token for use in future requests.
					};
				}
			}
		}
		// Fall back attempting the request with Basic auth.
		const basicAuthCredential = await getBasicAuthCredential(params, registry, ociRepoPath);
		if (basicAuthCredential) {
			httpOptions.headers.authorization = `Basic ${basicAuthCredential}`;
			const responseWithBasicAuth = await requestResolveHeaders(httpOptions, output);
			if (responseWithBasicAuth.statusCode === 401) {
				// Provided token was not valid.
				return;
			}
			return {
				response: responseWithBasicAuth,
				authHeader: `Basic ${basicAuthCredential}`, // Cache token for use in future requests.
			};
		}
	} else {
		// Return the original response.
		return {
			response: responseAttempt,
			authHeader: existingAuthHeader, // Cache token for use in future requests.
		};
	}

	// Failure to authenticate after a 401.
	// Likely, the registry does not support WWW-Authenticate challenges.
	return;
}


// Attempts to get the Basic auth credentials for the provided registry.
// These may be programatically crafted via environment variables (GITHUB_TOKEN),
// parsed out of a special DEVCONTAINERS_OCI_AUTH environment variable,
// TODO: or directly read out of the local docker config file/credential helper.
async function getBasicAuthCredential(params: CommonParams, realm: string, service: string): Promise<string | undefined> {
	const { output, env } = params;

	let userToken: string | undefined = undefined;
	if (!!env['GITHUB_TOKEN'] && service === 'ghcr.io' && realm.startsWith('https://ghcr.io/')) {
		output.write('Using environment GITHUB_TOKEN for auth', LogLevel.Trace);
		userToken = `USERNAME:${env['GITHUB_TOKEN']}`;
	} else if (!!env['DEVCONTAINERS_OCI_AUTH']) {
		// eg: DEVCONTAINERS_OCI_AUTH=realm1|user1|token1,realm2|user2|token2
		const authContexts = env['DEVCONTAINERS_OCI_AUTH'].split(',');
		const authContext = authContexts.find(a => a.split('|')[0] === service);

		if (authContext) {
			output.write(`Using match from DEVCONTAINERS_OCI_AUTH for realm '${service}'`, LogLevel.Trace);
			const split = authContext.split('|');
			userToken = `${split[1]}:${split[2]}`;
		}
	}

	if (userToken) {
		return Buffer.from(userToken).toString('base64');
	}

	// Represents anonymous access.
	output.write(`No authentication credentials found for realm '${realm}'.`, LogLevel.Warning);
	return undefined;
}

// https://docs.docker.com/registry/spec/auth/token/#requesting-a-token
async function fetchRegistryBearerToken(params: CommonParams, ociRepoPath: string, realm: string, service: string, operationScopes: string): Promise<string | undefined> {
	const { output } = params;

	// TODO: Remove this.
	if (realm.includes('mcr.microsoft.com')) {
		return undefined;
	}

	const headers: HEADERS = {
		'user-agent': 'devcontainer'
	};

	// The token server should first attempt to authenticate the client using any authentication credentials provided with the request.
	// From Docker 1.11 the Docker engine supports both Basic Authentication and OAuth2 for getting tokens. 
	// Docker 1.10 and before, the registry client in the Docker Engine only supports Basic Authentication. 
	// If an attempt to authenticate to the token server fails, the token server should return a 401 Unauthorized response 
	// indicating that the provided credentials are invalid.
	// > https://docs.docker.com/registry/spec/auth/token/#requesting-a-token
	const basicAuthTokenBase64 = await getBasicAuthCredential(params, realm, service);
	if (basicAuthTokenBase64) {
		headers['authorization'] = `Basic ${basicAuthTokenBase64}`;
	}

	// realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:samalba/my-app:pull,push"
	// https://auth.docker.io/token?service=registry.docker.io&scope=repository:samalba/my-app:pull,push
	const url = `${realm}?service=${service}&scope=repository:${ociRepoPath}:${operationScopes}`;
	output.write(`Fetching scope token from: ${url}`, LogLevel.Trace);

	const options = {
		type: 'GET',
		url: url,
		headers: headers
	};

	let authReq: Buffer;
	try {
		authReq = await request(options, output);
	} catch (e: any) {
		// This is ok if the registry is trying to speak Basic Auth with us.
		output.write(`Not used a scoped token for ${service}: ${e}`, LogLevel.Trace);
		return;
	}

	if (!authReq) {
		output.write('Failed to get registry auth token', LogLevel.Error);
		return undefined;
	}

	let scopeToken: string | undefined;
	try {
		scopeToken = JSON.parse(authReq.toString())?.token;
	} catch {
		// not JSON
	}
	if (!scopeToken) {
		output.write('Failed to parse registry auth token response', LogLevel.Error);
		return undefined;
	}
	return scopeToken;
}