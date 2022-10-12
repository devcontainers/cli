import { Log, LogLevel } from '../spec-utils/log';
import * as os from 'os';
import { fetchOCIManifestIfExists, getBlob, getRef, OCIManifest } from './containerCollectionsOCI';


export async function fetchTemplate(output: Log, identifier: string, templateCachePath: string): Promise<string[] | undefined> {
	const templateRef = getRef(output, identifier);
	if (!templateRef) {
		output.write(`Failed to parse template ref for ${identifier}`, LogLevel.Error);
		return;
	}

	const ociManifest = await fetchOCITemplateManifestIfExistsFromUserIdentifier(output, process.env, identifier);
	if (!ociManifest) {
		output.write(`Failed to fetch template manifest for ${identifier}`, LogLevel.Error);
		return;
	}

	const blobUrl = `https://${templateRef.registry}/v2/${templateRef.path}/blobs/${ociManifest?.layers[0].digest}`;
	output.write(`blob url: ${blobUrl}`, LogLevel.Trace);

	const tmpDir = os.tmpdir();
	const files = await getBlob(output, process.env, blobUrl, tmpDir, templateCachePath, templateRef, undefined, ['devcontainer-template.json', 'README.md', 'NOTES.md']);

	if (!files) {
		throw new Error(`Failed to download package for ${templateRef.resource}`);
	}

	return files;
}


async function fetchOCITemplateManifestIfExistsFromUserIdentifier(output: Log, env: NodeJS.ProcessEnv, identifier: string, manifestDigest?: string, authToken?: string): Promise<OCIManifest | undefined> {
	const templateRef = getRef(output, identifier);
	return await fetchOCIManifestIfExists(output, env, templateRef, manifestDigest, authToken);
}
