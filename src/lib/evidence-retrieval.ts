import type { ReviewMaterialSummary, ReviewCheckResult } from "@/domain/review";
import type { ReviewRule } from "@/domain/review-rule";

export interface RetrievedSnippet {
  materialId: string;
  segmentIndex: number;
  text: string;
  chunkStart: number;
}

/** Bounded lexical retrieval, then adjacent-context expansion. Positions always refer to original segments. */
export function retrieveEvidence(
  rule: ReviewRule,
  materials: ReviewMaterialSummary[],
): {
  snippets: RetrievedSnippet[];
  coverage: NonNullable<ReviewCheckResult["coverage"]>;
} {
  const terms = [
    ...new Set(
      (`${rule.target} ${rule.description}`.match(/[\p{L}\p{N}]{2,}/gu) ?? []).flatMap((word) => [
        word,
        ...Array.from({ length: Math.max(0, word.length - 1) }, (_, index) =>
          word.slice(index, index + 2),
        ),
      ]),
    ),
  ];
  const segments = materials.flatMap((material) =>
    material.segments.map((segment) => ({ ...segment, materialId: material.id })),
  );
  const chunks = segments.flatMap((segment) => {
    const result: Array<RetrievedSnippet & { score: number; key: string }> = [];
    for (let start = 0; start < segment.text.length; start += 1800) {
      const text = segment.text.slice(start, start + 2000);
      result.push({
        materialId: segment.materialId,
        segmentIndex: segment.segmentIndex,
        text,
        chunkStart: start,
        key: `${segment.materialId}:${segment.segmentIndex}:${start}`,
        score: terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0),
      });
    }
    return result;
  });
  const ranked = [...chunks].sort((a, b) => b.score - a.score);
  const selected = new Map<string, RetrievedSnippet>();
  let remaining = 24_000;
  function add(chunk: (typeof chunks)[number] | undefined): void {
    if (!chunk || selected.has(chunk.key) || selected.size >= 60 || !remaining) return;
    const text = chunk.text.slice(0, remaining);
    selected.set(chunk.key, {
      materialId: chunk.materialId,
      segmentIndex: chunk.segmentIndex,
      chunkStart: chunk.chunkStart,
      text,
    });
    remaining -= text.length;
  }
  // Reserve half the budget for expansion so a long first segment cannot hide later evidence.
  for (const chunk of ranked) {
    if (remaining <= 12_000) break;
    add(chunk);
  }
  for (const chunk of [...selected.values()]) {
    const index = chunks.findIndex(
      (candidate) =>
        candidate.materialId === chunk.materialId &&
        candidate.segmentIndex === chunk.segmentIndex &&
        candidate.chunkStart === chunk.chunkStart,
    );
    for (const neighbor of [chunks[index - 1], chunks[index + 1]]) {
      if (neighbor?.materialId === chunk.materialId) add(neighbor);
    }
  }
  for (const chunk of ranked) add(chunk);
  const snippets = [...selected.values()];
  return {
    snippets,
    coverage: {
      examinedSegments: new Set(
        snippets.map((snippet) => `${snippet.materialId}:${snippet.segmentIndex}`),
      ).size,
      totalSegments: segments.length,
      isComplete:
        materials.every((material) => material.parseStatus === "text_extracted") &&
        chunks.every((chunk) => selected.get(chunk.key)?.text.length === chunk.text.length),
    },
  };
}
