import { exec } from "child_process";
import fs from "fs/promises";
import { promisify } from "util";
import { v4 as uuidv4 } from "uuid";
import { execInContainer } from "./podman";
import console from "console";

const execAsync = promisify(exec);
const BASE_PATH = "/app/my-nextjs-app";

function getAbsolutePath(filePath: string): string {
	return filePath.startsWith("/") ? filePath : `${BASE_PATH}/${filePath}`;
}

export interface FileItem {
	name: string;
	path: string;
	type: "file" | "directory";
	children?: FileItem[];
	content?: string;
}

export interface FileContentItem {
	name: string;
	path: string;
	type: "file" | "directory";
	content?: string;
	children?: FileContentItem[];
}

export async function getFileTree(
	containerId: string,
	containerPath: string = BASE_PATH
): Promise<FileItem[]> {
	const output = await execInContainer(
		containerId,
		`find ${containerPath} \\( -name node_modules -o -name .next \\) -prune -o -type f -o -type d | grep -v -E "(node_modules|\\.next)" | sort`
	);

	const paths = output
		.trim()
		.split("\n")
		.filter((p) => p && p !== containerPath);
	const fileTree: Map<string, FileItem> = new Map();

	fileTree.set(containerPath, {
		name: "root",
		path: containerPath,
		type: "directory",
		children: [],
	});

	for (const filePath of paths) {
		const stat = await getFileStat(containerId, filePath);
		const relativePath = filePath.replace(containerPath + "/", "");
		const parts = relativePath.split("/");
		const fileName = parts[parts.length - 1] || "";

		const fileItem: FileItem = {
			name: fileName,
			path: filePath,
			type: stat.isDirectory ? "directory" : "file",
		};

		if (stat.isDirectory) {
			fileItem.children = [];
		}

		fileTree.set(filePath, fileItem);

		const parentPath = filePath.substring(0, filePath.lastIndexOf("/"));
		const parent = fileTree.get(parentPath || containerPath);
		if (parent && parent.children) {
			parent.children.push(fileItem);
		}
	}

	const root = fileTree.get(containerPath);
	return root?.children || [];
}

export async function getFileContentTree(
	containerId: string,
	containerPath: string = BASE_PATH
): Promise<FileContentItem[]> {
	const output = await execInContainer(
		containerId,
		`find ${containerPath} \\( -name node_modules -o -name .next -o -path "*/components/ui" \\) -prune -o -type f -o -type d | grep -v -E "(node_modules|\\.next|components/ui|bun\\.lock|components\\.json|next-env\\.d\\.ts|package-lock\\.json|postcss\\.config\\.mjs|favicon\\.ico|\\.gitignore)" | sort`
	);

	const paths = output
		.trim()
		.split("\n")
		.filter((p) => p && p !== containerPath);

	const fileTree: Map<string, FileContentItem> = new Map();

	fileTree.set(containerPath, {
		name: "root",
		path: containerPath,
		type: "directory",
		children: [],
	});

	const filesToRead: string[] = [];
	const pathToItemMap: Map<string, FileContentItem> = new Map();

	for (const filePath of paths) {
		const stat = await getFileStat(containerId, filePath);
		const relativePath = filePath.replace(containerPath + "/", "");
		const parts = relativePath.split("/");
		const fileName = parts[parts.length - 1] || "";

		const fileItem: FileContentItem = {
			name: fileName,
			path: filePath,
			type: stat.isDirectory ? "directory" : "file",
		};

		if (stat.isDirectory) {
			fileItem.children = [];
		} else {
			filesToRead.push(filePath);
		}

		pathToItemMap.set(filePath, fileItem);
		fileTree.set(filePath, fileItem);
	}

	const fileContents = await readFilesBatch(containerId, filesToRead);

	for (const [filePath, content] of fileContents) {
		const fileItem = pathToItemMap.get(filePath);
		if (fileItem) {
			fileItem.content = content;
		}
	}

	for (const fileItem of pathToItemMap.values()) {
		const parentPath = fileItem.path.substring(
			0,
			fileItem.path.lastIndexOf("/")
		);
		const parent = fileTree.get(parentPath || containerPath);
		if (parent && parent.children) {
			parent.children.push(fileItem);
		}
	}

	const root = fileTree.get(containerPath);
	return root?.children || [];
}

async function readFilesBatch(
	containerId: string,
	filePaths: string[]
): Promise<Map<string, string>> {
	const results = new Map<string, string>();
	const batchSize = 50;

	for (let i = 0; i < filePaths.length; i += batchSize) {
		const batch = filePaths.slice(i, i + batchSize);
		const batchPromises = batch.map(async (filePath) => {
			try {
				const content = await readFile(containerId, filePath);
				return [filePath, content] as [string, string];
			} catch (error) {
				return [
					filePath,
					`Error reading file: ${error instanceof Error ? error.message : "Unknown error"
					}`,
				] as [string, string];
			}
		});

		const batchResults = await Promise.all(batchPromises);
		for (const [filePath, content] of batchResults) {
			results.set(filePath, content);
		}
	}

	return results;
}

async function getFileStat(
	containerId: string,
	filePath: string
): Promise<{ isDirectory: boolean }> {
	try {
		const output = await execInContainer(
			containerId,
			`stat -c "%F" "${filePath}"`
		);
		return {
			isDirectory: output.trim().includes("directory"),
		};
	} catch {
		return { isDirectory: false };
	}
}

export async function readFile(
	containerId: string,
	filePath: string
): Promise<string> {
	const output = await execInContainer(
		containerId,
		`cat "${filePath}" | head -c 10000000`
	);
	const cleanContent = output.replace(/^\uFEFF/, "");
	return cleanContent;
}

export async function listFiles(
	containerId: string,
	containerPath: string = BASE_PATH
): Promise<any[]> {
	const output = await execInContainer(
		containerId,
		`ls -la "${containerPath}"`
	);

	const lines = output.trim().split("\n");
	return lines
		.slice(1)
		.map((line) => {
			const parts = line.trim().split(/\s+/);
			const permissions = parts[0];
			const isDirectory = permissions!.startsWith("d");
			const name = parts.slice(8).join(" ");

			return {
				name,
				type: isDirectory ? "directory" : "file",
				permissions,
				size: parts[4],
				modified: `${parts[5]} ${parts[6]} ${parts[7]}`,
			};
		})
		.filter((item) => item.name !== "." && item.name !== "..");
}

export async function writeFile(
	containerId: string,
	filePath: string,
	content: string
): Promise<void> {
	console.log(`Writing file: ${filePath} (${content.length} characters)`);

	const tempFile = `/tmp/file-${uuidv4()}`;

	try {
		await fs.writeFile(tempFile, content, "utf8");
		console.log(`Temporary file created: ${tempFile}`);

		const absolutePath = getAbsolutePath(filePath);
		console.log(`Target path: ${absolutePath}`);

		try {
			const copyCommand = `podman cp "${tempFile}" "${containerId}:${absolutePath}"`;
			console.log(`Executing: ${copyCommand}`);
			const { stdout, stderr } = await execAsync(copyCommand);

			if (stderr) {
				console.log(`Copy stderr: ${stderr}`);
			}
			if (stdout) {
				console.log(`Copy stdout: ${stdout}`);
			}

			console.log("File copied successfully");
		} catch (copyError) {
			console.log("Copy failed, trying to create directory first:", copyError);

			const dirPath = absolutePath.substring(0, absolutePath.lastIndexOf("/"));
			const createDirCommand = `podman exec "${containerId}" mkdir -p "${dirPath}"`;
			console.log(`Executing: ${createDirCommand}`);

			await execAsync(createDirCommand);
			console.log("Directory created");

			const retryCommand = `podman cp "${tempFile}" "${containerId}:${absolutePath}"`;
			console.log(`Retrying: ${retryCommand}`);

			const { stdout, stderr } = await execAsync(retryCommand);
			if (stderr) {
				console.log(`Retry stderr: ${stderr}`);
			}
			if (stdout) {
				console.log(`Retry stdout: ${stdout}`);
			}

			console.log("File copied successfully on retry");
		}

		try {
			const verifyCommand = `podman exec "${containerId}" head -n 5 "${absolutePath}"`;
			const { stdout: verifyOutput } = await execAsync(verifyCommand);
			console.log(`File verification (first 5 lines):\n${verifyOutput}`);
		} catch (verifyError) {
			console.log("Could not verify file content:", verifyError);
		}

		await fs.unlink(tempFile);
		console.log("Temporary file cleaned up");
	} catch (error) {
		console.error("Write file error:", error);
		try {
			await fs.unlink(tempFile);
		} catch (unlinkError) {
			console.error("Failed to clean up temp file:", unlinkError);
		}
		throw error;
	}
}

export async function renameFile(
	containerId: string,
	oldPath: string,
	newPath: string
): Promise<void> {
	const absoluteOldPath = getAbsolutePath(oldPath);
	const absoluteNewPath = getAbsolutePath(newPath);

	const newDir = absoluteNewPath.substring(0, absoluteNewPath.lastIndexOf("/"));
	const createDirCommand = `podman exec "${containerId}" mkdir -p "${newDir}"`;
	await execAsync(createDirCommand);

	const moveCommand = `podman exec "${containerId}" mv "${absoluteOldPath}" "${absoluteNewPath}"`;
	await execAsync(moveCommand);
}

export async function removeFile(
	containerId: string,
	filePath: string
): Promise<void> {
	const absolutePath = getAbsolutePath(filePath);
	const removeCommand = `podman exec "${containerId}" rm -rf "${absolutePath}"`;
	await execAsync(removeCommand);
}
