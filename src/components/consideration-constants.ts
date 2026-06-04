export const VALUE_LABELS = [
  "Manager cares", "Ideas valued", "Career growth", "Creativity",
  "Learn from manager", "12-month pay growth", "Long-term earnings", "Bonus potential",
  "Variety & challenge", "Responsibility", "Promotion potential", "Manager fit",
  "Autonomy", "Internal communication", "Benefits", "Working environment",
  "Stability", "Respectful culture", "Great colleagues / team", "Recognition for good work",
  "Flexible working", "Reasonable travel time", "Company brand", "Growing company",
];

export const COMPARISON_FACTORS = [
  "Career Progression", "Leadership Quality", "Scope / Responsibility",
  "Compensation", "Work From Home / Hybrid", "Work-Life Balance",
  "Manager Quality", "Stability / Security",
];

export type CurrencyCode = "GBP" | "USD" | "EUR" | "AUD" | "CAD";

export const CURRENCIES: { code: CurrencyCode; symbol: string; label: string }[] = [
  { code: "GBP", symbol: "£",  label: "GBP" },
  { code: "USD", symbol: "$",  label: "USD" },
  { code: "EUR", symbol: "€",  label: "EUR" },
  { code: "AUD", symbol: "A$", label: "AUD" },
  { code: "CAD", symbol: "C$", label: "CAD" },
];

export const DEFAULT_CURRENCY: CurrencyCode = "GBP";

export function currencySymbol(code: CurrencyCode | string | null | undefined): string {
  const c = CURRENCIES.find((x) => x.code === code);
  return c ? c.symbol : "£";
}

export type FinancialUnit = "currency" | "percent";

export interface FinancialRow {
  /** Stable id so React keys + delete targeting survive reordering. */
  id: string;
  label: string;
  l: string;
  r: string;
  unit: FinancialUnit;
  /** Default rows (the canonical seven) can't be deleted, only renamed +
   *  unit-cycled. Custom rows added by the recruiter set removable: true. */
  removable: boolean;
}

/** Seven canonical rows seeded for a fresh case. Pension is the only percent
 *  default (mirrors UK package conventions). The "Total" row is computed, not
 *  stored. */
export const DEFAULT_FINANCIAL_ROWS: FinancialRow[] = [
  { id: "base",     label: "Base Salary",                     unit: "currency", removable: false, l: "", r: "" },
  { id: "bonus",    label: "Bonus / Commission",              unit: "currency", removable: false, l: "", r: "" },
  { id: "equity",   label: "Equity / LTIP",                   unit: "currency", removable: false, l: "", r: "" },
  { id: "car",      label: "Car / Allowance",                 unit: "currency", removable: false, l: "", r: "" },
  { id: "pension",  label: "Pension",                         unit: "percent",  removable: false, l: "", r: "" },
  { id: "benefits", label: "Benefits",                        unit: "currency", removable: false, l: "", r: "" },
  { id: "wfh",      label: "WFH allowance / cost saving",     unit: "currency", removable: false, l: "", r: "" },
];

/** Hydrate `consideration.financial` from whatever shape it carries in storage.
 *  Supports both the legacy keyed-object (`{ "0": { l, r }, "1": ... }`) and
 *  the new FinancialRow[] shape. Falls back to the default seven rows. */
export function hydrateFinancial(raw: unknown): FinancialRow[] {
  if (Array.isArray(raw)) {
    const out: FinancialRow[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const id = typeof r.id === "string" && r.id ? r.id : "row_" + Math.random().toString(36).slice(2, 10);
      const label = typeof r.label === "string" ? r.label : "Row";
      const lVal = typeof r.l === "string" ? r.l : "";
      const rVal = typeof r.r === "string" ? r.r : "";
      const unit: FinancialUnit = r.unit === "percent" ? "percent" : "currency";
      const removable = r.removable === true;
      out.push({ id, label, l: lVal, r: rVal, unit, removable });
    }
    return out.length > 0 ? out : DEFAULT_FINANCIAL_ROWS.map((row) => ({ ...row }));
  }
  if (raw && typeof raw === "object") {
    // Legacy keyed-object — pull values out of indices 0..6 onto the default
    // seven rows. Index 7 (the old "Total Package" entry) is discarded; the
    // total is computed on render.
    const obj = raw as Record<string, { l?: unknown; r?: unknown }>;
    return DEFAULT_FINANCIAL_ROWS.map((row, i) => {
      const entry = obj[String(i)];
      return {
        ...row,
        l: typeof entry?.l === "string" ? entry.l : "",
        r: typeof entry?.r === "string" ? entry.r : "",
      };
    });
  }
  return DEFAULT_FINANCIAL_ROWS.map((row) => ({ ...row }));
}

/** Random id generator for newly-added custom rows. */
export function newRowId(): string {
  return "row_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
}
