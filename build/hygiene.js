/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const filter = require('gulp-filter');
const es = require('event-stream');
const tsfmt = require('typescript-formatter');
const gulpeslint = require('gulp-eslint');
const VinylFile = require('vinyl');
const vfs = require('vinyl-fs');
const path = require('path');
const fs = require('fs');
const pall = require('p-all');

/**
 * Hygiene works by creating cascading subsets of all our files and
 * passing them through a sequence of checks. Here are the current subsets,
 * named according to the checks performed on them. Each subset contains
 * the following one, as described in mathematical notation:
 *
 * all ⊃ eol ⊇ indentation ⊃ copyright ⊃ typescript
 */

const all = [
	'*',
	'build/**/*',
	'scripts/**/*',
	'src/**/*',
	'!**/node_modules/**'
];

const indentationFilter = [
	'**',

	// except specific files
	'!ThirdPartyNotices.txt',
	'!LICENSE.{txt,rtf}',
	'!LICENSES.chromium.html',
	'!**/LICENSE',

	// except multiple specific files
	'!**/package.json',
	'!**/yarn.lock',
	'!**/yarn-error.log',
	'!**/*.tgz',

	// except specific file types
	'!src/vs/*/**/*.d.ts',
	'!**/typings/**/*.d.ts',
	'!extensions/**/*.d.ts',
	'!**/*.{svg,exe,png,bmp,scpt,bat,cmd,cur,ttf,woff,eot,md,ps1,template,yaml,yml,d.ts.recipe,ico,icns}',
	'!build/{lib,download}/**/*.js',
	'!build/**/*.sh',
	'!build/azure-pipelines/**/*.js',
	'!build/azure-pipelines/**/*.config',
	'!**/Dockerfile',
	'!**/Dockerfile.*',
	'!**/*.Dockerfile',
	'!**/*.dockerfile',
];

const copyrightFilter = [
	'**',
	'!**/*.desktop',
	'!**/*.json',
	'!**/*.html',
	'!**/*.template',
	'!**/*.md',
	'!**/*.bat',
	'!**/*.cmd',
	'!**/*.ico',
	'!**/*.icns',
	'!**/*.xml',
	'!**/*.sh',
	'!**/*.tgz',
	'!**/*.txt',
	'!**/*.xpm',
	'!**/*.opts',
	'!**/*.disabled',
	'!**/*.code-workspace',
	'!build/**/*.init',
	'!src/async.ts',
	'!**/typings/**.*'
];

const tsHygieneFilter = [
	'src/**/*.ts',
	'test/**/*.ts',
	'!**/fixtures/**',
	'!**/typings/**',
	'!**/node_modules/**',
];

const copyrightHeaderLines = [
	'/*---------------------------------------------------------------------------------------------',
	' *  Copyright (c) Microsoft Corporation. All rights reserved.',
	' *--------------------------------------------------------------------------------------------*/'
];

function hygiene(some) {
	let errorCount = 0;

	const indentation = es.through(function (file) {
		const lines = file.contents.toString('utf8').split(/\r\n|\r|\n/);
		file.__lines = lines;

		lines
			.forEach((line, i) => {
				if (/^\s*$/.test(line)) {
					// empty or whitespace lines are OK
				} else if (/^[\t]*[^\s]/.test(line)) {
					// good indent
				} else if (/^[\t]* \*/.test(line)) {
					// block comment using an extra space
				} else {
					console.error(file.relative + '(' + (i + 1) + ',1): Bad whitespace indentation');
					errorCount++;
				}
			});

		this.emit('data', file);
	});

	const copyrights = es.through(function (file) {
		const lines = file.__lines;

		for (let i = 0; i < copyrightHeaderLines.length; i++) {
			if (lines[i] !== copyrightHeaderLines[i]) {
				console.error(file.relative + ': Missing or bad copyright statement');
				errorCount++;
				break;
			}
		}

		this.emit('data', file);
	});

	const formatting = es.map(function (file, cb) {
		tsfmt.processString(file.path, file.contents.toString('utf8'), {
			verify: false,
			tsfmt: true,
			// verbose: true,
			// keep checkJS happy
			editorconfig: undefined,
			replace: undefined,
			tsconfig: undefined,
			tsconfigFile: undefined,
			tsfmtFile: undefined,
			vscode: undefined,
			vscodeFile: undefined
		}).then(result => {
			let original = result.src.replace(/\r\n/gm, '\n');
			let formatted = result.dest.replace(/\r\n/gm, '\n');

			if (original !== formatted) {
				console.error(`File not formatted. Run the 'Format Document' command to fix it:`, file.relative);
				errorCount++;
			}
			cb(null, file);

		}, err => {
			cb(err);
		});
	});

	let input;

	if (Array.isArray(some) || typeof some === 'string' || !some) {
		input = vfs.src(some || all, { base: '.', follow: true, allowEmpty: true });
	} else {
		input = some;
	}

	const result = input
		.pipe(filter(f => !f.stat.isDirectory()))
		.pipe(filter(indentationFilter))
		.pipe(indentation)
		.pipe(filter(copyrightFilter))
		.pipe(copyrights)
		.pipe(filter(tsHygieneFilter))
		.pipe(formatting)
		.pipe(gulpeslint({
			configFile: '.eslintrc.js',
			rulePaths: ['./build/eslint']
		}))
		.pipe(gulpeslint.formatEach('compact'))
		.pipe(gulpeslint.result(result => {
			errorCount += result.warningCount;
			errorCount += result.errorCount;
		}));

	let count = 0;
	return result
		.pipe(es.through(function (data) {
			count++;
			if (process.env['TRAVIS'] && count % 10 === 0) {
				process.stdout.write('.');
			}
			this.emit('data', data);
		}, function () {
			process.stdout.write('\n');
			if (errorCount > 0) {
				this.emit('error', 'Hygiene failed with ' + errorCount + ' errors. Check \'build/gulpfile.hygiene.js\'.');
			} else {
				this.emit('end');
			}
		}));
}

function createGitIndexVinyls(paths) {
	const cp = require('child_process');
	const repositoryPath = process.cwd();

	const fns = paths.map(relativePath => () => new Promise((c, e) => {
		const fullPath = path.join(repositoryPath, relativePath);

		fs.stat(fullPath, (err, stat) => {
			if (err && err.code === 'ENOENT') { // ignore deletions
				return c(null);
			} else if (err) {
				return e(err);
			}

			cp.exec(`git show :${relativePath}`, { maxBuffer: 2000 * 1024, encoding: 'buffer' }, (err, out) => {
				if (err) {
					return e(err);
				}

				c(new VinylFile({
					path: fullPath,
					base: repositoryPath,
					contents: out,
					stat
				}));
			});
		});
	}));

	return pall(fns, { concurrency: 4 })
		.then(r => r.filter(p => !!p));
}

// this allows us to run hygiene as a git pre-commit hook
if (require.main === module) {
	const cp = require('child_process');

	process.on('unhandledRejection', (reason, p) => {
		console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
		process.exit(1);
	});

	if (process.argv.length > 2) {
		hygiene(process.argv.slice(2)).on('error', err => {
			console.error();
			console.error(err);
			process.exit(1);
		});
	} else {
		cp.exec('git diff --cached --name-only', { maxBuffer: 2000 * 1024 }, (err, out) => {
			if (err) {
				console.error();
				console.error(err);
				process.exit(1);
				return;
			}

			const some = out
				.split(/\r?\n/)
				.filter(l => !!l);

			if (some.length > 0) {
				console.log('Reading git index versions...');

				createGitIndexVinyls(some)
					.then(vinyls => new Promise((c, e) => hygiene(es.readArray(vinyls))
						.on('end', () => c())
						.on('error', e)))
					.catch(err => {
						console.error();
						console.error(err);
						process.exit(1);
					});
			}
		});
	}
}
