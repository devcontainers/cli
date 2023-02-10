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
			build.onLoad({ filter: /node_modules[\/\\]vm2[\/\\]lib[\/\\]vm.js$/ }, async (args) => {
				const text = await fs.promises.readFile(args.path, 'utf8');
				const regex = /fs\.readFileSync\(`\$\{__dirname\}\/([^`]+)`, 'utf8'\)/g;
				const files = await [...new Set(text.matchAll(regex))]
					.reduce(async (prevP, m) => {
						const text = (await fs.promises.readFile(path.join(path.dirname(args.path), m[1]), 'utf8'));
						const prev = await prevP;
						prev[m[1]] = text;
						return prev;
					}, Promise.resolve({}));
				const contents = text.replace(regex, (_sub, file) => {
					return `\`${files[file].replace(/[`$]/g, '\\$&')}\``;
				});
				return {
					contents,
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
		target: 'node14.17.0',
		external: ['vscode-dev-containers'],
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
