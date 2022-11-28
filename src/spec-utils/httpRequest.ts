/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { RequestOptions } from 'https';
import { https } from 'follow-redirects';
import ProxyAgent from 'proxy-agent';
import * as url from 'url';
import { Log, LogLevel } from './log';

export function request(options: { type: string; url: string; headers: Record<string, string>; data?: Buffer }, output?: Log) {
	return new Promise<Buffer>((resolve, reject) => {
		const parsed = new url.URL(options.url);
		const reqOptions: RequestOptions = {
			hostname: parsed.hostname,
			port: parsed.port,
			path: parsed.pathname + parsed.search,
			method: options.type,
			headers: options.headers,
			agent: new ProxyAgent(),
		};
		const req = https.request(reqOptions, res => {
			if (res.statusCode! < 200 || res.statusCode! > 299) {
				reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
				if (output) {
					output.write(`HTTP request failed with status code ${res.statusCode}: : ${res.statusMessage}`, LogLevel.Error);
				}
			} else {
				res.on('error', reject);
				const chunks: Buffer[] = [];
				res.on('data', chunk => chunks.push(chunk as Buffer));
				res.on('end', () => resolve(Buffer.concat(chunks)));
			}
		});
		req.on('error', reject);
		if (options.data) {
			req.write(options.data);
		}
		req.end();
	});
}

// HTTP HEAD request that returns status code.
export function headRequest(options: { url: string; headers: Record<string, string> }, output?: Log) {
	return new Promise<number>((resolve, reject) => {
		const parsed = new url.URL(options.url);
		const reqOptions: RequestOptions = {
			hostname: parsed.hostname,
			port: parsed.port,
			path: parsed.pathname + parsed.search,
			method: 'HEAD',
			headers: options.headers,
			agent: new ProxyAgent(),
		};
		const req = https.request(reqOptions, res => {
			res.on('error', reject);
			if (output) {
				output.write(`HEAD ${options.url} -> ${res.statusCode}`, LogLevel.Trace);
			}
			resolve(res.statusCode!);
		});
		req.on('error', reject);
		req.end();
	});
}

// Send HTTP Request.
// Does not throw on status code, but rather always returns 'statusCode', 'resHeaders', and 'resBody'.
export function requestResolveHeaders(options: { type: string; url: string; headers: Record<string, string>; data?: Buffer }, _output?: Log) {
	return new Promise<{ statusCode: number; resHeaders: Record<string, string>; resBody: Buffer }>((resolve, reject) => {
		const parsed = new url.URL(options.url);
		const reqOptions: RequestOptions = {
			hostname: parsed.hostname,
			port: parsed.port,
			path: parsed.pathname + parsed.search,
			method: options.type,
			headers: options.headers,
			agent: new ProxyAgent(),
		};
		const req = https.request(reqOptions, res => {
			res.on('error', reject);

			// Resolve response body
			const chunks: Buffer[] = [];
			res.on('data', chunk => chunks.push(chunk as Buffer));
			res.on('end', () => {
				resolve({
					statusCode: res.statusCode!,
					resHeaders: res.headers! as Record<string, string>,
					resBody: Buffer.concat(chunks)
				});
			});
		});

		if (options.data) {
			req.write(options.data);
		}

		req.on('error', reject);
		req.end();
	});
}