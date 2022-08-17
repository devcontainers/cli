import { assert } from 'chai';
import path from 'path';
import { getFeatureRef, getPublishedVersions } from '../../spec-configuration/containerFeaturesOCI';
import { getSermanticVersions } from '../../spec-node/featuresCLI/publishCommandImpl';
import { createPlainLog, LogLevel, makeLog } from '../../spec-utils/log';
import { isLocalFile, readLocalFile } from '../../spec-utils/pfs';
import { shellExec } from '../testUtils';
export const output = makeLog(createPlainLog(text => process.stdout.write(text), () => LogLevel.Trace));

const pkg = require('../../../package.json');

describe('CLI features subcommands', async function () {
	this.timeout('120s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp2'));
	const cli = `npx --prefix ${tmp} devcontainer`;

	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`rm -rf ${tmp}/output`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
	});

	it('features test subcommand', async function () {
		const collectionFolder = `${__dirname}/example-v2-features-sets/simple`;
		let success = false;
		try {
			await shellExec(`${cli} features test -c ${collectionFolder} --base-image mcr.microsoft.com/devcontainers/base:ubuntu --log-level trace`);
			success = true;
		} catch (error) {
			assert.fail('features test sub-command should not throw');
		}
		assert.isTrue(success);
	});

	it('features package subcommand by collection', async function () {
		const srcFolder = `${__dirname}/example-v2-features-sets/simple/src`;
		let success = false;
		try {
			await shellExec(`${cli} features package -o ${tmp}/output/test01 -f --log-level trace  ${srcFolder} `);
			success = true;
		} catch (error) {
			assert.fail('features package sub-command should not throw');
		}
		assert.isTrue(success);

		const colorTgzExists = await isLocalFile(`${tmp}/output/test01/devcontainer-feature-color.tgz`);
		assert.isTrue(colorTgzExists);
		const tgzArchiveContentsColor = await shellExec(`tar -tvf ${tmp}/output/test01/devcontainer-feature-color.tgz`);
		assert.match(tgzArchiveContentsColor.stdout, /devcontainer-feature.json/);
		assert.match(tgzArchiveContentsColor.stdout, /install.sh/);

		const helloTgzExists = await isLocalFile(`${tmp}/output/test01/devcontainer-feature-hello.tgz`);
		assert.isTrue(helloTgzExists);
		const tgzArchiveContentsHello = await shellExec(`tar -tvf ${tmp}/output/test01/devcontainer-feature-hello.tgz`);
		assert.match(tgzArchiveContentsHello.stdout, /devcontainer-feature.json/);
		assert.match(tgzArchiveContentsHello.stdout, /install.sh/);

		const collectionFileExists = await isLocalFile(`${tmp}/output/test01/devcontainer-collection.json`);
		const json = JSON.parse((await readLocalFile(`${tmp}/output/test01/devcontainer-collection.json`)).toString());
		assert.strictEqual(json.features.length, 2);
		assert.isTrue(collectionFileExists);
	});

	it('features package subcommand by single feature', async function () {
		const singleFeatureFolder = `${__dirname}/example-v2-features-sets/simple/src/color`;
		let success = false;
		try {
			await shellExec(`${cli} features package -o ${tmp}/output/test02 -f --log-level trace  ${singleFeatureFolder} `);
			success = true;
		} catch (error) {
			assert.fail('features package sub-command should not throw');
		}
		assert.isTrue(success);

		const colorTgzExists = await isLocalFile(`${tmp}/output/test02/devcontainer-feature-color.tgz`);
		assert.isTrue(colorTgzExists);
		const tgzArchiveContentsColor = await shellExec(`tar -tvf ${tmp}/output/test02/devcontainer-feature-color.tgz`);
		assert.match(tgzArchiveContentsColor.stdout, /devcontainer-feature.json/);
		assert.match(tgzArchiveContentsColor.stdout, /install.sh/);

		const collectionFileExists = await isLocalFile(`${tmp}/output/test02/devcontainer-collection.json`);
		assert.isTrue(collectionFileExists);
		const json = JSON.parse((await readLocalFile(`${tmp}/output/test02/devcontainer-collection.json`)).toString());
		assert.strictEqual(json.features.length, 1);
		assert.isTrue(collectionFileExists);
	});
});

describe('test function getSermanticVersions', () => {
	it('should generate correct semantic versions for first publishing', async () => {
		let version = '1.0.0';
		let publishedVersions: string[] = [];
		let expectedSemVer = ['1', '1.0', '1.0.0', 'latest'];

		let semanticVersions = getSermanticVersions(version, publishedVersions, output);
		assert.equal(semanticVersions?.toString(), expectedSemVer.toString());
	});

	it('should generate correct semantic versions for publishing new patch version', async () => {
		let version = '1.0.1';
		let publishedVersions = ['1', '1.0', '1.0.0', 'latest'];
		let expectedSemVer = ['1', '1.0', '1.0.1', 'latest'];

		let semanticVersions = getSermanticVersions(version, publishedVersions, output);
		assert.equal(semanticVersions?.toString(), expectedSemVer.toString());
	});

	it('should generate correct semantic versions for publishing new minor version', async () => {
		let version = '1.1.0';
		let publishedVersions = ['1', '1.0', '1.0.0', '1.0.1', 'latest'];
		let expectedSemVer = ['1', '1.1', '1.1.0', 'latest'];

		let semanticVersions = getSermanticVersions(version, publishedVersions, output);
		assert.equal(semanticVersions?.toString(), expectedSemVer.toString());
	});

	it('should generate correct semantic versions for publishing new major version', async () => {
		let version = '2.0.0';
		let publishedVersions = ['1', '1.0', '1.0.0', 'latest'];
		let expectedSemVer = ['2', '2.0', '2.0.0', 'latest'];

		let semanticVersions = getSermanticVersions(version, publishedVersions, output);
		assert.equal(semanticVersions?.toString(), expectedSemVer.toString());
	});

	it('should generate correct semantic versions for publishing hotfix patch version', async () => {
		let version = '1.0.2';
		let publishedVersions = ['1', '1.0', '1.0.0', '1.0.1', '1.1', '1.1.0', '2', '2.0', '2.0.0', 'latest'];
		let expectedSemVer = ['1.0', '1.0.2'];

		let semanticVersions = getSermanticVersions(version, publishedVersions, output);
		assert.equal(semanticVersions?.toString(), expectedSemVer.toString());
	});

	it('should generate correct semantic versions for publishing hotfix minor version', async () => {
		let version = '1.0.1';
		let publishedVersions = ['1', '1.0', '1.0.0', '2', '2.0', '2.0.0', 'latest'];
		let expectedSemVer = ['1', '1.0', '1.0.1'];

		let semanticVersions = getSermanticVersions(version, publishedVersions, output);
		assert.equal(semanticVersions?.toString(), expectedSemVer.toString());
	});

	it('should return undefined for already published version', async () => {
		let version = '1.0.1';
		let publishedVersions = ['1', '1.0', '1.0.0', '1.0.1', '2', '2.0', '2.0.0', 'latest'];

		let semanticVersions = getSermanticVersions(version, publishedVersions, output);
		assert.isUndefined(semanticVersions);
	});
});

describe('test function getPublishedVersions', async () => {
	it('should list published versions', async () => {
		const resource = 'ghcr.io/devcontainers/features/node';
		const featureRef = getFeatureRef(output, resource);
		const versionsList = await getPublishedVersions(featureRef, output) ?? [];
		assert.includeMembers(versionsList, ['1', '1.0', '1.0.0', 'latest']);
	});
});
