import "./local-server-runtime.mjs";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const { EXAM_CATEGORIES } = await import("../src/domain/exam-catalog.ts");
const { learningContentSchema } = await import("../src/domain/learning-content.ts");
const read = (name) =>
  JSON.parse(readFileSync(new URL(`../src/domain/${name}.json`, import.meta.url), "utf8"));
const originals = read("study-collection").entries;
const references = read("certificate-knowledge").entries;
const notices = read("campus-notices");
const keys = new Set(),
  texts = new Set();
for (const record of originals) {
  const content = learningContentSchema.parse(record.content);
  const expected = createHash("sha256")
    .update(`study-collection:${record.key}`)
    .digest("hex")
    .slice(0, 32);
  if (
    content.url !== `/learn/${expected}` ||
    content.text.length < 150 ||
    keys.has(record.key) ||
    texts.has(content.text)
  )
    throw new Error(`内容不符合独立原创资料约束：${record.key}`);
  keys.add(record.key);
  texts.add(content.text);
}
for (const record of references) learningContentSchema.parse(record.content);
const categories = [...new Set(originals.map((record) => record.content.category))];
const coverage = categories.map((category) => {
  const items = originals.filter((record) => record.content.category === category);
  return {
    category,
    label: EXAM_CATEGORIES.find((item) => item[0] === category)?.[1],
    resources: items.length,
    formats: [...new Set(items.map((item) => item.content.format))],
    subjects: [...new Set(items.map((item) => item.content.subject))],
  };
});
const examPacks = coverage.filter((row) => row.category !== "education-local");
if (examPacks.length < 20 || examPacks.some((row) => row.resources < 5 || row.formats.length < 3))
  throw new Error("考试资料包覆盖不足。");
console.log(
  JSON.stringify(
    {
      scope: "仅审计仓库公共内容快照，不访问现用用户数据库；数量不代表独立教学质量验收。",
      examDirectory: EXAM_CATEGORIES.length,
      originalResources: originals.length,
      examResources: examPacks.reduce((sum, row) => sum + row.resources, 0),
      certificateOverviewReferences: references.length,
      coverage,
      campus: {
        notices: notices.length,
        schools: [...new Set(notices.map((item) => item.schoolId))],
        sources: [...new Set(notices.map((item) => `${item.schoolId}:${item.department}`))],
      },
      exclusions: [
        "官网首页导航不计学习资料包",
        "公开通知不计学习资源",
        "个人导入不计公共内容",
        "原创微课不冒充外部完整课程或官方真题",
      ],
      pending: [
        "独立人工教学质量抽审",
        "三校真实学生端到端试用",
        "TCF/CCNA/华为/CMA/C2候选细目实源核验",
      ],
    },
    null,
    2,
  ),
);
