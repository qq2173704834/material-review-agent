import "server-only";
import { catalogLifecycle } from "@/lib/catalog-lifecycle";
import { learningEntries } from "./learning-store";
export function examCatalogState(
  category: string,
  region: string,
): ReturnType<typeof catalogLifecycle> {
  return catalogLifecycle(learningEntries(), category, region);
}
