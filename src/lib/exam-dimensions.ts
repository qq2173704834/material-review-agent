export interface ExamDimensions {
  categories?: string[];
  levels?: string[];
  subjects?: string[];
  languages?: string[];
  examForms?: string[];
}
export function matchesExamDimensions(
  content: ExamDimensions,
  filters: Record<string, string | undefined>,
): boolean {
  return (["level", "subject", "language", "examForm"] as const).every((key) => {
    const value = filters[key]?.trim().normalize("NFKC").toLowerCase();
    if (!value) return true;
    const field = {
      level: "levels",
      subject: "subjects",
      language: "languages",
      examForm: "examForms",
    }[key] as "levels" | "subjects" | "languages" | "examForms";
    return content[field]?.some((item) => item.normalize("NFKC").toLowerCase() === value) ?? false;
  });
}
