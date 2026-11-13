// Shared helpers for the end-to-end scenario: who's who, signing in as them
// (choosing their own password at first sign-in), and small UI shortcuts.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

export const ROOT = { email: process.env.E2E_ROOT_EMAIL ?? "arvsa@gmail.com", password: process.env.E2E_ROOT_PASSWORD ?? "demo-password" };
/** What everyone picks at first sign-in. */
export const NEW_PASSWORD = "Rnn-Day-2026!";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(HERE, "../../backend");
const STATE = join(HERE, ".state");

type Person = { role: string; email: string; first_name: string; last_name: string };
type Branch = { code: string; name: string; file: string; people: Person[] };
export const roster: { branches: Branch[] } = JSON.parse(readFileSync(join(HERE, "fixtures/roster.json"), "utf8"));
export const fixture = (file: string) => join(HERE, "fixtures", file);

export function person(code: string, role: string): Person & { name: string } {
  const p = roster.branches.find((b) => b.code === code)!.people.find((x) => x.role === role)!;
  return { ...p, name: `${p.first_name} ${p.last_name}` };
}
export const branchName = (code: string) => roster.branches.find((b) => b.code === code)!.name;

// ---- passwords ------------------------------------------------------------

function loadCreds(): Record<string, string> {
  return existsSync(join(STATE, "creds.json")) ? JSON.parse(readFileSync(join(STATE, "creds.json"), "utf8")) : {};
}
function saveCred(email: string, password: string) {
  mkdirSync(STATE, { recursive: true });
  writeFileSync(join(STATE, "creds.json"), JSON.stringify({ ...loadCreds(), [email]: password }, null, 1));
}

/** The temporary password from the operator tool (`users --csv`). */
export function temporaryPassword(email: string): string | undefined {
  const csv = execFileSync(join(BACKEND, "target/debug/users"), ["--csv", "--search", email], { cwd: BACKEND, encoding: "utf8" });
  const [header, ...rows] = csv.trim().split("\n");
  const cols = header.split(",");
  for (const row of rows) {
    const cells = row.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'));
    if (cells[cols.indexOf("EMAIL")] === email) {
      const pw = cells[cols.indexOf("PASSWORD")];
      return pw.startsWith("(") ? undefined : pw;
    }
  }
  return undefined;
}

// ---- signing in -------------------------------------------------------------

export async function newPage(browser: Browser, lang: "en" | "fa" = "en"): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  await ctx.addInitScript((l) => localStorage.setItem("st.lang", l), lang);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[page error] ${e.message}`));
  return { ctx, page };
}

async function submitSignIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  // By field, not label, so it works in Farsi too.
  await page.locator('input[autocomplete="email"], input[type="email"]').first().fill(email);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 10_000 });
}

/** Signs in; at first sign-in, swaps the temporary password for NEW_PASSWORD. */
export async function signIn(page: Page, email: string) {
  if (email === ROOT.email) return submitSignIn(page, email, ROOT.password);
  const known = loadCreds()[email];
  if (known) return submitSignIn(page, email, known);
  const temp = temporaryPassword(email);
  if (!temp) throw new Error(`no temporary password for ${email}`);
  await submitSignIn(page, email, temp);
  await expect(page.getByRole("heading", { name: "Choose your own password" })).toBeVisible();
  await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Confirm new password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("heading", { name: "Choose your own password" })).toBeHidden();
  saveCred(email, NEW_PASSWORD);
}

export async function as(browser: Browser, email: string, lang: "en" | "fa" = "en") {
  const { ctx, page } = await newPage(browser, lang);
  await signIn(page, email);
  return { ctx, page };
}

// ---- small UI shortcuts -----------------------------------------------------

/** Picks a branch in the header's branch switcher. */
export async function chooseBranch(page: Page, name: string) {
  await page.getByRole("button", { name: /^Branch: .*Change branch$/ }).click();
  await page.getByRole("menuitem", { name: new RegExp(name) }).click();
}

export async function toast(page: Page, text: string | RegExp) {
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible();
}

/** Problems found while running, written to .state/findings.md at the end. */
const findings: string[] = [];
export function finding(text: string) {
  if (findings.includes(text)) return;
  findings.push(text);
  console.log(`[finding] ${text}`);
  mkdirSync(STATE, { recursive: true });
  writeFileSync(join(STATE, "findings.md"), findings.map((f) => `- ${f}`).join("\n") + "\n");
}

export async function shot(page: Page, name: string) {
  mkdirSync(join(STATE, "shots"), { recursive: true });
  await page.screenshot({ path: join(STATE, "shots", `${name}.png`), fullPage: true });
}

// ---- values shared between tests (item numbers) -----------------------------

export function remember(key: string, value: string) {
  mkdirSync(STATE, { recursive: true });
  const file = join(STATE, "values.json");
  const all = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  writeFileSync(file, JSON.stringify({ ...all, [key]: value }, null, 1));
}
/** Runs `make` the first time only, remembering its result (reruns reuse it). */
export async function once(key: string, make: () => Promise<string>): Promise<string> {
  try {
    return recall(key);
  } catch {
    const v = await make();
    remember(key, v);
    return v;
  }
}

export function recall(key: string): string {
  const file = join(STATE, "values.json");
  const v = existsSync(file) ? JSON.parse(readFileSync(file, "utf8"))[key] : undefined;
  if (!v) throw new Error(`nothing remembered as ${key}`);
  return v;
}

/** Opens New item, fills it and sends; returns the new item's key (ISS-n). */
export async function newItem(
  page: Page,
  o: {
    kind: "Ticket" | "Action" | "Event";
    template?: string;
    title: string;
    to?: string[];
    mode?: "Everyone gets their own" | "One person picks it up";
    priority?: "Low" | "Medium" | "High" | "Critical";
    details?: string;
    tags?: string;
    files?: string[];
    send: RegExp;
    extra?: (dlg: ReturnType<Page["getByRole"]>) => Promise<void>;
  },
): Promise<string> {
  await page.getByRole("button", { name: "New item" }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg
    .getByRole("radiogroup", { name: "What do you need?" })
    .getByRole("radio", { name: new RegExp(`^${o.kind}`) })
    .click();
  if (o.template) await dlg.getByRole("radiogroup", { name: "Template" }).getByRole("radio", { name: o.template }).click();
  await dlg.getByLabel("Title").fill(o.title);
  for (const r of o.to ?? []) {
    const input = dlg.getByRole("textbox", { name: /^Add a (person|branch)/ });
    await input.fill(r);
    // An option reads "IT 2 people", "Sara Jafari Person" or "Azar Campus Whole branch".
    const esc = r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await page
      .getByRole("button", { name: new RegExp(`^${esc} (\\d+ people|1 person|Person|Whole branch)$`) })
      .first()
      .click();
  }
  if (o.to?.length) {
    await page.keyboard.press("Escape"); // the picker stays open for more
    await expect(dlg).toBeVisible();
  }
  if (o.mode) await dlg.getByRole("radiogroup", { name: "How should groups do this?" }).getByRole("radio", { name: o.mode }).click();
  if (o.details || o.tags || o.files || o.priority) {
    const more = dlg.getByRole("button", { name: "+ Add details, tags or files" });
    if (await more.isVisible()) await more.click();
  }
  if (o.priority) await dlg.getByLabel("Priority").selectOption({ label: o.priority });
  if (o.details) await dlg.getByLabel(/^Details/).fill(o.details);
  if (o.tags) await dlg.getByLabel(/^Tags/).fill(o.tags);
  if (o.files) await dlg.locator('input[type="file"]').setInputFiles(o.files);
  if (o.extra) await o.extra(dlg);
  await dlg.getByRole("button", { name: o.send }).click();
  const t = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: /ISS-\d+/ })
    .first();
  await expect(t).toBeVisible();
  const key = (await t.textContent())!.match(/ISS-\d+/)![0];
  await expect(dlg).toBeHidden();
  return key;
}
