import type { ReviewMaterialSummary } from "@/domain/review";
/** Old successful parses must be refreshed when a parser gains structure or region support. */
export function canReuseMaterialParse(
  material: Pick<ReviewMaterialSummary, "extension" | "parserName">,
): boolean {
  const parser = material.parserName.replace(/\+manual$/, "");
  if (material.extension === "docx") return parser === "mammoth-logical-blocks";
  if (["jpg", "png"].includes(material.extension))
    return parser === "tesseract.js-chi_sim-eng+regions-v3";
  if (material.extension === "pdf")
    return (
      parser === "pdfjs-dist+rows-regions-v3" ||
      parser === "pdfjs-dist+tesseract.js+rows-regions-v3"
    );
  if (material.extension === "xlsx") return parser === "exceljs";
  return (
    ["txt", "csv", "md", "json", "yaml", "yml"].includes(material.extension) &&
    parser === "utf8-text"
  );
}
