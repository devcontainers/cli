import { assert } from 'chai';
import { before } from 'mocha';
import tar from 'tar';
import path from 'path';
import { FeaturesPackageCommandInput } from '..//../src/spec-node/featuresCLI/package';
import { DevContainerCollectionMetadata, doFeaturesPackageCommand } from '../../src/spec-node/featuresCLI/packageCommandImpl';
import { getCLIHost } from '../spec-common/cliHost';
import { loadNativeModule } from '..//spec-common/commonUtils';
import { createLog } from '../spec-node/devContainers';
import { getPackageConfig } from '../spec-node/utils';
import { Log, mapLogLevel } from '..//spec-utils/log';
import { isLocalFile, mkdirpLocal, readLocalFile, rmLocal } from '../spec-utils/pfs';
import { getSermanticVersions } from '../spec-node/featuresCLI/publishCommandImpl';

describe('features package command', () => {

    const disposables: (() => Promise<unknown> | undefined)[] = [];
    const dispose = async () => {
        await Promise.all(disposables.map(d => d()));
    };

    const srcFolder = `${__dirname}/featuresCLICommands/example-source-repo/src`;
    console.log(srcFolder);
    const outputDir = `${__dirname}/featuresCLICommands/example-source-repo/output`;
    console.log(outputDir);

    // Package
    before(async () => {

        await rmLocal(outputDir, { recursive: true, force: true });
        await mkdirpLocal(outputDir);

        const extensionPath = path.join(__dirname, '..', '..');
        const pkg = await getPackageConfig(extensionPath);

        const cwd = process.cwd();
        const cliHost = await getCLIHost(cwd, loadNativeModule);
        const output = createLog({
            logLevel: mapLogLevel('trace'),
            logFormat: 'text',
            log: (str) => process.stdout.write(str),
            terminalDimensions: undefined,
        }, pkg, new Date(), disposables);

        const args: FeaturesPackageCommandInput = {
            cliHost,
            srcFolder,
            outputDir,
            output,
            disposables,
        };

        await doFeaturesPackageCommand(args);

    });

    after(async () => {
        await rmLocal(outputDir, { recursive: true, force: true });
        await dispose();
    });

    it('should generate tgzs', async () => {
        const featureAExists = await isLocalFile(`${outputDir}/devcontainer-feature-featureA.tgz`);
        const featureBExists = await isLocalFile(`${outputDir}/devcontainer-feature-featureB.tgz`);
        const featureCExists = await isLocalFile(`${outputDir}/devcontainer-feature-featureC.tgz`);
        assert.isTrue(featureAExists);
        assert.isTrue(featureBExists);
        assert.isTrue(featureCExists);
    });

    it('should have a valid collection metadata file', async () => {
        const collectionMetadataFileExists = await isLocalFile(`${outputDir}/devcontainer-collection.json`);
        assert.isTrue(collectionMetadataFileExists);

        const collectionMetadataFile = await readLocalFile(`${outputDir}/devcontainer-collection.json`, 'utf8');
        const collectionMetadata: DevContainerCollectionMetadata = JSON.parse(collectionMetadataFile);
        assert.equal(collectionMetadata.features.length, 3);
        assert.strictEqual(collectionMetadata.features.find(x => x.id === 'featureA')?.name, 'Feature A');
    });

    it('should have non-empty tgz files', async () => {
        const tgzPath = `${outputDir}/devcontainer-feature-featureC.tgz`;

        await tar.x(
            {
                file: tgzPath,
                cwd: outputDir,
            }
        );

        const installShExists = await isLocalFile(`${outputDir}/install.sh`);
        assert.isTrue(installShExists);
        const jsonExists = await isLocalFile(`${outputDir}/devcontainer-feature.json`);
        assert.isTrue(jsonExists);
        const otherfileExists = await isLocalFile(`${outputDir}/other-file.md`);
        assert.isTrue(otherfileExists);
        const otherFileContents = await readLocalFile(`${outputDir}/other-file.md`, 'utf8');
        assert.strictEqual(otherFileContents, 'hello there');
    });
});

describe('features publish command', () => {
    let output: Log;
    const disposables: (() => Promise<unknown> | undefined)[] = [];
    const dispose = async () => {
        await Promise.all(disposables.map(d => d()));
    };

    before(async () => {

        const extensionPath = path.join(__dirname, '..', '..');
        const pkg = await getPackageConfig(extensionPath);

        output = createLog({
            logLevel: mapLogLevel('trace'),
            logFormat: 'text',
            log: (str) => process.stdout.write(str),
            terminalDimensions: undefined,
        }, pkg, new Date(), disposables, true);
    });

    it('should generate correct semantic versions', async () => {
        // First publish
        let version = '1.0.0';
        let publishedVersions: string[] = [];
        let expectedSemVer = ['1', '1.0', '1.0.0', 'latest'];

        let semanticVersions = getSermanticVersions(version, publishedVersions, output);
        assert.equal(semanticVersions?.toString(), expectedSemVer.toString());

        // Publish new major version
        version = '2.0.0';
        publishedVersions = ['1', '1.0', '1.0.0', 'latest'];
        expectedSemVer = ['2', '2.0', '2.0.0', 'latest'];

        semanticVersions = getSermanticVersions(version, publishedVersions, output);
        assert.equal(semanticVersions?.toString(), expectedSemVer.toString());

        // Publish hotfix version
        version = '1.0.1';
        publishedVersions = ['1', '1.0', '1.0.0', '2', '2.0', '2.0.0', 'latest'];
        expectedSemVer = ['1', '1.0', '1.0.1'];

        semanticVersions = getSermanticVersions(version, publishedVersions, output);
        assert.equal(semanticVersions?.toString(), expectedSemVer.toString());

        // Re-publish version
        version = '1.0.1';
        publishedVersions = ['1', '1.0', '1.0.0', '1.0.1', '2', '2.0', '2.0.0', 'latest'];

        semanticVersions = getSermanticVersions(version, publishedVersions, output);
        assert.isUndefined(semanticVersions);
    });

    after(async () => {
        await dispose();
    });
});
