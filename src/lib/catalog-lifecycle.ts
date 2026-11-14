interface CatalogRecord {
  id: string;
  version: number;
  status: string;
  content: {
    kind: string;
    category: string;
    region: string;
    disposition: string;
    catalogStatus?: string;
    catalogEffectiveAt?: string;
    renamedTo?: string;
    title: string;
    url: string;
    checkedAt: string;
  };
}
export function catalogLifecycle(
  records: readonly CatalogRecord[],
  category: string,
  region = "全国",
  day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10),
): {
  label: string;
  blocked: boolean;
  evidence: CatalogRecord[];
} {
  const evidence = records.filter(
    (entry) =>
      entry.status === "published" &&
      entry.content.kind === "knowledge" &&
      entry.content.category === category &&
      (entry.content.region === "全国" || entry.content.region === region) &&
      entry.content.disposition === "现行" &&
      entry.content.catalogStatus &&
      entry.content.catalogEffectiveAt &&
      entry.content.catalogEffectiveAt <= day,
  );
  const states = new Set(evidence.map((entry) => entry.content.catalogStatus));
  if (!evidence.length)
    return { label: "举办状态待逐项核对，以当期官方通知为准", blocked: false, evidence };
  if (states.size > 1)
    return { label: "目录状态依据存在冲突，待管理员核实", blocked: true, evidence };
  const status = evidence[0]!.content.catalogStatus!;
  return {
    label:
      status === "更名"
        ? `已更名：${evidence[0]!.content.renamedTo || "新名称待核对"}`
        : `目录状态：${status}`,
    blocked: status !== "举办" && status !== "更名",
    evidence,
  };
}
