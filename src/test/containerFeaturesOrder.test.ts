/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ContainerError } from '../spec-common/errors';
import { Feature } from '../spec-configuration/containerFeaturesConfiguration';
import { computeInstallationOrder } from '../spec-node/containerFeaturesOrder';

describe.only('Container features install order', () => {

	it('has stable order among independent features', () => {
		assert.deepEqual(
			computeInstallationOrder([
				installAfter('C'),
				installAfter('A'),
				installAfter('B'),
			]).map(f => f.id),
			['A', 'B', 'C']
		);
	});

	it('orders "installAfter" first in breadth-first order (tree)', () => {
		assert.deepEqual(
			computeInstallationOrder([
				installAfter('A', 'B'),
				installAfter('B', 'C'),
				installAfter('C'),
				installAfter('D', 'E'),
				installAfter('E', 'C'),
			]).map(f => f.id),
			['C', 'B', 'E', 'A', 'D']
		);
	});

	it('orders "installAfter" first in breadth-first order (DAG)', () => {
		assert.deepEqual(
			computeInstallationOrder([
				installAfter('A', 'B', 'C'),
				installAfter('B', 'C'),
				installAfter('C'),
				installAfter('D', 'C'),
			]).map(f => f.id),
			['C', 'B', 'D', 'A']
		);
	});

	it('treats "installAfter" is a soft dependency', () => {
		assert.deepEqual(
			computeInstallationOrder([
				installAfter('A', 'B', 'C'),
				installAfter('B'),
			]).map(f => f.id),
			['B', 'A']
		);
	});

	it('orders independent features last', () => {
		assert.deepEqual(
			computeInstallationOrder([
				installAfter('A'),
				installAfter('B', 'C'),
				installAfter('C'),
			]).map(f => f.id),
			['C', 'B', 'A']
		);
	});

	it('detects cycles', () => {
		try {
			computeInstallationOrder([
				installAfter('A', 'B'),
				installAfter('B'),
				installAfter('C', 'D'),
				installAfter('D', 'C'),
			]);
			assert.fail('Cyclic dependency not detected.');
		} catch (err) {
			assert.ok(err instanceof ContainerError);
			assert.ok(err.message.indexOf('cyclic'));
		}
	});

	function installAfter(id: string, ...installAfter: string[]): Feature {
		return {
			id,
			name: id,
			installAfter,
			value: true,
			included: true,
		};
	}
});
