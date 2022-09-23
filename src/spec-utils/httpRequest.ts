/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fetch, { FetchOptions } from 'make-fetch-happen';
import { Log, LogLevel } from './log';

interface RequestOptions {
	type: string;
	url: string;
	headers: Record<string, string>;
	data?: Buffer;
}

export async function request(options: RequestOptions, output?: Log): Promise<Buffer> {
	const fetchOptions: FetchOptions = {
		method: options.type,
		headers: options.headers,
		body: options.data,
		cache: 'no-store',
	};
	const res = await fetch(options.url, fetchOptions);
	if (!res.ok) {
		if (output) {
			output.write(
				`HTTP request failed with status code ${res.status}: : ${res.statusText}`,
				LogLevel.Error
			);
		}
		throw new Error(`HTTP ${res.status}: ${res.statusText}`);
	}
	return Buffer.from(await res.arrayBuffer());
}

// HTTP HEAD request that returns status code.
export async function headRequest(options: Pick<RequestOptions, 'url' | 'headers'>, output?: Log): Promise<number> {
	const fetchOptions: FetchOptions = {
		method: 'HEAD',
		headers: options.headers,
		cache: 'no-store',
	};
	const res = await fetch(options.url, fetchOptions);
	if (output) {
		output.write(`HEAD ${options.url} -> ${res.status}`, LogLevel.Trace);
	}
	return res.status;
}

interface StatusHeaders {
	statusCode: number;
	resHeaders: Record<string, string>;
}

// Send HTTP Request.  Does not throw on status code, but rather always returns 'statusCode' and 'resHeaders'.
export async function requestResolveHeaders(options: RequestOptions, _output?: Log): Promise<StatusHeaders> {
	const fetchOptions: FetchOptions = {
		method: options.type,
		headers: options.headers,
		body: options.data,
		cache: 'no-store',
	};
	const res = await fetch(options.url, fetchOptions);
	const resHeaders = Object.fromEntries(res.headers.entries());
	return { statusCode: res.status, resHeaders };
}
