import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function exportContainerCode(
  containerId: string
): Promise<Buffer> {
  const tempDir = `/tmp/export-${containerId}-${Date.now()}`;
  const zipPath = `${tempDir}.zip`;

  try {
    await fs.mkdir(tempDir, { recursive: true });

    const copyCommand = `podman cp ${containerId}:/app/my-nextjs-app/. ${tempDir}/`;
    await execAsync(copyCommand);

    const nodeModulesPath = path.join(tempDir, "node_modules");
    const nextPath = path.join(tempDir, ".next");

    try {
      await fs.rm(nodeModulesPath, { recursive: true, force: true });
    } catch {}

    try {
      await fs.rm(nextPath, { recursive: true, force: true });
    } catch {}

    const zipCommand = `cd ${tempDir} && zip -r ${zipPath} . -x "*.DS_Store"`;
    await execAsync(zipCommand);

    const zipBuffer = await fs.readFile(zipPath);

    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.rm(zipPath, { force: true });

    return zipBuffer;
  } catch (error) {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
      await fs.rm(zipPath, { force: true });
    } catch {}

    throw new Error(
      `Export failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
