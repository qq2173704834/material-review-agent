import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const allowedTypes = "feat|fix|refactor|perf|docs|test|style|build|ci|chore";
const titlePattern = new RegExp(
  `^\\[(${allowedTypes})\\(((?:T|S|R|Q|M|C|A|O|V|E|N)\\d{2}|ENG-\\d{3}|BUG-\\d{3})\\)\\]: (?=.*[\\u3400-\\u9fff]).+$`,
);

/** 支持项目自定义格式；编号是否真实存在由文档追踪与提交审查核实。 */
export function validateCommitMessage(message) {
  const errors = [];
  const lines = message.replace(/\r\n/g, "\n").trimEnd().split("\n");

  if (!titlePattern.test(lines[0] ?? "")) {
    errors.push("标题须为 [类型(真实编号)]: 中文摘要，例如 [build(ENG-002)]: 初始化工程");
  }
  if (lines[1] !== "") {
    errors.push("标题与正文之间必须空一行。");
  }

  let previousFieldIndex = 1;
  for (const field of ["目的：", "变更：", "验证："]) {
    const fieldIndex = lines.findIndex((line) => line.startsWith(field));
    if (fieldIndex <= previousFieldIndex) {
      errors.push(`正文缺少或未按顺序提供 ${field}`);
      continue;
    }
    const nextFieldIndex = lines.findIndex(
      (line, index) => index > fieldIndex && /^(目的|变更|验证)：/.test(line),
    );
    const fieldContent = [
      lines[fieldIndex].slice(field.length),
      ...lines.slice(fieldIndex + 1, nextFieldIndex === -1 ? undefined : nextFieldIndex),
    ].join("\n");
    if (!fieldContent.trim()) {
      errors.push(`${field} 不能为空。`);
    }
    previousFieldIndex = fieldIndex;
  }

  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const messagePath = process.argv[2];
  if (!messagePath) {
    console.error("用法：pnpm commit:check <提交信息文件>");
    process.exitCode = 1;
  } else {
    try {
      const errors = validateCommitMessage(readFileSync(messagePath, "utf8"));
      if (errors.length > 0) {
        console.error(errors.join("\n"));
        process.exitCode = 1;
      }
    } catch {
      console.error("无法读取提交信息文件。");
      process.exitCode = 1;
    }
  }
}
