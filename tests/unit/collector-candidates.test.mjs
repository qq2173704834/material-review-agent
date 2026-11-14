import { test } from "node:test";
import assert from "node:assert/strict";
import { collectorCandidates } from "../../src/lib/collector-candidates.ts";

test("NEEA目录、静态说明和查询入口不是公告详情，重复锚点只采一遍", () => {
  const source = { url: "https://dele.neea.cn/", category: "dele" };
  const link = (path, name = "2026年考试报名通知") => ({
    url: new URL(path, source.url).href,
    name,
  });
  const links = [
    link("/html1/category/1610/4-1.htm"),
    link("/html1/folder/1507/1-1.htm"),
    link("/"),
    link("/html1/report/2609/31-1.htm#first"),
    link("/html1/report/2609/31-1.htm#second"),
    link("/html1/report/2609/a.pdf"),
    { url: "https://other.neea.cn/html1/report/2609/1.htm", name: "考试通知" },
    link("/html1/report/2609/99.htm", "采购通知"),
  ];
  assert.deepEqual(
    collectorCandidates(links, source).map((item) => item.url),
    ["https://dele.neea.cn/html1/report/2609/31-1.htm"],
  );
});
test("其他来源保留其真实文章路径，综合来源过滤低学龄公告，抓取范围最多8条", () => {
  const source = { url: "https://yz.chsi.com.cn/", category: "graduate" };
  const links = Array.from({ length: 12 }, (_, i) => ({
    url: `https://yz.chsi.com.cn/kyzx/2026/${i}.shtml`,
    name: "硕士研究生招生公告",
  }));
  assert.equal(collectorCandidates(links, source).length, 8);
  assert.equal(
    collectorCandidates(
      [...links, { url: "https://yz.chsi.com.cn/a.html", name: "普通高考通知" }],
      { ...source, category: "education-local" },
    ).length,
    8,
  );
  assert.deepEqual(
    collectorCandidates([{ url: "https://yz.chsi.com.cn/a.html", name: "普通高考通知" }], source),
    [],
  );
});
