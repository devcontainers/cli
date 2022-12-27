import { request, requestResolveHeaders } from '../spec-utils/httpRequest';
import { LogLevel } from '../spec-utils/log';
import { CommonParams, OCICollectionRef, OCIRef } from './containerCollectionsOCI';

export type HEADERS = { 'authorization'?: string; 'user-agent'?: string; 'content-type'?: string; 'accept'?: string; 'content-length'?: string };

// https://docs.docker.com/registry/spec/auth/token/#how-to-authenticate
export async function requestEnsureAuthenticated(params: CommonParams, httpOptions: { type: string; url: string; headers: HEADERS; data?: Buffer }, ociRef: OCIRef | OCICollectionRef, existingAuthHeader?: string) {
	const { output } = params;
	const { registry, path } = ociRef;

	// -- Update headers
	httpOptions.headers['user-agent'] = 'devcontainer';
	// If the user has a cached auth token, attempt to use that first.
	if (existingAuthHeader) {
		httpOptions.headers.authorization = existingAuthHeader;
	}

	const responseAttempt = await requestResolveHeaders(httpOptions, output);

	// For anything except a 401 response
	// Simply return the original response to the caller.
	if (responseAttempt.statusCode !== 401) {
		return {
			response: responseAttempt,
			authHeader: existingAuthHeader, // Let caller cache token for use in future requests.
		};
	}

	// -- 'responseAttempt' status code was 401 at this point.

	// Attempt to authenticate via WWW-Authenticate Header.
	const wwwAuthenticate = responseAttempt.resHeaders['WWW-Authenticate'] || responseAttempt.resHeaders['www-authenticate'];
	if (wwwAuthenticate) {
		output.write('Attempting to authenticate via WWW-Athenticate header.', LogLevel.Trace);

		// Www-Authenticate: Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:samalba/my-app:pull,push"
		const wwwAuthenticateParts = wwwAuthenticate.split(' ');
		if (wwwAuthenticateParts[0] === 'Bearer') {
			const wwwAuthenticateData = {
				realm: wwwAuthenticateParts[1].split('=')[1],
				service: wwwAuthenticateParts[2].split('=')[1],
				operationScopes: wwwAuthenticateParts[3].split('=')[1],
			};
			const bearerToken = await fetchRegistryBearerToken(params, path, wwwAuthenticateData);
			if (bearerToken) {
				httpOptions.headers.authorization = `Bearer ${bearerToken}`;
				const responseWithBearerToken = await requestResolveHeaders(httpOptions, output);
				if (responseWithBearerToken.statusCode === 401) {
					// Provided token was not valid.
					output.write('401 while attempting to authenticate via WWW-Athenticate header.', LogLevel.Trace);
					return;
				}
				return {
					response: responseWithBearerToken,
					authHeader: `Bearer ${bearerToken}`, // Let caller cache token for use in future requests.
				};
			}
		}
	}

	// No WWW-Authenticate Header + 401 from server.
	// Fall back attempting the request with Basic auth.
	const basicAuthCredential = await getBasicAuthCredential(params, registry, path);
	if (basicAuthCredential) {
		output.write('Attempting to authenticate with Basic Auth Credentials', LogLevel.Trace);

		httpOptions.headers.authorization = `Basic ${basicAuthCredential}`;
		const responseWithBasicAuth = await requestResolveHeaders(httpOptions, output);
		if (responseWithBasicAuth.statusCode === 401) {
			// Provided token was not valid.
			output.write('401 while attempting to with Basic Auth credentials.', LogLevel.Trace);
			return;
		}
		return {
			response: responseWithBasicAuth,
			authHeader: `Basic ${basicAuthCredential}`, // Let caller cache token for use in future requests.
		};
	}

	// Reauthenticating failed
	output.write('Failed to send an authenticated request to registry.', LogLevel.Trace);
	return;
}

// Attempts to get the Basic auth credentials for the provided registry.
// These may be programatically crafted via environment variables (GITHUB_TOKEN),
// parsed out of a special DEVCONTAINERS_OCI_AUTH environment variable,
async function getBasicAuthCredential(params: CommonParams, realm: string, service: string): Promise<string | undefined> {
	const { output, env } = params;

	// TODO: Directly read out of the local docker config file/credential helper.

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
	output.write(`No authentication credentials found for realm '${realm}'.`, LogLevel.Trace);
	return undefined;
}

// https://docs.docker.com/registry/spec/auth/token/#requesting-a-token
async function fetchRegistryBearerToken(params: CommonParams, ociRepoPath: string, wwwAuthenticateData: { realm: string; service: string; operationScopes: string }): Promise<string | undefined> {
	const { output } = params;
	const { realm, service, operationScopes } = wwwAuthenticateData;

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

	// realm="https://auth.docker.io/token"
	// service="registry.docker.io"
	// scope="repository:samalba/my-app:pull,push"
	// Example:
	// https://auth.docker.io/token?service=registry.docker.io&scope=repository:samalba/my-app:pull,push
	const url = `${realm}?service=${service}&scope=repository:${ociRepoPath}:${operationScopes}`;
	output.write(`Attempting to fetch bearer token from:  ${url}`, LogLevel.Trace);

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
		output.write(`Could not fetch bearer token for '${service}': ${e}`, LogLevel.Error);
		return;
	}

	if (!authReq) {
		output.write(`Did not receive bearer token for '${service}'`, LogLevel.Error);
		return;
	}

	let scopeToken: string | undefined;
	try {
		scopeToken = JSON.parse(authReq.toString())?.token;
	} catch {
		// not JSON
	}
	if (!scopeToken) {
		output.write(`Unexpected bearer token response format for '${service}'`, LogLevel.Error);
		return;
	}

	return scopeToken;
}