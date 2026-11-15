import { BookOpen, Code2, Languages, GraduationCap, ArrowUpRight } from "lucide-react";
import type { ReactElement } from "react";
export function ResourceCover({
  category,
  format,
  label,
}: {
  category: string;
  format: string;
  label: string;
}): ReactElement {
  const theme = /cet|pet|ielts|toefl|jlpt|dele|gre|gmat/.test(category)
    ? "language"
    : /ncre|computer|software/.test(category)
      ? "code"
      : "general";
  const Icon =
    theme === "language"
      ? Languages
      : theme === "code"
        ? Code2
        : format === "考纲"
          ? GraduationCap
          : BookOpen;
  return (
    <div className={`resource-cover resource-cover-${theme}`} aria-hidden="true">
      <span className="resource-cover-icon">
        <Icon size={28} strokeWidth={1.6} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{format}</strong>
      </div>
      <ArrowUpRight className="resource-cover-arrow" size={19} />
    </div>
  );
}
