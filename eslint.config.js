/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const typescriptParser = require('@typescript-eslint/parser');
const typescriptPlugin = require('@typescript-eslint/eslint-plugin');
const stylisticPlugin = require('@stylistic/eslint-plugin');

module.exports = [
	{
		ignores: ['**/node_modules/**'],
	},
	{
		files: ['src/**/*.ts'],
		languageOptions: {
			parser: typescriptParser,
			sourceType: 'module',
		},
		plugins: {
			'@typescript-eslint': typescriptPlugin,
			'@stylistic': stylisticPlugin,
		},
		rules: {
			'@stylistic/member-delimiter-style': [
				'warn',
				{
					multiline: {
						delimiter: 'semi',
						requireLast: true,
					},
					singleline: {
						delimiter: 'semi',
						requireLast: false,
					},
				},
			],
			'semi': ['warn', 'always'],
			'constructor-super': 'warn',
			'curly': 'warn',
			'eqeqeq': ['warn', 'always'],
			'no-async-promise-executor': 'warn',
			'no-buffer-constructor': 'warn',
			'no-caller': 'warn',
			'no-debugger': 'warn',
			'no-duplicate-case': 'warn',
			'no-duplicate-imports': 'warn',
			'no-eval': 'warn',
			'no-extra-semi': 'warn',
			'no-new-wrappers': 'warn',
			'no-redeclare': 'off',
			'no-sparse-arrays': 'warn',
			'no-throw-literal': 'warn',
			'no-unsafe-finally': 'warn',
			'no-unused-labels': 'warn',
			'@typescript-eslint/no-redeclare': 'warn',
			'no-var': 'warn',
			'no-unused-expressions': ['warn', { allowTernary: true }],
		},
	},
];
