import { Log, LogLevel } from '../spec-utils/log';
import * as os from 'os';
import * as path from 'path';
import * as jsonc from 'jsonc-parser';
import { fetchOCIManifestIfExists, getBlob, getRef, OCIManifest } from './containerCollectionsOCI';
import { isLocalFile, readLocalFile, writeLocalFile } from '../spec-utils/pfs';
import { DevContainerConfig } from './configuration';

export interface TemplateOptions {
	[name: string]: string;
}
export interface TemplateFeatureOption {
	id: string;
	options: Record<string, boolean | string | undefined>;
}

export interface SelectedTemplate {
	id: string;
	options: TemplateOptions;
	features: TemplateFeatureOption[];
}

export async function fetchTemplate(output: Log, selectedTemplate: SelectedTemplate, templateDestPath: string, userProvidedTmpDir?: string): Promise<string[] | undefined> {

	const { id, options } = selectedTemplate;
	const templateRef = getRef(output, id);
	if (!templateRef) {
		output.write(`Failed to parse template ref for ${id}`, LogLevel.Error);
		return;
	}

	const ociManifest = await fetchOCITemplateManifestIfExistsFromUserIdentifier(output, process.env, id);
	if (!ociManifest) {
		output.write(`Failed to fetch template manifest for ${id}`, LogLevel.Error);
		return;
	}

	const blobUrl = `https://${templateRef.registry}/v2/${templateRef.path}/blobs/${ociManifest?.layers[0].digest}`;
	output.write(`blob url: ${blobUrl}`, LogLevel.Trace);

	const tmpDir = userProvidedTmpDir || path.join(os.tmpdir(), 'vsch-template-temp', `${Date.now()}`);
	const files = await getBlob(output, process.env, blobUrl, tmpDir, templateDestPath, templateRef, undefined, ['devcontainer-template.json', 'README.md', 'NOTES.md']);

	if (!files) {
		throw new Error(`Failed to download package for ${templateRef.resource}`);
	}

	// Scan all template files and replace any templated values.
	for (const f of files) {
		output.write(`Scanning file '${f}'`, LogLevel.Trace);
		const filePath = path.join(templateDestPath, f);
		if (await isLocalFile(filePath)) {
			const fileContents = await readLocalFile(filePath);
			const fileContentsReplaced = replaceTemplatedValues(output, fileContents.toString(), options);
			await writeLocalFile(filePath, Buffer.from(fileContentsReplaced));
		} else {
			output.write(`Could not find templated file '${f}'.`, LogLevel.Error);
		}
	}

	// Get the config.  A template should not have more than one devcontainer.json.
	const config = async (files: string[]) => {
		const p = files.find(f => f.endsWith('devcontainer.json'));
		if (p) {
			const configPath = path.join(templateDestPath, p);
			if (await isLocalFile(configPath)) {
				const configContents = await readLocalFile(configPath);
				return {
					configPath,
					configText: configContents.toString(),
					configObject: jsonc.parse(configContents.toString()) as DevContainerConfig,
				};
			}
		}
		return undefined;
	};

	if (selectedTemplate.features.length !== 0) {
		const configResult = await config(files);
		if (configResult) {
			await addFeatures(output, selectedTemplate.features, configResult);
		} else {
			output.write(`Could not find a devcontainer.json to apply selected Features onto.`, LogLevel.Error);
		}
	}

	return files;
}


async function fetchOCITemplateManifestIfExistsFromUserIdentifier(output: Log, env: NodeJS.ProcessEnv, identifier: string, manifestDigest?: string, authToken?: string): Promise<OCIManifest | undefined> {
	const templateRef = getRef(output, identifier);
	return await fetchOCIManifestIfExists(output, env, templateRef, manifestDigest, authToken);
}

function replaceTemplatedValues(output: Log, template: string, options: TemplateOptions) {
	const pattern = /\${templateOption:\s*(\w+?)\s*}/g; // ${templateOption:XXXX}
	return template.replace(pattern, (_, token) => {
		output.write(`Replacing ${token} with ${options[token]}`);
		return options[token] || '';
	});
}

async function addFeatures(output: Log, newFeatures: TemplateFeatureOption[], configResult: { configPath: string; configText: string; configObject: DevContainerConfig }) {
	const { configPath, configText, configObject } = configResult;
	if (newFeatures) {
		let previousText = configText;
		let updatedText = configText;

		// Add the features property if it doesn't exist.
		if (!configObject.features) {
			const edits = jsonc.modify(updatedText, ['features'], {}, { formattingOptions: {} });
			updatedText = jsonc.applyEdits(updatedText, edits);
		}

		for (const newFeature of newFeatures) {
			let edits: jsonc.Edit[] = [];
			const propertyPath = ['features', newFeature.id];

			edits = edits.concat(
				jsonc.modify(updatedText, propertyPath, newFeature.options, { formattingOptions: {} }
				));

			updatedText = jsonc.applyEdits(updatedText, edits);
		}

		if (previousText !== updatedText) {
			output.write(`Updating ${configPath} with ${newFeatures.length} Features`, LogLevel.Trace);
			await writeLocalFile(configPath, Buffer.from(updatedText));
		}
	}
}