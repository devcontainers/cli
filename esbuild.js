/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const uri = require('vscode-uri');

const minify = process.argv.indexOf('--production') !== -1;
const watch = process.argv.indexOf('--watch') !== -1;

(async () => {

	/** @type esbuild.Plugin */
	const plugin = {
		name: 'patch up',
		setup(build) {
			build.onLoad({ filter: /node_modules[\/\\]yargs[\/\\]lib[\/\\]platform-shims[\/\\]esm\.mjs$/ }, async (args) => {
				let text = await fs.promises.readFile(args.path, 'utf8');
				let fileUri = uri.URI.file(args.path);
				fileUri = fileUri.with({
					path: path.posix.join('/C:', fileUri.path)
				});
				return {
					contents: text.replace(/import\.meta\.url/g, `'${fileUri.toString()}'`),
					loader: 'js',
				};
			});
		},
	};

	/** @type {import('esbuild').BuildOptions} */
	const options = {
		bundle: true,
		sourcemap: true,
		minify,
		watch,
		platform: 'node',
		target: 'node12.18.3',
		external: ['vscode', 'vscode-dev-containers'],
		mainFields: ['module', 'main'],
		outdir: 'dist',
		plugins: [plugin],
		banner: {
			js: `
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
`.trimStart()
		},
	};

	await esbuild.build({
		...options,
		entryPoints: [
			'./src/spec-node/devContainersSpecCLI.ts',
		],
		tsconfig: 'tsconfig.json',
		outbase: 'src',
	});

})().catch(() => process.exit(1));
