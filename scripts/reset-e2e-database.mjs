import { mkdirSync, rmSync, lstatSync, existsSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localDataDirectory = resolve(projectDirectory, ".local-data");
const testDataDirectory = resolve(localDataDirectory, "e2e");
const allowedParent = localDataDirectory + sep;

if (!testDataDirectory.startsWith(allowedParent)) {
  throw new Error("The E2E database path is outside the test data directory.");
}

if (existsSync(localDataDirectory)) {
  const parentInfo = lstatSync(localDataDirectory);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) {
    throw new Error("The local data path must be a real directory.");
  }
} else {
  mkdirSync(localDataDirectory);
}

mkdirSync(testDataDirectory, { recursive: true });
const directoryInfo = lstatSync(testDataDirectory);
if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
  throw new Error("The E2E data path must be a real directory.");
}

for (const fileName of ["reviews.sqlite", "reviews.sqlite-shm", "reviews.sqlite-wal"]) {
  const databaseFile = resolve(testDataDirectory, fileName);
  if (existsSync(databaseFile)) {
    const fileInfo = lstatSync(databaseFile);
    if (!fileInfo.isFile()) {
      throw new Error("The E2E database files must be regular files.");
    }
    rmSync(databaseFile);
  }
}
