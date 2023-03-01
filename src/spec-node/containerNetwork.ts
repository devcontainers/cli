import { DevContainerConfig, DevContainerFromDockerfileConfig, DevContainerFromImageConfig } from '../spec-configuration/configuration';

function getStaticPorts (ports: number | string | (number | string)[] | undefined): string[]{
	ports = ports ?? [];
	ports = typeof ports === 'number' || typeof ports === 'string'? [ports] : ports;
	return ports.map((port) => typeof port === 'number'? `127.0.0.1:${port}:${port}`: port);
}

function appPorts (config: DevContainerFromDockerfileConfig | DevContainerFromImageConfig): string[]{
	return getStaticPorts(config.appPort);
}

function hasAppPorts(obj: unknown):obj is (DevContainerFromDockerfileConfig | DevContainerFromImageConfig) {
	return (obj as DevContainerFromDockerfileConfig | DevContainerFromImageConfig).appPort !== undefined;	
}
export function applyStaticPorts (config: DevContainerConfig): string[] {
	let  staticPorts: string[] = [];
	staticPorts = staticPorts.concat(...getStaticPorts(config.forwardPorts));
	if(hasAppPorts(config)){
		staticPorts = staticPorts.concat(...appPorts(config));
	}
	return (<string[]>[]).concat(...staticPorts.map((port) => ['-p', port]));
}

