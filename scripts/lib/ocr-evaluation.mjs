export function editDistance(reference, prediction) {
  const left = Array.from(reference.normalize("NFC")),
    right = Array.from(prediction.normalize("NFC"));
  if (left.length > 2000 || right.length > 2000)
    throw new Error("每个标注区域不得超过2000个字符，请拆分区域。");
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    const current = [row];
    for (let column = 1; column <= right.length; column++)
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    previous = current;
  }
  return previous[right.length];
}
export function evaluateOcr(dataset) {
  const categories = ["printed", "complex_layout", "low_quality", "handwritten"];
  if (
    dataset.format !== 1 ||
    !Array.isArray(dataset.samples) ||
    !dataset.samples.length ||
    dataset.samples.length > 1000
  )
    throw new Error("标注集格式无效。");
  const ids = new Set(),
    groups = {},
    samples = [];
  for (const sample of dataset.samples) {
    if (
      !sample.id ||
      ids.has(sample.id) ||
      !categories.includes(sample.category) ||
      typeof sample.source !== "string" ||
      !sample.source ||
      typeof sample.authorization !== "string" ||
      !sample.authorization ||
      typeof sample.annotator !== "string" ||
      !sample.annotator ||
      !Array.isArray(sample.regions) ||
      !sample.regions.length ||
      sample.regions.length > 200 ||
      !Array.isArray(sample.keyFields) ||
      sample.keyFields.length > 200 ||
      !Number.isFinite(sample.elapsedMs) ||
      sample.elapsedMs < 0
    )
      throw new Error("样本缺少唯一编号、来源/授权、标注者、区域或耗时。");
    ids.add(sample.id);
    const counts = {
      samples: 1,
      referenceCharacters: 0,
      characterErrors: 0,
      regions: sample.regions.length,
      missedRegions: 0,
      keyFields: sample.keyFields.length,
      exactKeyFields: 0,
      elapsedMs: sample.elapsedMs,
    };
    for (const region of sample.regions) {
      if (
        typeof region.reference !== "string" ||
        !region.reference ||
        typeof region.prediction !== "string"
      )
        throw new Error("区域标注无效。");
      counts.referenceCharacters += Array.from(region.reference.normalize("NFC")).length;
      counts.characterErrors += editDistance(region.reference, region.prediction);
      if (!region.prediction.trim()) counts.missedRegions++;
    }
    for (const field of sample.keyFields) {
      if (
        typeof field.reference !== "string" ||
        !field.reference ||
        typeof field.prediction !== "string" ||
        typeof field.name !== "string" ||
        !field.name
      )
        throw new Error("关键字段标注无效。");
      if (field.reference === field.prediction) counts.exactKeyFields++;
    }
    const aggregate = (groups[sample.category] ??= {
      samples: 0,
      referenceCharacters: 0,
      characterErrors: 0,
      regions: 0,
      missedRegions: 0,
      keyFields: 0,
      exactKeyFields: 0,
      elapsedMs: 0,
    });
    for (const key of Object.keys(counts)) aggregate[key] += counts[key];
    samples.push({
      id: sample.id,
      category: sample.category,
      source: sample.source,
      authorization: sample.authorization,
      annotator: sample.annotator,
      counts,
    });
  }
  for (const group of Object.values(groups)) {
    group.characterErrorRate = group.characterErrors / group.referenceCharacters;
    group.keyFieldExactRate = group.keyFields ? group.exactKeyFields / group.keyFields : null;
    group.missedRegionRate = group.missedRegions / group.regions;
    group.meanElapsedMs = group.elapsedMs / group.samples;
  }
  return {
    format: 1,
    createdAt: new Date().toISOString(),
    labelOrigin: dataset.labelOrigin ?? "未声明独立性",
    qualityGate: "待独立样本和业务门槛确认；本工具只计算观测值",
    normalization: "CER仅NFC规范化；关键字段逐字精确匹配，不删空白",
    groups,
    samples,
  };
}
