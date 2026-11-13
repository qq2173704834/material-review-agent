import type { ReviewCheckResult, ReviewMaterialSummary } from "@/domain/review";
type Comparison = Pick<ReviewCheckResult, "verdict" | "reason" | "recommendation" | "evidence">;
export function compareRepositoryRule(
  description: string,
  materials: ReviewMaterialSummary[],
): Comparison | undefined {
  if (
    !/README|配置模板|依赖清单|package\.json|requirements\.txt|\.env\.example/i.test(description) ||
    !/提供|包含|提交|具备|存在/.test(description) ||
    /运行步骤|正确|安全|安装成功|可复现|完整|可用|可运行|版本/.test(description)
  )
    return;
  const repositories = materials.filter((material) => {
    try {
      return (
        material.parserName === "public-link" &&
        (JSON.parse(material.segments[0]?.text ?? "{}") as { repository?: boolean }).repository ===
          true
      );
    } catch {
      return false;
    }
  });
  if (!repositories.length) return;
  const groups: string[][] = [];
  if (/README/i.test(description)) groups.push(["README"]);
  if (/配置模板|\.env\.example/.test(description)) groups.push([".env.example"]);
  if (/依赖清单/.test(description)) groups.push(["package.json", "requirements.txt"]);
  else {
    if (/package\.json/i.test(description)) groups.push(["package.json"]);
    if (/requirements\.txt/i.test(description)) groups.push(["requirements.txt"]);
  }
  const evidence: Comparison["evidence"] = [];
  const missing: string[] = [];
  const unknown: string[] = [];
  for (const material of repositories)
    for (const alternatives of groups) {
      const segments = material.segments.filter((segment) =>
        alternatives.some((name) =>
          new RegExp(
            "^仓库文件 " +
              (name === "README"
                ? "readme(?:\\.[^ ]+)?"
                : name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) +
              " · ",
            "i",
          ).test(segment.location),
        ),
      );
      const successful = segments.find((segment) => segment.location.includes(" · blob "));
      if (successful)
        evidence.push({
          materialId: material.id,
          materialVersion: material.version,
          location: successful.location,
          segmentIndex: successful.segmentIndex,
          quotedText: successful.text.slice(0, 2000),
        });
      else if (
        alternatives.every((name) =>
          segments.some((segment) => segment.location === `仓库文件 ${name} · HTTP 404`),
        )
      ) {
        missing.push(`${material.originalFileName}：${alternatives.join("或")}`);
        for (const segment of segments)
          evidence.push({
            materialId: material.id,
            materialVersion: material.version,
            location: segment.location,
            segmentIndex: segment.segmentIndex,
            quotedText: segment.text,
          });
      } else unknown.push(`${material.originalFileName}：${alternatives.join("或")}`);
    }
  return {
    verdict: missing.length ? "failed" : unknown.length ? "needs_confirmation" : "passed",
    reason: missing.length
      ? "公开内容接口在记录时间未找到要求的仓库文件：" + missing.join("；")
      : unknown.length
        ? "部分文件受限或读取失败，未据此判定缺失：" + unknown.join("；")
        : "已读取要求的仓库文件并记录blob版本；仅核验资料存在，不运行仓库代码，也不证明安装、配置或运行成功。",
    recommendation: missing.length
      ? "补齐要求的文件后重新读取仓库并复检。"
      : unknown.length
        ? "核对公开权限并重新读取，或直接上传对应文件。"
        : "",
    evidence,
  };
}
