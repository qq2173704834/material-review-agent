import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  createActor,
  database,
  testDirectory,
  draft,
  noticeContent,
} from "../helpers/platform-boundaries";

function importPublicNotices(): Map<string, { id: string; payload: string }> {
  for (const batch of ["initial", "expansion"])
    execFileSync(process.execPath, [
      "scripts/import-official-notices.mjs",
      "--batch",
      batch,
      "--data-dir",
      testDirectory(),
      "--apply",
    ]);
  const db = database();
  try {
    return new Map(
      db
        .prepare<[], { id: string; payload: string }>(
          "SELECT n.id, v.payload FROM exam_notices n JOIN exam_notice_versions v ON v.notice_id=n.id AND v.version=n.published_version WHERE n.status='published'",
        )
        .all()
        .map((row) => [JSON.parse(row.payload).title, row]),
    );
  } finally {
    db.close();
  }
}

test("全批次日期复查与精简详情：已结束考试、成绩通知、正文日期及外部简章来源正确显示", async ({
  playwright,
  page,
}) => {
  const actor = await createActor(playwright, "date_details");
  const items = importPublicNotices();
  await page.context().addCookies((await actor.api.storageState()).cookies);
  const cpa = items.get("关于2026年注册会计师全国统一考试的考前提醒")!;
  await page.goto(`/exams/${cpa.id}`);
  await expect(page.getByLabel("考试状态", { exact: true })).toHaveText("考试已结束");
  const schedule = page.getByRole("region", { name: "考试日程", exact: true });
  await expect(schedule).toContainText("2026-08-29 至 2026-08-30");
  await expect(schedule.getByRole("link", { name: /日程来源/ })).toHaveAttribute(
    "href",
    /W020260311354851382981.pdf$/,
  );
  await expect(page.getByText(/将保存当前正文版本|考试安排 · 北京时间|本次未收录附件/)).toHaveCount(
    0,
  );
  await expect(page.getByRole("heading", { name: "报名开始", exact: true })).toHaveCount(0);
  mkdirSync("outputs/eng-102", { recursive: true });
  await page.screenshot({ path: "outputs/eng-102/cpa-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "outputs/eng-102/cpa-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const [title, date, status] of [
    ["2026年下半年书画等级考试（CCPT）报名工作启动", "2026-11-21 至 2026-11-22", "待考试"],
    ["关于2026年下半年计算机软件资格考试批次安排的通告", "2026-10-24 至 2026-10-25", "考试已结束"],
    ["2026年9月全国计算机等级考试成绩、证书查询开通", "2026-11-10", "成绩查询"],
  ] as const) {
    const item = items.get(title)!;
    await page.goto(`/exams/${item.id}`);
    await expect(page.getByRole("region", { name: "考试日程", exact: true })).toContainText(date);
    await expect(page.getByLabel("考试状态", { exact: true })).toHaveText(status);
  }
  const catti = items.get("2026年度翻译专业资格（CATTI）证书各省发放通知汇总")!;
  await page.goto(`/exams/${catti.id}`);
  await expect(page.getByLabel("考试状态", { exact: true })).toHaveText("证书通知");
  await expect(page.getByRole("region", { name: "考试日程", exact: true })).toContainText(
    "本公告未列具体日程",
  );
  await actor.api.dispose();
});

test("同一已收录公告日期同步到目标和日程，原始正文不被补充来源替换且助手可引用真实日程来源", async ({
  playwright,
  page,
}) => {
  const actor = await createActor(playwright, "date_projection");
  const item = importPublicNotices().get("关于2026年注册会计师全国统一考试的考前提醒")!;
  const goal = await actor.api.post("/api/goals", {
    data: { goal: { category: "cpa", region: "全国", noticeId: item.id, edition: "2026年" } },
  });
  expect(goal.ok(), await goal.text()).toBe(true);
  const goalId = (await goal.json()).goal.id;
  const nodes = (await (await actor.api.get("/api/schedule")).json()).nodes;
  const exam = nodes.find(
    (n: { label: string; goalIds: string[] }) => n.label === "考试" && n.goalIds.includes(goalId),
  );
  expect(exam.value).toBe("2026-08-29");
  expect(exam.endValue).toBe("2026-08-30");
  expect(
    nodes.some((n: { value: string; goalIds: string[] }) => !n.value && n.goalIds.includes(goalId)),
  ).toBe(false);
  const db = database();
  try {
    expect(
      JSON.parse(
        db
          .prepare<[string], { payload: string }>(
            "SELECT payload FROM exam_notice_versions WHERE notice_id=? AND version=1",
          )
          .get(item.id)!.payload as string,
      ).timeline,
    ).toEqual([]);
  } finally {
    db.close();
  }
  const answer = await actor.api.post("/api/assistant", {
    data: {
      requestId: randomUUID(),
      question: "2026年注册会计师考试时间",
      useContext: true,
      goalId,
    },
  });
  expect(answer.ok(), await answer.text()).toBe(true);
  expect(
    (await answer.json()).citations.some((c: { url: string }) =>
      c.url.endsWith("W020260311354851382981.pdf"),
    ),
  ).toBe(true);
  await page.context().addCookies((await actor.api.storageState()).cookies);
  await page.goto("/me/schedule");
  await expect(page.getByText("考试日期未收录", { exact: true })).toHaveCount(0);
  await expect(page.locator("details#pending")).toHaveCount(0);
  await actor.api.dispose();
});

test("所有新公告发布时拦截正文明确日期漏录，补齐口试范围后可发布且成绩/报名日期不被误判", async ({
  actors,
}) => {
  const content = noticeContent({ text: "本次口试将于2027年3月21日至3月22日举行。", timeline: [] });
  const item = await draft(actors.admin, content);
  const rejected = await actors.admin.api.post("/api/admin/exams", {
    data: { action: "publish", id: item.id, version: 1 },
  });
  expect(rejected.status()).toBe(400);
  expect((await rejected.json()).error).toContain("正文已有明确考试日期");
  const corrected = await actors.admin.api.post("/api/admin/exams", {
    data: {
      action: "draft",
      sourceId: (await (await actors.admin.api.get("/api/admin/exams")).json()).sources.find(
        (s: { category: string }) => s.category === "cet4",
      ).id,
      url: item.url,
      content: {
        ...content,
        timeline: [
          { label: "口试", value: "2027-03-21", endValue: "2027-03-22", quote: content.text },
        ],
      },
    },
  });
  expect(corrected.ok(), await corrected.text()).toBe(true);
  expect(
    (
      await actors.admin.api.post("/api/admin/exams", {
        data: { action: "publish", id: item.id, version: 2 },
      })
    ).status(),
  ).toBe(200);
});
