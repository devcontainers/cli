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
const packageJson = jsonc.parse(packageJsonText);

const edits = jsonc.modify(packageJsonText, ['dependencies'], {}, {});
const patchedText = jsonc.applyEdits(packageJsonText, edits);
fs.writeFileSync(packageJsonPath, patchedText);
