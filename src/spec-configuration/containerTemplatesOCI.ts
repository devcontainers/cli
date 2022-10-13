import { Log, LogLevel } from '../spec-utils/log';
import * as os from 'os';
import * as path from 'path';
import { fetchOCIManifestIfExists, getBlob, getRef, OCIManifest } from './containerCollectionsOCI';
import { isLocalFile, readLocalFile, writeLocalFile } from '../spec-utils/pfs';

export interface TemplateOptions {
	[name: string]: string;
}

export interface SelectedTemplate {
	id: string;
	options: TemplateOptions;
}

export async function fetchTemplate(output: Log, selectedTemplate: SelectedTemplate, templateDestPath: string): Promise<string[] | undefined> {
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

	const tmpDir = path.join(os.tmpdir(), 'vsch-template-temp', `${Date.now()}`);
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