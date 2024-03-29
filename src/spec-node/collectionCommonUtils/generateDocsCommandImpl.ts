import * as fs from 'fs';
import * as path from 'path';
import * as jsonc from 'jsonc-parser';
import { LogLevel } from '../../spec-utils/log';
import { GenerateDocsCollectionType, GenerateDocsCommandInput } from './generateDocs';
import { isLocalFile, isLocalFolder, readLocalDir } from '../../spec-utils/pfs';

const FEATURES_README_TEMPLATE = `
# #{Name}

#{Description}

## Example Usage

\`\`\`json
"features": {
    "#{Registry}/#{Namespace}/#{Id}:#{Version}": {}
}
\`\`\`

#{OptionsTable}
#{Customizations}
#{Notes}

---

_Note: This file was auto-generated from the [devcontainer-feature.json](#{RepoUrl}).  Add additional notes to a \`NOTES.md\`._
`;

const TEMPLATE_README_TEMPLATE = `
# #{Name}

#{Description}

#{OptionsTable}

#{Notes}

---

_Note: This file was auto-generated from the [devcontainer-template.json](#{RepoUrl}).  Add additional notes to a \`NOTES.md\`._
`;

const README_TEMPLATES = {
    'feature': FEATURES_README_TEMPLATE,
    'template': TEMPLATE_README_TEMPLATE,
};

export async function generateDocumentation(args: GenerateDocsCommandInput, collectionType: GenerateDocsCollectionType) {

    const {
        targetFolder: basePath,
        registry,
        namespace,
        gitHubOwner,
        gitHubRepo,
        output,
        isSingle,
    } = args;

    const readmeTemplate = README_TEMPLATES[collectionType];

    const directories = isSingle ? ['.'] : await readLocalDir(basePath);


    const metadataFile = `devcontainer-${collectionType}.json`;

    await Promise.all(
        directories.map(async (f: string) => {
            if (f.startsWith('..')) {
                return;
            }

            const readmePath = path.join(basePath, f, 'README.md');
            output.write(`Generating ${readmePath}...`, LogLevel.Info);

            const jsonPath = path.join(basePath, f, metadataFile);

            if (!(await isLocalFile(jsonPath))) {
                    output.write(`(!) Warning: ${metadataFile} not found at path '${jsonPath}'. Skipping...`, LogLevel.Warning);
                    return;
                }

                let parsedJson: any | undefined = undefined;
                try {
                    parsedJson = jsonc.parse(fs.readFileSync(jsonPath, 'utf8'));
                } catch (err) {
                    output.write(`Failed to parse ${jsonPath}: ${err}`, LogLevel.Error);
                    return;
                }

                if (!parsedJson || !parsedJson?.id) {
                    output.write(`${metadataFile} for '${f}' does not contain an 'id'`, LogLevel.Error);
                    return;
                }

                // Add version
                let version = 'latest';
                const parsedVersion: string = parsedJson?.version;
                if (parsedVersion) {
                    // example - 1.0.0
                    const splitVersion = parsedVersion.split('.');
                    version = splitVersion[0];
                }

                const generateOptionsMarkdown = () => {
                    const options = parsedJson?.options;
                    if (!options) {
                        return '';
                    }

                    const keys = Object.keys(options);
                    const contents = keys
                        .map(k => {
                            const val = options[k];

                            const desc = val.description || '-';
                            const type = val.type || '-';
                            const def = val.default !== '' ? val.default : '-';

                            return `| ${k} | ${desc} | ${type} | ${def} |`;
                        })
                        .join('\n');

                    return '## Options\n\n' + '| Options Id | Description | Type | Default Value |\n' + '|-----|-----|-----|-----|\n' + contents;
                };

                const generateNotesMarkdown = () => {
                    const notesPath = path.join(basePath, f, 'NOTES.md');
                    return fs.existsSync(notesPath) ? fs.readFileSync(path.join(notesPath), 'utf8') : '';
                };

                let urlToConfig = `${metadataFile}`;
                const basePathTrimmed = basePath.startsWith('./') ? basePath.substring(2) : basePath;
                if (gitHubOwner !== '' && gitHubRepo !== '') {
                    urlToConfig = `https://github.com/${gitHubOwner}/${gitHubRepo}/blob/main/${basePathTrimmed}/${f}/${metadataFile}`;
                }

                let header;
                const isDeprecated = parsedJson?.deprecated;
                const hasLegacyIds = parsedJson?.legacyIds && parsedJson?.legacyIds.length > 0;

                if (isDeprecated || hasLegacyIds) {
                    header = '### **IMPORTANT NOTE**\n';

                    if (isDeprecated) {
                        header += `- **This Feature is deprecated, and will no longer receive any further updates/support.**\n`;
                    }

                    if (hasLegacyIds) {
                        const formattedLegacyIds = parsedJson.legacyIds.map((legacyId: string) => `'${legacyId}'`);
                        header += `- **Ids used to publish this Feature in the past - ${formattedLegacyIds.join(', ')}**\n`;
                    }
                }

                let extensions = '';
                if (parsedJson?.customizations?.vscode?.extensions) {
                    const extensionsList = parsedJson.customizations.vscode.extensions;
                    if (extensionsList && extensionsList.length > 0) {
                        extensions =
                            '\n## Customizations\n\n### VS Code Extensions\n\n' + extensionsList.map((ext: string) => `- \`${ext}\``).join('\n') + '\n';
                    }
                }

                let newReadme = readmeTemplate
                    // Templates & Features
                    .replace('#{Id}', parsedJson.id)
                    .replace('#{Name}', parsedJson.name ? `${parsedJson.name} (${parsedJson.id})` : `${parsedJson.id}`)
                    .replace('#{Description}', parsedJson.description ?? '')
                    .replace('#{OptionsTable}', generateOptionsMarkdown())
                    .replace('#{Notes}', generateNotesMarkdown())
                    .replace('#{RepoUrl}', urlToConfig)
                    // Features Only
                    .replace('#{Registry}', registry || '')
                    .replace('#{Namespace}', namespace || '')
                    .replace('#{Version}', version)
                    .replace('#{Customizations}', extensions);

                if (header) {
                    newReadme = header + newReadme;
                }

                // Remove previous readme
                if (fs.existsSync(readmePath)) {
                    fs.unlinkSync(readmePath);
                }

                // Write new readme
            fs.writeFileSync(readmePath, newReadme);
        })
    );
}

export async function prepGenerateDocsCommand(args: GenerateDocsCommandInput, collectionType: GenerateDocsCollectionType): Promise<GenerateDocsCommandInput> {
    const { cliHost, targetFolder, registry, namespace, gitHubOwner, gitHubRepo, output, disposables } = args;

    const targetFolderResolved = cliHost.path.resolve(targetFolder);
    if (!(await isLocalFolder(targetFolderResolved))) {
        throw new Error(`Target folder '${targetFolderResolved}' does not exist`);
    }

    // Detect if we're dealing with a collection or a single feature/template
    const isValidFolder = await isLocalFolder(cliHost.path.join(targetFolderResolved));
    const isSingle = await isLocalFile(cliHost.path.join(targetFolderResolved, `devcontainer-${collectionType}.json`));

    if (!isValidFolder) {
        throw new Error(`Target folder '${targetFolderResolved}' does not exist`);
    }

    return {
        cliHost,
        targetFolder: targetFolderResolved,
        registry,
        namespace,
        gitHubOwner,
        gitHubRepo,
        output,
        disposables,
        isSingle
    };
}
