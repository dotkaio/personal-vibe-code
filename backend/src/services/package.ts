import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const BASE_PATH = "/app/my-nextjs-app";

export async function addDependency(
  containerId: string,
  packageName: string,
  isDev: boolean = false
): Promise<string> {
  const devFlag = isDev ? "--dev" : "";
  const addCommand =
    `podman exec -w ${BASE_PATH} ${containerId} bun add ${packageName} ${devFlag}`.trim();

  const { stdout, stderr } = await execAsync(addCommand);
  return stdout || stderr;
}
