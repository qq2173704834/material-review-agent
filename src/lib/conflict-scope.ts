/** Only explicit labelled dimensions are machine-comparable. Unknown is never treated as global. */
export function explicitRuleScope(text: string): Record<string, string> {
  const scope: Record<string, string> = {};
  for (const match of text.matchAll(
    /(?:^|[；;，,\n【（(])\s*(地区|考期|阶段|岗位|科目)\s*[:：=]\s*([^；;，,。\n】）)]{1,80})/gu,
  )) {
    const key = match[1]!,
      value = match[2]!.normalize("NFC").trim();
    scope[key] =
      /未知|待确认|待定|全国|全部|不限|或|、/.test(value) || (scope[key] && scope[key] !== value)
        ? "__unknown__"
        : value;
  }
  return scope;
}
export function compareRuleScopes(
  first: Record<string, string>,
  second: Record<string, string>,
): "different" | "unknown" | "same" {
  const known = (value: string | undefined): boolean => Boolean(value && value !== "__unknown__");
  const dimensions = new Set([...Object.keys(first), ...Object.keys(second)]);
  if (
    [...dimensions].some(
      (key) => known(first[key]) && known(second[key]) && first[key] !== second[key],
    )
  )
    return "different";
  if ([...dimensions].some((key) => !known(first[key]) || !known(second[key]))) return "unknown";
  return "same";
}
export function hasComplexRelation(text: string): boolean {
  return /除[^。；]{1,100}外|例外|豁免|(?:满足|符合)[^。；]{1,80}或|二选一|任一|替代|取代|更正|以[^。；]{1,80}为准|不再要求/u.test(
    text,
  );
}
