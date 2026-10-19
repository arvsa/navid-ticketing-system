// Every t()/tn()/tx() text in the app has a Farsi translation with the same
// {placeholders}, and the dictionary has no leftovers.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fa } from "../fa";

const SRC = join(__dirname, "../..");
const STR = String.raw`"((?:[^"\\]|\\.)*)"`;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" || name === "i18n" ? [] : sources(p);
    return /\.tsx?$/.test(name) && !name.endsWith(".d.ts") ? [p] : [];
  });
}

function keysIn(code: string): string[] {
  const out: string[] = [];
  const parse = (s: string) => JSON.parse(`"${s}"`) as string;
  for (const m of code.matchAll(new RegExp(String.raw`\bt[x]?\(\s*` + STR, "g"))) out.push(parse(m[1]));
  for (const m of code.matchAll(new RegExp(String.raw`\btn\(\s*[^,]+?,\s*` + STR + String.raw`\s*,\s*` + STR, "gs"))) out.push(parse(m[1]), parse(m[2]));
  return out;
}

const keys = [...new Set(sources(SRC).flatMap((f) => keysIn(readFileSync(f, "utf8"))))];
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("Farsi dictionary", () => {
  it("finds the app's texts", () => expect(keys.length).toBeGreaterThan(500));
  it("translates every text", () => expect(keys.filter((k) => !(k in fa))).toEqual([]));
  it("keeps the same placeholders", () => expect(keys.filter((k) => k in fa && placeholders(k).join() !== placeholders(fa[k]).join())).toEqual([]));
  it("has nothing unused", () => expect(Object.keys(fa).filter((k) => !keys.includes(k))).toEqual([]));
});
