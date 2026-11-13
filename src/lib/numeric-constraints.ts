export interface NumericBound {
  operator: "lt" | "lte" | "eq" | "gte" | "gt";
  value: number;
  unit: string;
}

const operators: Record<string, NumericBound["operator"]> = {
  不超过: "lte",
  不得超过: "lte",
  不大于: "lte",
  至多: "lte",
  最多: "lte",
  最大: "lte",
  "≤": "lte",
  "<=": "lte",
  少于: "lt",
  小于: "lt",
  低于: "lt",
  "<": "lt",
  至少: "gte",
  不少于: "gte",
  不低于: "gte",
  不小于: "gte",
  "≥": "gte",
  ">=": "gte",
  超过: "gt",
  大于: "gt",
  多于: "gt",
  ">": "gt",
  恰好: "eq",
  正好: "eq",
  等于: "eq",
  "=": "eq",
};
const units = "GiB|MiB|KiB|GB|MB|KB|字节|B|字符|页|份|个|件|项|字";

export function extractNumericBounds(text: string): NumericBound[] {
  const expression = new RegExp(
    "(" +
      Object.keys(operators)
        .sort((a, b) => b.length - a.length)
        .join("|") +
      ")\\s*(\\d+(?:\\.\\d+)?)\\s*(" +
      units +
      ")",
    "gi",
  );
  const result: NumericBound[] = [];
  for (const match of text.matchAll(expression)) {
    const operator = operators[match[1]!];
    const value = Number(match[2]);
    if (operator && Number.isFinite(value))
      result.push({ operator, value, unit: match[3]!.toUpperCase() });
  }
  for (const match of text.matchAll(
    new RegExp(
      "(\\d+(?:\\.\\d+)?)\\s*(?:至|到|[-~～—])\\s*(\\d+(?:\\.\\d+)?)\\s*(" + units + ")",
      "gi",
    ),
  )) {
    const suffix = text.slice(
      (match.index ?? 0) + match[0].length,
      (match.index ?? 0) + match[0].length + 40,
    );
    const lowerOpen =
      /不(?:包含|含)下限|下限不(?:包含|含)/.test(suffix) || suffix.includes("不含" + match[1]);
    const upperOpen =
      /不(?:包含|含)上限|上限不(?:包含|含)/.test(suffix) || suffix.includes("不含" + match[2]);
    result.push(
      {
        operator: lowerOpen ? "gt" : "gte",
        value: Number(match[1]),
        unit: match[3]!.toUpperCase(),
      },
      {
        operator: upperOpen ? "lt" : "lte",
        value: Number(match[2]),
        unit: match[3]!.toUpperCase(),
      },
    );
  }
  return result;
}

export function satisfiesBound(
  actual: number,
  bound: Pick<NumericBound, "operator" | "value">,
): boolean {
  switch (bound.operator) {
    case "lt":
      return actual < bound.value;
    case "lte":
      return actual <= bound.value;
    case "eq":
      return actual === bound.value;
    case "gte":
      return actual >= bound.value;
    case "gt":
      return actual > bound.value;
  }
}

export function describeBound(bound: NumericBound): string {
  return `${{ lt: "小于", lte: "不超过", eq: "恰好", gte: "不少于", gt: "大于" }[bound.operator]} ${bound.value} ${bound.unit}`;
}

export function incompatibleBounds(bounds: NumericBound[]): boolean {
  let lower = -Infinity;
  let upper = Infinity;
  let lowerOpen = false;
  let upperOpen = false;
  for (const bound of bounds) {
    if (["gt", "gte", "eq"].includes(bound.operator)) {
      if (bound.value > lower) {
        lower = bound.value;
        lowerOpen = bound.operator === "gt";
      } else if (bound.value === lower && bound.operator === "gt") lowerOpen = true;
    }
    if (["lt", "lte", "eq"].includes(bound.operator)) {
      if (bound.value < upper) {
        upper = bound.value;
        upperOpen = bound.operator === "lt";
      } else if (bound.value === upper && bound.operator === "lt") upperOpen = true;
    }
  }
  return lower > upper || (lower === upper && (lowerOpen || upperOpen));
}
