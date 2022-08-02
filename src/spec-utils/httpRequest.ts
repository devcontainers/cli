/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { https } from 'follow-redirects';
import * as url from 'url';
import { Log, LogLevel } from './log';

export function request(options: { type: string; url: string; headers: Record<string, string>; data?: Buffer }, output?: Log) {
	return new Promise<Buffer>((resolve, reject) => {
		const parsed = new url.URL(options.url);
		const reqOptions = {
			hostname: parsed.hostname,
			port: parsed.port,
			path: parsed.pathname + parsed.search,
			method: options.type,
			headers: options.headers,
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