import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  campusArticle,
  campusArticleTitle,
  campusPublicationDate,
} from "../../src/lib/campus-article.ts";
import { campusSourceLinks } from "../../src/lib/campus-source-links.ts";
import { CAMPUS_SOURCES, CAMPUS_SCHOOLS } from "../../src/domain/campus-schools.ts";

test("北大通知按PHP查询ID区分且仅接受登记同源，不跟随外链、登录链接或任意路径", () => {
  const source = CAMPUS_SOURCES.find((item) => item.id === "pku-dean");
  const url = "https://dean.pku.edu.cn/web/notice_details.php?id=773";
  assert.deepEqual(
    campusSourceLinks(
      [
        { url, name: "真实路由样式" },
        { url: url + "#article", name: "重复锚点" },
        { url: url.replace("773", "772"), name: "另一个ID" },
        { url: url.replace("https:", "http:"), name: "不降级" },
        { url: "https://attacker.example/web/notice_details.php?id=773", name: "站外" },
        {
          url: "https://user:password@dean.pku.edu.cn/web/notice_details.php?id=773",
          name: "凭据",
        },
        { url: "https://dean.pku.edu.cn/web/login.php", name: "登录" },
        {
          url: "https://dean.pku.edu.cn/web/notice_details.php?id=773&redirect=https://attacker.example",
          name: "未登记参数",
        },
      ],
      source,
    ),
    [url, url.replace("773", "772")],
  );
  assert.equal(
    campusSourceLinks(
      Array.from({ length: 30 }, (_, id) => ({
        url: url.replace("773", String(id)),
        name: "限量",
      })),
      source,
    ).length,
    10,
  );
});

test("北大正文和日期取自文章容器，不把正文中的考试日期当发布日期", () => {
  const html =
    '<h1>网站导航</h1><title>站点</title><div class="newsinfo_box"><h1>报名通知</h1><span>2026-11-06</span><p>本次考试安排在2026-12-12，请按通知完成报名并准备材料。</p></div><footer>无关页脚</footer>';
  assert.equal(campusArticleTitle(html, "pku"), "报名通知");
  assert.equal(
    campusPublicationDate(html, "https://dean.pku.edu.cn/web/notice_details.php?id=773", "pku"),
    "2026-11-06",
  );
  assert.ok(!campusArticle(html, "pku").includes("无关页脚"));
  assert.throws(() =>
    campusPublicationDate(
      html.replace("<span>2026-11-06</span>", ""),
      "https://school.edu.cn/2026/1115/x",
      "pku",
    ),
  );
});

test("VSB与WordPress适配保留原发布日期，不采用正文安排、修改日期或采集日期", () => {
  const vsb =
    '<meta content="2026-11-11 14:36" name="PubDate"><meta name="ArticleTitle" content="期末考试安排"><div class="v_news_content"><p>2027年1月3日至16日为期末复习考试时间，请各学院做好安排。</p></div>';
  assert.equal(campusArticleTitle(vsb, "vsb"), "期末考试安排");
  assert.equal(
    campusPublicationDate(vsb, "https://school.edu.cn/info/1520/1.htm", "vsb"),
    "2026-11-11",
  );
  assert.ok(campusArticle(vsb, "vsb").includes("期末复习考试"));
  const wordpress =
    '<div class="single-title"><h1>竞赛申报通知</h1><div>其他元信息</div></div><article class="post"><p>竞赛成果申报需要提交相关证明，请在规定时间内完成。</p></article><li class="meta-last-modified">2026-11-15</li><li class="meta-date">2026-11-13 10:00</li><aside>相关推荐</aside>';
  assert.equal(campusArticleTitle(wordpress, "ustc"), "竞赛申报通知");
  assert.equal(
    campusPublicationDate(wordpress, "https://school.edu.cn/notice/notice-info/1.html", "ustc"),
    "2026-11-13",
  );
  assert.ok(!campusArticle(wordpress, "ustc").includes("相关推荐"));
  assert.throws(() =>
    campusPublicationDate(
      wordpress.replace('class="meta-date"', 'class="unknown"'),
      "https://school.edu.cn/x",
      "ustc",
    ),
  );
});

test("Drupal只读取文章节点下的正文，不把共用field-body横幅当通知；非法日期拒绝", () => {
  const html =
    '<div class="field-body">横幅内容，必须排除。</div><div class="node--type-article"><div class="article-title"><h1>四六级通知</h1></div><span class="article-date">发布日期：2026-09-13</span><div class="field-body"><p>四六级报名通知：请符合条件的同学按学校安排完成报名。</p></div></div>';
  assert.equal(campusArticleTitle(html, "sysu"), "四六级通知");
  assert.ok(!campusArticle(html, "sysu").includes("横幅内容"));
  assert.equal(
    campusPublicationDate(html, "https://school.edu.cn/article/1", "sysu"),
    "2026-09-13",
  );
  assert.throws(() =>
    campusPublicationDate(
      html.replace("2026-09-13", "2026-02-30"),
      "https://school.edu.cn/article/1",
      "sysu",
    ),
  );
  assert.throws(() => campusArticle("<nav>只有通知链接，没有文章正文。</nav>", "vsb"));
});

test("公开通知快照有原文、有效日期和内容摘要，9校均有内容且原学校ID保持", () => {
  const records = JSON.parse(
    readFileSync(new URL("../../src/domain/campus-notices.json", import.meta.url), "utf8"),
  );
  assert.equal(new Set(records.map((notice) => notice.id)).size, records.length);
  const schoolIds = new Set(CAMPUS_SOURCES.map((source) => source.schoolId));
  assert.equal(schoolIds.size, 9);
  for (const id of schoolIds) {
    assert.ok(CAMPUS_SCHOOLS.some((school) => school.id === id));
    assert.ok(
      records.some((notice) => notice.schoolId === id),
      id,
    );
  }
  for (const notice of records) {
    const source = CAMPUS_SOURCES.find(
      (item) =>
        item.schoolId === notice.schoolId &&
        new URL(item.url).origin === new URL(notice.url).origin,
    );
    assert.ok(source, notice.url);
    assert.match(notice.publishedAt, /^20\d{2}-\d{2}-\d{2}$/u);
    assert.equal(new Date(notice.publishedAt).toISOString().slice(0, 10), notice.publishedAt);
    assert.ok(notice.text.length >= 20);
    assert.ok(!notice.text.includes("\uFFFD"), notice.url);
    assert.equal(
      notice.digest,
      createHash("sha256")
        .update(notice.title + notice.text)
        .digest("hex"),
    );
  }
});
