/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from 'http';
import * as https from 'https';

export function httpGet(url: string, headers: {} = {}) {
	return new Promise<Buffer>((resolve, reject) => {
		const httpx = url.startsWith('https:') ? https : http;

		let requestOptions: https.RequestOptions | undefined = undefined;
		if (Object.keys(headers).length > 0) {
			const parsedUrl = new URL(url);
			requestOptions = {
				'headers': headers,
				'host': parsedUrl.host,
				'path': parsedUrl.pathname,
			};
		}

		const req = httpx.get(requestOptions ?? url, res => {
			if (res.statusCode! < 200 || res.statusCode! > 299) {

				// Redirect
				if (res.statusCode! === 302) {
					const location = res.headers?.location;
					if (location) {
						resolve(httpGet(location, headers));
					}
				}
				reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
			} else {
				res.on('error', reject);
				const chunks: Buffer[] = [];
				res.on('data', chunk => chunks.push(chunk));
				res.on('end', () => resolve(Buffer.concat(chunks)));
			}
		});
		req.on('error', reject);
	});
}
