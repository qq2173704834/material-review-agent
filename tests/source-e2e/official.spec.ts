import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
const password = "Synthetic-Source-Checker-2026";
for (const [key, sourceUrl] of [
  ["cet", "https://cet.neea.edu.cn/"],
  ["ncre", "https://ncre.neea.edu.cn/"],
  ["teacher", "https://ntce.neea.edu.cn/"],
  ["graduate", "https://yz.chsi.com.cn/"],
  ["jlpt", "https://www.neea.edu.cn/html1/folder/19093/4844-1.htm"],
] as const) {
  test(
    key === "jlpt"
      ? "真实日语入口尚未适配时保留失败记录"
      : `真实官方源${key}形成草稿，重复去重且不自动发布`,
    async ({ request }) => {
      const username = `source_${Date.now().toString(36)}`;
      expect(
        (await request.post("/api/auth/register", { data: { username, password } })).status(),
      ).toBe(201);
      execFileSync(process.execPath, [
        "scripts/platform-admin.mjs",
        "role",
        "--username",
        username,
        "--role",
        "admin",
        "--apply",
        "--data-dir",
        ".local-data/source-e2e",
      ]);
      expect(
        (await request.post("/api/auth/login", { data: { username, password } })).ok(),
      ).toBeTruthy();
      const initial = await (await request.get("/api/admin/exams")).json();
      const source = initial.sources.find((s: { url: string }) => s.url === sourceUrl);
      const response = await request.post("/api/admin/exams", {
        data: { action: "collect", id: source.id },
        timeout: 150000,
      });
      const result = await response.json();
      if (key === "jlpt") {
        expect(response.status()).toBe(400);
        const after = await (await request.get("/api/admin/exams")).json();
        const current = after.sources.find((s: { id: string }) => s.id === source.id);
        expect(current.last_success).toBe(source.last_success);
        expect(current.error).toBeTruthy();
        mkdirSync("work", { recursive: true });
        writeFileSync(
          `work/official-source-acceptance-${key}.json`,
          JSON.stringify(
            {
              checkedAt: new Date().toISOString(),
              source: source.url,
              result,
              lastSuccess: current.last_success,
              outcome: "尚未适配/访问受限，未计为采集成功",
              automaticPublication: false,
            },
            null,
            2,
          ),
        );
        return;
      }
      expect(response.ok(), JSON.stringify(result)).toBeTruthy();
      const after = await (await request.get("/api/admin/exams")).json();
      const current = after.sources.find((s: { id: string }) => s.id === source.id);
      expect(current.last_success).toBeTruthy();
      const drafts = after.notices.filter((n: { source_id: string }) => n.source_id === source.id);
      expect(drafts.length).toBeGreaterThan(0);
      expect(drafts.every((n: { status: string }) => n.status === "draft")).toBeTruthy();
      const repeat = await request.post("/api/admin/exams", {
        data: { action: "collect", id: source.id },
        timeout: 150000,
      });
      expect(repeat.ok()).toBeTruthy();
      expect((await repeat.json()).drafts).toBe(0);
      mkdirSync("work", { recursive: true });
      writeFileSync(
        `work/official-source-acceptance-${key}.json`,
        JSON.stringify(
          {
            checkedAt: new Date().toISOString(),
            source: source.url,
            result,
            lastSuccess: current.last_success,
            drafts: drafts.map(
              (n: { id: string; canonical_url: string; content: { title: string } }) => ({
                id: n.id,
                url: n.canonical_url,
                title: n.content.title,
              }),
            ),
            automaticPublication: false,
          },
          null,
          2,
        ),
      );
    },
  );
}
