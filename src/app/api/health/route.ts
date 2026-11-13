import { isLegacyTestMode } from "@/lib/server/access-config";
import { NextResponse } from "next/server";

import { getRuntimeStatus } from "@/lib/server/runtime-status";
import { getReviewStore } from "@/lib/server/review-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  if (!isLegacyTestMode())
    return NextResponse.json(
      { status: "ok", application: "material-review-agent" },
      { headers: { "Cache-Control": "no-store" } },
    );
  getReviewStore().listTasks();
  const runtimeStatus = getRuntimeStatus(true);
  const isConfiguredCorrectly = runtimeStatus.mode !== "invalid";

  return NextResponse.json(
    {
      status: isConfiguredCorrectly ? "ok" : "configuration_error",
      application: "material-review-agent",
      runtime: runtimeStatus,
    },
    { status: isConfiguredCorrectly ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
