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

test("省级导航目录不作为公告，已知文章保留且同源HTTPS详情实际核验", () => {
  const examples = [
    ["www.ynzs.cn", "/html/content/8795.html", "/html/web/zkdt-yjsks/index.html"],
    ["www.bjeea.cn", "/html/yk/tzgg/2026/1007/88385.html", "/html/yk/index.html"],
    ["www.sceea.cn", "/Html/202610/Newsdetail_4995.html", "/Html/ExamEnrollment.html"],
    ["eea.gd.gov.cn", "/news/content/post_4971623.html", "/yjsks/index.html"],
    ["www.xjzk.gov.cn", "/c/2026-11-02/496323.shtml", "/jszgks/"],
    ["www.hebeea.edu.cn", "/c/2026-11-03/493840.html", "/qgjsjdj/"],
    ["www.hbea.edu.cn", "/html/2026-11/16239.shtml", "/html/gre/index.html"],
    ["zsksy.guizhou.gov.cn", "/tzgg/202611/t20261103_91066898.html", "/yjsks/"],
    ["www.lnzsks.com", "/newsinfo/IMS_20261008_46522_B4cltDL2xk.htm", "/listinfo/zxks_1.html"],
    ["www.sneea.cn", "/info/1043/17769.htm", "/zc/jsjdjks.htm"],
    ["www.qhjyks.com", "/ztzl/yjsksz/5935.htm", "/ztzl/yjsksz/"],
    ["www.lzk.hl.cn", "/ykpd/202610/t20261008_19993.htm", "/ykpd/"],
  ];
  for (const [host, article, navigation] of examples) {
    const source = { url: `https://${host}/`, category: "education-local" };
    const links = [article, navigation].map((path) => ({
      url: `http://${host}${path}`,
      name: "研究生考试通知",
    }));
    assert.deepEqual(
      collectorCandidates(links, source).map((x) => x.url),
      [`https://${host}${article}`],
      host,
    );
  }
  assert.deepEqual(
    collectorCandidates([{ url: "https://www.jxeea.cn/yjsks89/list.html", name: "研究生考试" }], {
      url: "https://www.jxeea.cn/",
      category: "education-local",
    }),
    [],
  );
});
