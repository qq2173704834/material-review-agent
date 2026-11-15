import GoalPreparationPage from "@/components/goal-preparation-page";
import type { ReactElement } from "react";
export const dynamic = "force-dynamic";
export default function PreparationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<ReactElement> {
  return GoalPreparationPage({ searchParams });
}
