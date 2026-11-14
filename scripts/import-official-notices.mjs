import "./local-server-runtime.mjs";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
const args = process.argv.slice(2);
if (
  args.some(
    (arg) =>
      !["--apply", "--data-dir", "--batch"].includes(arg) &&
      !["--data-dir", "--batch"].includes(args[args.indexOf(arg) - 1]),
  )
)
  throw new Error("仅支持 --apply、--data-dir <目录> 和 --batch initial|expansion。");
const batchName = args.includes("--batch") ? args[args.indexOf("--batch") + 1] : "initial";
if (!["initial", "expansion"].includes(batchName))
  throw new Error("批次仅支持 initial 或 expansion。");
const batchFile =
  batchName === "initial"
    ? "official-notices-2026-11-14.json"
    : "official-notices-expansion-2026-11-14.json";
if (args.includes("--data-dir")) {
  const directory = args[args.indexOf("--data-dir") + 1];
  if (!directory || directory.startsWith("--")) throw new Error("缺少数据目录。");
  process.env.REVIEW_DATA_DIR = resolve(directory);
}
const {
  noticeInputSchema,
  sources,
  officialUrl,
  validatePublication,
  saveDraft,
  notice,
  publishNotice,
} = await import("../src/lib/server/exam-store.ts");
const { platformDb, platformDirectory } = await import("../src/lib/server/platform-db.ts");
const { digest } = await import("../src/lib/server/account-auth.ts");
const batch = z
  .array(
    z.object({ url: z.url(), verifiedAt: z.iso.datetime(), content: noticeInputSchema }).strict(),
  )
  .min(1)
  .max(100)
  .parse(JSON.parse(readFileSync(new URL(`../data/${batchFile}`, import.meta.url), "utf8")));
const approvedHosts = new Map([
  ["cet.neea.edu.cn", "大学英语四六级考试官网"],
  ["ncre.neea.edu.cn", "全国计算机等级考试官网"],
  ["ntce.neea.edu.cn", "中小学教师资格考试官网"],
  ["pets.neea.edu.cn", "全国英语等级考试官网"],
  ["ccpt.neea.edu.cn", "书画等级考试官网"],
  ["wsk.neea.edu.cn", "全国外语水平考试官网"],
  ["nit.neea.edu.cn", "全国计算机应用水平考试官网"],
  ["www.ruankao.org.cn", "中国计算机技术职业资格网"],
  ["yz.chsi.com.cn", "中国研究生招生信息网"],
  ["kzp.mof.gov.cn", "财政部会计财务评价中心"],
  ["www.cicpa.org.cn", "中国注册会计师协会"],
  ["www.catticenter.com", "全国翻译人才评价网"],
]);
const urls = new Set();
for (const item of batch) {
  const host = new URL(item.url).hostname;
  if (!approvedHosts.has(host)) throw new Error("未核验的官方主机。");
  officialUrl(item.url, { url: `https://${host}/` });
  if (urls.has(item.url)) throw new Error("批次含重复链接。");
  urls.add(item.url);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(item.content.publishedAt) ||
    Date.parse(item.content.publishedAt) > Date.now()
  )
    throw new Error("发布日期异常。");
  validatePublication(item.content);
}
if (!args.includes("--apply")) {
  console.log(
    JSON.stringify(
      { mode: "preview", count: batch.length, titles: batch.map((item) => item.content.title) },
      null,
      2,
    ),
  );
} else {
  const db = platformDb();
  const backupDirectory = resolve(platformDirectory(), "backups");
  mkdirSync(backupDirectory, { recursive: true });
  const backupPath = resolve(backupDirectory, `before-official-import-${Date.now()}.sqlite`);
  await db.backup(backupPath);
  const actor = "local-reviewed-import:2026-11-14";
  const result = db.transaction(() => {
    const registered = sources();
    let added = 0;
    let skipped = 0;
    for (const item of batch) {
      const host = new URL(item.url).hostname;
      let source = registered.find((source) => new URL(source.url).hostname === host);
      if (!source) {
        const url = `https://${host}/`;
        const id = digest(url).slice(0, 24);
        db.prepare("INSERT INTO exam_sources(id,name,url,category,region) VALUES (?,?,?,?,?)").run(
          id,
          approvedHosts.get(host),
          url,
          item.content.category,
          "全国",
        );
        source = { id, url };
        registered.push(source);
      }
      const existing = db
        .prepare("SELECT id FROM exam_notices WHERE source_id=? AND canonical_url=?")
        .get(source.id, item.url);
      // A curated bootstrap must never replace an editor's existing version or republish withdrawn content.
      if (existing) {
        skipped++;
        continue;
      }
      const draft = saveDraft(source.id, item.url, item.content, actor);
      const saved = notice(draft.id, false);
      publishNotice(draft.id, actor, false, saved.version);
      added++;
    }
    return { added, skipped };
  })();
  console.log(JSON.stringify({ mode: "applied", ...result, backupPath }, null, 2));
}
