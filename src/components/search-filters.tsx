"use client";
import Link from "next/link";
import type { ReactElement } from "react";
import { RotateCcw, Search, X } from "lucide-react";

export interface SearchField {
  name: string;
  label: string;
  options?: { value: string; label: string }[];
  checkbox?: boolean;
}
export function SearchFilters({
  path,
  filters,
  common,
  extra,
  submit,
}: {
  path: string;
  filters: Record<string, string | undefined>;
  common: SearchField[];
  extra: SearchField[];
  submit: string;
}): ReactElement {
  const fields = [...common, ...extra];
  function field(item: SearchField): ReactElement {
    return (
      <label key={item.name}>
        {item.checkbox ? (
          <>
            <input
              type="checkbox"
              name={item.name}
              value="1"
              defaultChecked={filters[item.name] === "1"}
            />{" "}
            {item.label}
          </>
        ) : (
          <>
            {item.label}
            {item.options ? (
              <select
                className="mt-1 w-full rounded border p-2"
                name={item.name}
                defaultValue={filters[item.name] ?? ""}
              >
                <option value="">全部</option>
                {item.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                name={item.name}
                maxLength={120}
                defaultValue={filters[item.name]}
                className="mt-1 w-full rounded border p-2"
              />
            )}
          </>
        )}
      </label>
    );
  }
  const applied = fields.filter((item) => filters[item.name]);
  return (
    <section className="surface space-y-4">
      <form
        action={path}
        key={JSON.stringify(filters)}
        onChange={(event) => {
          const target = event.target;
          if (!(target instanceof HTMLSelectElement)) return;
          const dependencies =
            target.name === "category"
              ? ["level", "subject", "language", "examForm"]
              : target.name === "goal"
                ? ["subject", "stage"]
                : [];
          for (const name of dependencies) {
            const field = target.form?.elements.namedItem(name);
            if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement)
              field.value = "";
          }
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">{common.map(field)}</div>
        {extra.length > 0 && (
          <details className="mt-4" open={extra.some((item) => filters[item.name])}>
            <summary className="goal-summary">更多筛选</summary>
            <div className="grid gap-4 sm:grid-cols-3 mt-3">{extra.map(field)}</div>
          </details>
        )}
        <div className="flex flex-wrap gap-3 mt-4">
          <button className="button-primary">
            <Search size={16} />
            {submit}
          </button>
          <Link className="button-secondary" href={path}>
            <RotateCcw size={16} />
            重置
          </Link>
        </div>
      </form>
      {applied.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="已应用筛选">
          {applied.map((item) => {
            const params = new URLSearchParams(
              Object.entries(filters).filter((entry): entry is [string, string] => !!entry[1]),
            );
            params.delete(item.name);
            params.delete("page");
            if (item.name === "category")
              for (const key of ["level", "subject", "language", "examForm"]) params.delete(key);
            const value =
              item.options?.find((option) => option.value === filters[item.name])?.label ??
              (item.options ? "条件不可用" : item.checkbox ? "是" : filters[item.name]);
            return (
              <Link
                key={item.name}
                className="filter-chip"
                href={`${path}?${params}`}
                aria-label={`移除${item.label}筛选`}
              >
                {item.label}：{value}
                <X size={13} aria-hidden="true" />
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
