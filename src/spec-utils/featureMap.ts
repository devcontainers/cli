/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const features = ['aws-cli', 'azure-cli', 'common', 'desktop-lite', 'docker-in-docker', 'docker-from-docker', 'dotnet', 'git', 'git-lfs', 'github-cli', 'java', 'kubectl-helm-minikube', 'node', 'powershell', 'python', 'ruby', 'rust', 'sshd', 'terraform'];

const renamedFeatures = new Map();
renamedFeatures.set('golang', 'go');

const deprecatedFeatures = ['fish', 'gradle', 'homebrew', 'jupyterlab', 'maven'];

const newFeaturePath = 'ghcr.io/devcontainers/features';
const oldFeaturePath = 'microsoft/vscode-dev-containers';

export function getFeatureId(id: string) {
	if (features.includes(id)) {
		return `${newFeaturePath}/${id}`;
	} else if (renamedFeatures.get(id) !== undefined) {
		return `${newFeaturePath}/${renamedFeatures.get(id)}`;
	} else if (deprecatedFeatures.includes(id)) {
		return `${oldFeaturePath}/${id}`;
	} else {
		return `id`;
	}
}