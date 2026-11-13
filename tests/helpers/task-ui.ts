import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Engineering regressions explicitly open the advanced tools they intend to exercise. */
export async function openRequirements(page: Page): Promise<void> {
  if (await page.getByRole("dialog", { name: "查看 / 调整审查要求", exact: true }).isVisible())
    return;
  await closeTaskTool(page);
  await page.getByRole("button", { name: "查看 / 调整审查要求", exact: true }).first().click();
  await expect(
    page.getByRole("dialog", { name: "查看 / 调整审查要求", exact: true }),
  ).toBeVisible();
}

export async function openHistory(page: Page): Promise<void> {
  await closeTaskTool(page);
  await page.getByRole("button", { name: "来源历史与任务设置", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "来源历史与任务设置", exact: true })).toBeVisible();
}

export async function closeTaskTool(page: Page): Promise<void> {
  const close = page.getByRole("button", { name: "关闭处理面板", exact: true });
  if (await close.isVisible()) await close.click();
}
