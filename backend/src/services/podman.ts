import { exec } from "child_process";
import console from "console";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";

const execAsync = promisify(exec);
const BASE_PORT = 8000;

const usedPorts = new Set<number>();

async function getAllAssignedPorts(): Promise<number[]> {
	try {
		const { stdout } = await execAsync(
			`podman ps -a --filter label=project=december --format '{{.Labels.assignedPort}}'`
		);

		return stdout
			.trim()
			.split("\n")
			.filter((p) => p && p !== "<no value>" && p !== "")
			.map((p) => parseInt(p))
			.filter((p) => !isNaN(p));
	} catch {
		return [];
	}
}

async function findAvailablePort(
	startPort: number = BASE_PORT
): Promise<number> {
	const assignedPorts = await getAllAssignedPorts();
	const allUsedPorts = new Set([...usedPorts, ...assignedPorts]);

	for (let port = startPort; port < startPort + 1000; port++) {
		if (!allUsedPorts.has(port) && (await isPortAvailable(port))) {
			usedPorts.add(port);
			return port;
		}
	}
	throw new Error("No available ports found");
}

async function isPortAvailable(port: number): Promise<boolean> {
	try {
		const { stdout } = await execAsync(`lsof -i :${port}`);
		return stdout.trim() === "";
	} catch {
		return true;
	}
}

function releasePort(port: number): void {
	usedPorts.delete(port);
}

export async function getContainerfile(): Promise<string> {
	return await fs.readFile("./src/Containerfile", "utf-8");
}

export async function buildImage(containerId: string): Promise<string> {
	const tempDir = path.join("/tmp", `podman-app-${containerId}`);
	await fs.mkdir(tempDir, { recursive: true });

	try {
		const containerfileContent = await getContainerfile();
		await fs.writeFile(
			path.join(tempDir, "Containerfile"),
			containerfileContent
		);

		const imageName = `dec-nextjs-${containerId}`;
		console.log(`Building image: ${imageName}`);

		await execAsync(`podman build -t ${imageName} --rm --force-rm ${tempDir}`, {
			maxBuffer: 50 * 1024 * 1024,
		});

		console.log(`Image ${imageName} created successfully`);

		await fs.rm(tempDir, { recursive: true, force: true });
		return imageName;
	} catch (error) {
		await fs.rm(tempDir, { recursive: true, force: true });
		throw error;
	}
}

export async function createContainer(
	imageName: string,
	containerId: string
): Promise<{ containerId: string; port: number }> {
	const containerName = `dec-nextjs-${containerId}`;
	const assignedPort = await findAvailablePort();

	console.log(`Creating container: ${containerName} on port ${assignedPort}`);

	const { stdout } = await execAsync(
		`podman create --name ${containerName} ` +
		`-p ${assignedPort}:3000 ` +
		`--label project=december ` +
		`--label type=nextjs-app ` +
		`--label assignedPort=${assignedPort} ` +
		`${imageName}`
	);

	const newContainerId = stdout.trim();
	console.log(`Starting container: ${newContainerId}`);
	await execAsync(`podman start ${newContainerId}`);

	return { containerId: newContainerId, port: assignedPort };
}

export async function startContainer(
	containerId: string
): Promise<{ port: number }> {
	try {
		const info = await inspectContainer(containerId);

		if (info.State.Running) {
			const port = getPortFromContainer(info);
			return { port };
		}

		let assignedPort: number;
		const portLabel = info.Config.Labels?.assignedPort;

		if (portLabel && (await isPortAvailable(parseInt(portLabel)))) {
			assignedPort = parseInt(portLabel);
			usedPorts.add(assignedPort);
		} else {
			assignedPort = await findAvailablePort();

			if (portLabel && parseInt(portLabel) !== assignedPort) {
				throw new Error(
					`Container port ${portLabel} is no longer available. Please recreate the container.`
				);
			}
		}

		await execAsync(`podman start ${containerId}`);
		console.log(`Started container: ${containerId} on port ${assignedPort}`);

		return { port: assignedPort };
	} catch (error) {
		throw new Error(
			`Failed to start container: ${error instanceof Error ? error.message : "Unknown error"
			}`
		);
	}
}

function getPortFromContainer(containerInfo: any): number {
	const portBindings =
		containerInfo.HostConfig?.PortBindings?.["3000/tcp"];
	if (portBindings && portBindings[0]?.HostPort) {
		const port = parseInt(portBindings[0].HostPort);
		usedPorts.add(port);
		return port;
	}

	const portLabel = containerInfo.Config.Labels?.assignedPort;
	if (portLabel) {
		const port = parseInt(portLabel);
		usedPorts.add(port);
		return port;
	}

	throw new Error("Could not determine container port");
}

export async function cleanupImage(containerId: string): Promise<void> {
	try {
		const imageName = `dec-nextjs-${containerId}`;
		await execAsync(`podman rmi -f ${imageName}`);
		console.log(`Cleaned up failed image: ${imageName}`);
	} catch (cleanupError) { }
}

export async function inspectContainer(containerId: string): Promise<any> {
	const { stdout } = await execAsync(`podman inspect ${containerId}`);
	const inspectData = JSON.parse(stdout);
	return Array.isArray(inspectData) ? inspectData[0] : inspectData;
}

export async function execInContainer(
	containerId: string,
	command: string
): Promise<string> {
	const { stdout } = await execAsync(
		`podman exec ${containerId} sh -c ${JSON.stringify(command)}`,
		{ maxBuffer: 50 * 1024 * 1024 }
	);
	return stdout;
}

export async function listProjectContainers(): Promise<any[]> {
	try {
		const { stdout } = await execAsync(
			`podman ps -a --filter label=project=december --format json`
		);

		if (!stdout.trim()) return [];

		const containers = JSON.parse(stdout);
		const containerList = Array.isArray(containers)
			? containers
			: [containers];

		return containerList.map((container: any) => {
			const assignedPort = container.Labels?.assignedPort
				? parseInt(container.Labels.assignedPort)
				: null;

			const name =
				container.Names && container.Names.length > 0
					? container.Names[0].replace("/", "")
					: container.Name?.replace("/", "") || "";

			return {
				id: container.Id,
				name,
				status: container.State,
				image: container.Image,
				created: container.Created
					? typeof container.Created === "number"
						? new Date(container.Created * 1000).toISOString()
						: container.Created
					: new Date().toISOString(),
				assignedPort,
				url: assignedPort ? `http://localhost:${assignedPort}` : null,
				ports:
					container.Ports?.map((port: any) => ({
						private: port.container_port || port.PrivatePort,
						public: port.host_port || port.PublicPort,
						type: port.protocol || port.Type,
					})) || [],
				labels: container.Labels,
			};
		});
	} catch {
		return [];
	}
}

export async function stopContainer(containerId: string): Promise<void> {
	try {
		const containerInfo = await inspectContainer(containerId);

		const port = getPortFromContainer(containerInfo);
		releasePort(port);

		await execAsync(`podman stop ${containerId}`);
		console.log(`Stopped container: ${containerId}, released port: ${port}`);
	} catch (error) {
		throw new Error(
			`Failed to stop container: ${error instanceof Error ? error.message : "Unknown error"
			}`
		);
	}
}

export async function deleteContainer(containerId: string): Promise<void> {
	try {
		const containerInfo = await inspectContainer(containerId);

		const port = getPortFromContainer(containerInfo);
		releasePort(port);

		if (containerInfo.State.Running) {
			console.log(`Stopping container before deletion: ${containerId}`);
			await execAsync(`podman stop ${containerId}`);
		}

		await execAsync(`podman rm -f ${containerId}`);
		console.log(`Deleted container: ${containerId}, freed port: ${port}`);

		const imageName = containerInfo.Config.Image;
		if (imageName && imageName.includes("dec-nextjs-")) {
			try {
				await execAsync(`podman rmi -f ${imageName}`);
				console.log(`Deleted associated image: ${imageName}`);
			} catch (imageError) {
				console.warn(`Could not delete image ${imageName}:`, imageError);
			}
		}
	} catch (error) {
		throw new Error(
			`Failed to delete container: ${error instanceof Error ? error.message : "Unknown error"
			}`
		);
	}
}
