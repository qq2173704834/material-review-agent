import "server-only";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";

export async function readStoredMaterial(taskId: string, storageKey: string): Promise<Buffer> {
  const root = resolve(
    process.env.REVIEW_DATA_DIR?.trim() || resolve(process.cwd(), ".local-data"),
  );
  const directory = await realpath(resolve(root, "materials", taskId));
  const path = await realpath(resolve(root, storageKey));
  if (!path.startsWith(directory + sep)) throw new Error("Invalid material location");
  return readFile(path);
}
