import type { ReviewCheckResult, ReviewMaterialSummary } from "@/domain/review";

export function compareVideoRule(
  description: string,
  materials: ReviewMaterialSummary[],
): Pick<ReviewCheckResult, "verdict" | "reason" | "recommendation" | "evidence"> | undefined {
  if (!/视频|录像|演示片/.test(description) || !/时长|分辨率|格式/.test(description))
    return undefined;
  const videos = materials.filter(
    (material) => material.parserName === "ffprobe-ffmpeg-sampled-ocr",
  );
  if (!videos.length)
    return {
      verdict: "needs_confirmation",
      reason: "没有可读取规格的视频材料。",
      recommendation: "上传有效MP4/WebM/MOV后复检。",
      evidence: [],
    };
  const evidence = videos.map((material) => ({
    materialId: material.id,
    materialVersion: material.version,
    location: material.segments[0]!.location,
    segmentIndex: 0,
    quotedText: material.segments[0]!.text,
  }));
  const records = videos.map(
    (material) =>
      JSON.parse(material.segments[0]!.text) as {
        durationSeconds: number;
        width: number;
        height: number;
      },
  );
  const limit = description.match(
    /(不超过|不得超过|最多|至多|至少|不少于|小于|大于|恰好)\s*(\d+(?:\.\d+)?)\s*(分钟|秒|分)/,
  );
  const resolution = description.match(/(\d{2,5})\s*[×xX*]\s*(\d{2,5})/);
  const format = description.match(/MP4|WEBM|MOV/gi);
  const checks: boolean[] = [];
  if (limit) {
    const value = Number(limit[2]) * (limit[3] === "秒" ? 1 : 60);
    for (const record of records) {
      const actual = record.durationSeconds;
      checks.push(
        ["至少", "不少于"].includes(limit[1]!)
          ? actual >= value
          : limit[1] === "小于"
            ? actual < value
            : limit[1] === "大于"
              ? actual > value
              : limit[1] === "恰好"
                ? Math.abs(actual - value) < 0.05
                : actual <= value,
      );
    }
  }
  if (resolution)
    for (const record of records)
      checks.push(
        /至少|不低于|不少于/.test(description)
          ? record.width >= Number(resolution[1]) && record.height >= Number(resolution[2])
          : record.width === Number(resolution[1]) && record.height === Number(resolution[2]),
      );
  if (format)
    for (const video of videos)
      checks.push(format.some((item) => item.toLowerCase() === video.extension));
  if (!checks.length)
    return {
      verdict: "needs_confirmation",
      reason: "视频规格已读取，但要求未能转换为明确时长/分辨率/格式比较。",
      recommendation: "明确边界或人工核对。",
      evidence,
    };
  const passes = checks.every(Boolean);
  return {
    verdict: passes ? "passed" : "failed",
    reason: `ffprobe读取：${records.map((record) => `${record.durationSeconds}秒，${record.width}×${record.height}`).join("；")}；与明确要求比较${passes ? "符合" : "不符合"}。此项只核验规格，不评价视频内容。`,
    recommendation: passes ? "" : "按要求调整视频规格后复检。",
    evidence,
  };
}
