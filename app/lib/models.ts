import { promises as fs } from "node:fs";
import path from "node:path";
import { LEARNING } from "@/lib/paths";

// Which Claude model answers each feature, kept in learning/_shared/app-data/models.json:
//   { "models": { "explain.1": "haiku", ... }, "prefetchPictures": true }
// Read on every call (the file is tiny), so a change applies to the next call with no restart.
// A missing file or key falls back to DEFAULTS. Server only.

export const MODELS = ["haiku", "sonnet", "opus"] as const;
export type Model = (typeof MODELS)[number];

export const DEFAULTS = {
  "explain.1": "haiku",
  "explain.2": "haiku",
  "explain.3": "sonnet",
  "explain.4": "sonnet",
  "ask.simple": "haiku",
  "ask.mid": "sonnet",
  "ask.deep": "sonnet",
  warmup: "haiku",
  recall: "haiku",
} satisfies Record<string, Model>;
export type Feature = keyof typeof DEFAULTS;
export const FEATURES = Object.keys(DEFAULTS) as Feature[];

export type Settings = { models: Record<Feature, Model>; prefetchPictures: boolean };
export type SettingsPatch = { models?: Partial<Record<Feature, Model>>; prefetchPictures?: boolean };

const FILE = () => path.join(LEARNING, "_shared", "app-data", "models.json");

const isModel = (m: unknown): m is Model => MODELS.includes(m as Model);
const isFeature = (f: string): f is Feature => f in DEFAULTS;

async function readFile(): Promise<{ models?: Record<string, unknown>; prefetchPictures?: unknown }> {
  try {
    const raw = JSON.parse(await fs.readFile(FILE(), "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

/** The settings with defaults filled in for anything missing or invalid in the file. */
export async function getSettings(): Promise<Settings> {
  const raw = await readFile();
  const models = { ...DEFAULTS } as Record<Feature, Model>;
  for (const f of FEATURES) if (isModel(raw.models?.[f])) models[f] = raw.models[f] as Model;
  return { models, prefetchPictures: typeof raw.prefetchPictures === "boolean" ? raw.prefetchPictures : true };
}

export async function modelFor(feature: Feature): Promise<Model> {
  return (await getSettings()).models[feature];
}

/** Checks a PUT body; returns an error message, or null when it is a valid patch. */
export function validate(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "body must be an object";
  const { models, prefetchPictures, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length) return `unknown key: ${Object.keys(rest)[0]}`;
  if (prefetchPictures !== undefined && typeof prefetchPictures !== "boolean") return "prefetchPictures must be true or false";
  if (models !== undefined) {
    if (!models || typeof models !== "object" || Array.isArray(models)) return "models must be an object";
    for (const [f, m] of Object.entries(models)) {
      if (!isFeature(f)) return `unknown feature: ${f}`;
      if (!isModel(m)) return `unknown model for ${f}: ${String(m)}`;
    }
  }
  return null;
}

/** Merges a validated patch into the saved settings and writes the file atomically. */
export async function saveSettings(patch: SettingsPatch): Promise<Settings> {
  const err = validate(patch);
  if (err) throw new Error(err);
  const cur = await getSettings();
  const next: Settings = {
    models: { ...cur.models, ...patch.models },
    prefetchPictures: patch.prefetchPictures ?? cur.prefetchPictures,
  };
  const file = FILE();
  await fs.mkdir(path.dirname(file), { recursive: true });
  // write then rename, so a reader never sees half a file
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 1) + "\n");
  await fs.rename(tmp, file);
  return next;
}
