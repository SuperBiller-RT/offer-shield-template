// Static OpenRouter model catalogue. Mirrors recruiter-spy-template's pattern
// (src/lib/byok.ts) — a small curated list rather than a live /api/llm-models
// route, since offer-shield only needs the model id for save/load and isn't
// running any AI features in this round. If we later want a fresh catalogue,
// swap this for a route that hits OpenRouter's /models endpoint.

export const DEFAULT_MODEL = "anthropic/claude-sonnet-4";

export type ModelOption = {
  id: string;
  label: string;
  provider: string;
  /** Input price per 1M tokens, USD */
  in: number;
  /** Output price per 1M tokens, USD */
  out: number;
};

export const MODEL_OPTIONS: ModelOption[] = [
  { id: "anthropic/claude-sonnet-4",  label: "Claude Sonnet 4",  provider: "Anthropic", in: 3.00, out: 15.00 },
  { id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5", provider: "Anthropic", in: 1.00, out:  5.00 },
  { id: "openai/gpt-4o",              label: "GPT-4o",           provider: "OpenAI",    in: 2.50, out: 10.00 },
  { id: "openai/gpt-4.1-mini",        label: "GPT-4.1 mini",     provider: "OpenAI",    in: 0.40, out:  1.60 },
  { id: "openai/gpt-4o-mini",         label: "GPT-4o mini",      provider: "OpenAI",    in: 0.15, out:  0.60 },
  { id: "google/gemini-2.0-flash",    label: "Gemini 2.0 Flash", provider: "Google",    in: 0.10, out:  0.40 },
];

export function formatModelOption(m: ModelOption): string {
  return `${m.label}, ${m.provider} (in $${m.in.toFixed(2)} / out $${m.out.toFixed(2)} per 1M)`;
}
