/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const jsonc = require('jsonc-parser');
const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJsonText = fs.readFileSync(packageJsonPath, 'utf8');

let patchedText = packageJsonText;
for (const key of ['dependencies', 'devDependencies']) {
	const edits = jsonc.modify(patchedText, [key], {}, {});
	patchedText = jsonc.applyEdits(patchedText, edits);
}

fs.writeFileSync(packageJsonPath, patchedText);
