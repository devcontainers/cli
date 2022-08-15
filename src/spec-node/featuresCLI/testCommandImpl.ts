import path from 'path';
import chalk from 'chalk';
import { tmpdir } from 'os';
import { CLIHost } from '../../spec-common/cliHost';
import { launch, ProvisionOptions, createDockerParams } from '../devContainers';
import { doExec } from '../devContainersSpecCLI';
import { LaunchResult, staticExecParams, staticProvisionParams, testLibraryScript } from './utils';
import { DockerResolverParameters } from '../utils';
import { DevContainerConfig } from '../../spec-configuration/configuration';
import { FeaturesTestCommandInput } from './test';

const TEST_LIBRARY_SCRIPT_NAME = 'dev-container-features-test-lib';

function fail(msg: string) {
	log(msg, { prefix: '[-]', stderr: true });
	process.exit(1);
}

type Scenarios = { [key: string]: DevContainerConfig };
type TestResult = { testName: string; result: boolean };

function log(msg: string, options?: { omitPrefix?: boolean; prefix?: string; info?: boolean; stderr?: boolean }) {

	const prefix = options?.prefix || '> ';
	const output = `${options?.omitPrefix ? '' : `${prefix} `}${msg}\n`;

	if (options?.stderr) {
		process.stderr.write(chalk.red(output));
	} else if (options?.info) {
		process.stdout.write(chalk.bold.blue(output));
	} else {
		process.stdout.write(chalk.blue(output));
	}
}

export async function doFeaturesTestCommand(args: FeaturesTestCommandInput): Promise<number> {
	const { pkg } = args;

	process.stdout.write(`
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
|    dev container 'features' |   
│           v${pkg.version}           │
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘\n\n`);

	return await runFeatureTests(args);
}


async function runFeatureTests(args: FeaturesTestCommandInput) {
	const { baseImage, collectionFolder, remoteUser, cliHost } = args;
	let { features, disableTestScenarios } = args;

	const srcDir = `${collectionFolder}/src`;
	const testsDir = `${collectionFolder}/test`;

	if (! await cliHost.isFolder(srcDir) || ! await cliHost.isFolder(testsDir)) {
		fail(`Folder '${collectionFolder}' does not contain the required 'src' and 'test' folders.`);
	}

	log(`baseImage:         ${baseImage}`);
	log(`Target Folder:     ${collectionFolder}`);

	// Parse comma separated list of features
	// If a set of '--features' isn't specified, run all features with a 'test' subfolder in random order.
	if (args.globalOnly) {
		features = ['_global']; // Only run global tests that don't nicely scope to a single feature.
	}
	else if (!features) {
		features = await cliHost.readDir(testsDir);
		features.push('_global'); // Run global tests that don't nicely scope to a single feature.
		if (features.length === 0) {
			fail(`No features specified and no test folders found in '${testsDir}'`);
		}
	}

	log(`features:          ${features.join(', ')}`);

	// 1. Generate temporary project with 'baseImage' and all the 'features..'
	const workspaceFolder = await generateDefaultProjectFromFeatures(
		cliHost,
		baseImage,
		collectionFolder,
		features,
		remoteUser
	);

	const params = await generateDockerParams(workspaceFolder, args);
	await createContainerFromWorkingDirectory(params, workspaceFolder, args);

	log('Starting test(s)...\n', { prefix: '\n🏃', info: true });

	let testResults: TestResult[] | undefined = [];

	// 3. Exec default 'test.sh' script for each feature, in the provided order.
	//    Also exec a test's test scenarios, if a scenarios.json is present in the feature's test folder.
	for (const feature of features) {
		log(`Executing '${feature}' test...`, { prefix: '🧪' });
		const featureTestFolder = path.join(collectionFolder, 'test', feature);
		const testScriptPath = path.join(featureTestFolder, 'test.sh');
		if (!(await cliHost.isFile(testScriptPath))) {
			fail(`Feature ${feature} does not have a test script!`);
		}

		// Move the test script into the workspaceFolder
		const testScript = await cliHost.readFile(testScriptPath);
		const remoteTestScriptName = `${feature}-test-${Date.now()}.sh`;
		await cliHost.writeFile(`${workspaceFolder}/${remoteTestScriptName}`, testScript);

		// Move the test library script into the workspaceFolder
		await cliHost.writeFile(`${workspaceFolder}/${TEST_LIBRARY_SCRIPT_NAME}`, Buffer.from(testLibraryScript));

		// Execute Test
		const result = await execTest(params, remoteTestScriptName, workspaceFolder);
		testResults.push({
			testName: feature,
			result,
		});

		// If there is a feature-scoped 'scenarios.json' with additional tests, also exec those.
		// Pass 'testResults' array reference in to capture results.
		// Executing scenarios be disabled via the --disable-test-scenarios flag, or omit a scenarios.json file.
		if (!disableTestScenarios) {
			await doScenario(featureTestFolder, args, testResults);
		}

		if (!testResults) {
			fail(`Failed to run scenarios in ${featureTestFolder}`);
			return 1; // We never reach here, we exit via fail().
		}

	}

	// Pretty-prints results and returns a status code to indicate success or failure.
	return analyzeTestResults(testResults);
}

async function doScenario(pathToTestDir: string, args: FeaturesTestCommandInput, testResults: TestResult[] = []): Promise<TestResult[] | undefined> {
	const { collectionFolder, cliHost } = args;
	const scenariosPath = path.join(pathToTestDir, 'scenarios.json');

	if (!(await cliHost.isFile(scenariosPath))) {
		return;
	}

	// Read in scenarios.json
	const scenariosBuffer = await cliHost.readFile(scenariosPath);
	// Parse to json
	let scenarios: Scenarios = {};
	try {
		scenarios = JSON.parse(scenariosBuffer.toString());
	} catch (e) {
		fail(`Failed to parse scenarios.json:  ${e.message}`);
		return; // We never reach here, we exit via fail().
	}

	// For EACH scenario: Spin up a container and exec the scenario test script
	for (const [scenarioName, scenarioConfig] of Object.entries(scenarios)) {
		log(`Running scenario:  ${scenarioName}`);

		// Check if we have a scenario test script, otherwise skip.
		const scenarioTestScript = path.join(pathToTestDir, `${scenarioName}.sh`);
		if (!(await cliHost.isFile(scenarioTestScript))) {
			log(`No scenario test script found at path ${scenarioTestScript}, skipping scenario...`);
			continue;
		}

		// Create Container
		const workspaceFolder = await generateProjectFromScenario(cliHost, collectionFolder, scenarioName, scenarioConfig);
		const params = await generateDockerParams(workspaceFolder, args);
		await createContainerFromWorkingDirectory(params, workspaceFolder, args);

		// Execute test script
		// Move the test script into the workspaceFolder
		const testScript = await cliHost.readFile(scenarioTestScript);
		const remoteTestScriptName = `${scenarioName}-test-${Date.now()}.sh`;
		await cliHost.writeFile(`${workspaceFolder}/${remoteTestScriptName}`, testScript);

		// Move the test library script into the workspaceFolder
		await cliHost.writeFile(`${workspaceFolder}/${TEST_LIBRARY_SCRIPT_NAME}`, Buffer.from(testLibraryScript));

		// Execute Test
		testResults.push({
			testName: scenarioName,
			result: await execTest(params, remoteTestScriptName, workspaceFolder)
		});
	}
	return testResults;
}

function analyzeTestResults(testResults: { testName: string; result: boolean }[]): number {
	// 4. Print results
	const allPassed = testResults.every((x) => x.result);
	process.stdout.write('\n\n\n');
	log('================== TEST REPORT ==================', { 'info': true, 'prefix': ' ' });
	testResults.forEach(t => {
		if (t.result) {
			log(`Passed:      '${t.testName}'`, { 'prefix': '✅', 'info': true });
		} else {
			log(`Failed:      '${t.testName}'`, { 'prefix': '❌', 'info': true });
		}
	});
	process.stdout.write('\n');
	return allPassed ? 0 : 1;
}

const devcontainerTemplate = `
{
	"image": "#{IMAGE}",
	"features": {
		#{FEATURES}
	},
	"remoteUser": "#{REMOTE_USER}"
}`;

async function createContainerFromWorkingDirectory(params: DockerResolverParameters, workspaceFolder: string, args: FeaturesTestCommandInput): Promise<LaunchResult | undefined> {
	const { quiet, remoteUser, disposables } = args;
	log(`workspaceFolder:   ${workspaceFolder}`);

	// 2. Use  'devcontainer-cli up'  to build and start a container
	log('Building test container...\n', { prefix: '\n⏳', info: true });
	const launchResult: LaunchResult | undefined = await launchProject(params, workspaceFolder, quiet, disposables);
	if (!launchResult || !launchResult.containerId) {
		fail('Failed to launch container');
		return;
	}

	const { containerId } = launchResult;

	log(`Launched container.`, { prefix: '\n🚀', info: true });
	log(`containerId:          ${containerId}`);
	log(`remoteUser:           ${remoteUser}`);

	return launchResult;
}

async function createTempDevcontainerFolder(cliHost: CLIHost): Promise<string> {
	const systemTmpDir = tmpdir();
	const tmpFolder = path.join(systemTmpDir, 'vsch', 'container-features-test', Date.now().toString());
	await cliHost.mkdirp(`${tmpFolder}/.devcontainer`);
	return tmpFolder;
}

async function generateDefaultProjectFromFeatures(
	cliHost: CLIHost,
	baseImage: string,
	collectionsDirectory: string,
	featuresToTest: string[],
	remoteUser: string
): Promise<string> {
	const tmpFolder = await createTempDevcontainerFolder(cliHost);

	const features = featuresToTest
		.map((x) => `"${collectionsDirectory}/src/${x}": {}`)
		.join(',\n');

	let template = devcontainerTemplate
		.replace('#{IMAGE}', baseImage)
		.replace('#{FEATURES}', features)
		.replace('#{REMOTE_USER}', remoteUser);

	await cliHost.writeFile(`${tmpFolder}/.devcontainer/devcontainer.json`, Buffer.from(template));

	return tmpFolder;
}

async function generateProjectFromScenario(
	cliHost: CLIHost,
	collectionsDirectory: string,
	scenarioId: string,
	scenarioObject: DevContainerConfig
): Promise<string> {
	const tmpFolder = await createTempDevcontainerFolder(cliHost);

	let features = scenarioObject.features;
	if (!scenarioObject || !features) {
		fail(`Scenario '${scenarioId}' is missing features!`);
		return ''; // Exits in the 'fail()' before this line is reached.
	}

	// Prefix the local path to the collections directory
	let updatedFeatures: Record<string, string | boolean | Record<string, string | boolean>> = {};
	for (const [featureName, featureValue] of Object.entries(features)) {
		updatedFeatures[`${collectionsDirectory}/src/${featureName}`] = featureValue;
	}
	scenarioObject.features = updatedFeatures;

	await cliHost.writeFile(`${tmpFolder}/.devcontainer/devcontainer.json`, Buffer.from(JSON.stringify(scenarioObject)));

	// tmpFolder will serve as our auto-generated 'workingFolder'
	return tmpFolder;
}

async function launchProject(params: DockerResolverParameters, workspaceFolder: string, quiet: boolean, disposables: (() => Promise<unknown> | undefined)[]): Promise<LaunchResult> {
	const { common } = params;
	let response = {} as LaunchResult;

	const options: ProvisionOptions = {
		...staticProvisionParams,
		workspaceFolder,
		logLevel: common.getLogLevel(),
		mountWorkspaceGitRoot: true,
		idLabels: [
			`devcontainer.local_folder=${workspaceFolder}`
		],
		remoteEnv: common.remoteEnv,
		skipFeatureAutoMapping: common.skipFeatureAutoMapping,
		log: text => quiet ? null : process.stderr.write(text),
	};

	try {
		if (quiet) {
			// Launch container but don't await it to reduce output noise
			let isResolved = false;
			const p = launch(options, disposables);
			p.then(function (res) {
				process.stdout.write('\n');
				response = res;
				isResolved = true;
			});
			while (!isResolved) {
				// Just so visual progress with dots
				process.stdout.write('.');
				await new Promise((resolve) => setTimeout(resolve, 500));
			}
		} else {
			// Stream all the container setup logs.
			response = await launch(options, disposables);
		}

		return {
			...response,
			disposables,
		};
	} catch (e: any) {
		fail(`Failed to launch container:\n\n${e?.message ?? 'Unknown error'}`);
		return response; // `fail` exits before we return this.
	}
}

async function execTest(params: DockerResolverParameters, remoteTestScriptName: string, workspaceFolder: string) {
	let cmd = 'chmod';
	let args = ['777', `./${remoteTestScriptName}`, `./${TEST_LIBRARY_SCRIPT_NAME}`];
	await exec(params, cmd, args, workspaceFolder);


	cmd = `./${remoteTestScriptName}`;
	args = [];
	return await exec(params, cmd, args, workspaceFolder);
}

async function exec(_params: DockerResolverParameters, cmd: string, args: string[], workspaceFolder: string) {
	const execArgs = {
		...staticExecParams,
		'workspace-folder': workspaceFolder,
		'skip-feature-auto-mapping': false,
		cmd,
		args,
		_: [
			cmd,
			...args
		]
	};
	const result = await doExec(execArgs);
	return (result.outcome === 'success');
}

async function generateDockerParams(workspaceFolder: string, args: FeaturesTestCommandInput): Promise<DockerResolverParameters> {
	const { logLevel, quiet, disposables } = args;
	return await createDockerParams({
		workspaceFolder,
		dockerPath: undefined,
		dockerComposePath: undefined,
		containerDataFolder: undefined,
		containerSystemDataFolder: undefined,
		mountWorkspaceGitRoot: false,
		idLabels: [],
		configFile: undefined,
		overrideConfigFile: undefined,
		logLevel,
		logFormat: 'text',
		log: text => quiet ? null : process.stderr.write(text),
		terminalDimensions: undefined,
		defaultUserEnvProbe: 'loginInteractiveShell',
		removeExistingContainer: false,
		buildNoCache: false,
		expectExistingContainer: false,
		postCreateEnabled: false,
		skipNonBlocking: false,
		prebuild: false,
		persistedFolder: undefined,
		additionalMounts: [],
		updateRemoteUserUIDDefault: 'never',
		remoteEnv: {},
		additionalCacheFroms: [],
		omitLoggerHeader: true,
		useBuildKit: 'auto',
		buildxPlatform: undefined,
		buildxPush: false,
		skipFeatureAutoMapping: false,
	}, disposables);
}
