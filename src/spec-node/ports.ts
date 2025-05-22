import { DevContainerFromDockerfileConfig, DevContainerFromImageConfig } from '../spec-configuration/configuration';

function normalizePorts(ports: number | string | (number | string)[] | undefined): string[] {
	ports = ports ?? [];
	ports = typeof ports === 'number' || typeof ports === 'string' ? [ports] : ports;
	return ports.map((port) => typeof port === 'number' ? `127.0.0.1:${port}:${port}`: port);
}

export function getStaticPorts(config: DevContainerFromDockerfileConfig | DevContainerFromImageConfig, skipForwardPorts: boolean): string[] {
	const forwardPorts = skipForwardPorts ? undefined : config.forwardPorts;
	return normalizePorts(forwardPorts).concat(normalizePorts(config.appPort));
}
