import { createFullBackup, verifyFullBackup, restoreFullBackup } from "./lib/full-backup.mjs";
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
try {
  let result;
  if (args[0] === "backup" && option("data-dir") && option("dest"))
    result = createFullBackup(option("data-dir"), option("dest"));
  else if (args[0] === "verify" && option("backup")) {
    const manifest = verifyFullBackup(option("backup"));
    result = { valid: true, fileCount: manifest.entries.length, createdAt: manifest.createdAt };
  } else if (args[0] === "restore" && option("backup") && option("target"))
    result = restoreFullBackup(option("backup"), option("target"));
  else
    throw new Error(
      "用法：backup --data-dir 数据目录 --dest 独立目的地 | verify --backup 快照目录 | restore --backup 快照目录 --target 不存在的新目录",
    );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "备份操作失败。");
  process.exitCode = 1;
}
