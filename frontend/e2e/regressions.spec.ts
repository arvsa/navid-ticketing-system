// Checks for the bugs the school-day run found. Needs the data org-day.spec.ts
// leaves (run it first).
import { expect, test } from "@playwright/test";
import { ROOT, as, fixture, newItem, person, recall, toast } from "./helpers";

test.describe.configure({ mode: "serial" });

test("an approval survives leaving the page within the Undo window", async ({ browser }) => {
  const principal = await as(browser, person("AZR", "principal").email);
  const teacher = await as(browser, person("AZR", "teacher4").email);
  const title = `Check the fire exits (${Date.now()})`;
  const key = await newItem(principal.page, { kind: "Action", title, to: [person("AZR", "teacher4").name], send: /^Send task$/ });
  const n = key.slice(4);

  await teacher.page.goto(`/items/${n}/mine`);
  await teacher.page.getByRole("button", { name: "Start", exact: true }).click();
  await toast(teacher.page, "Started");
  await teacher.page.getByRole("button", { name: "Send for approval" }).first().click();
  const dlg = teacher.page.getByRole("dialog");
  await dlg.getByRole("textbox").first().fill("All exits checked, signs are lit.");
  await dlg.getByRole("button", { name: "Send for approval" }).click();
  await toast(teacher.page, "Sent for approval");

  await principal.page.goto("/approvals");
  const row = principal.page
    .getByRole("listitem")
    .filter({ hasText: person("AZR", "teacher4").first_name })
    .filter({ has: principal.page.getByRole("button", { name: "Approve" }) });
  await row.first().getByRole("button", { name: "Approve" }).click();
  await toast(principal.page, /^Approved/);
  await principal.page.reload(); // well inside the 5 seconds

  await expect
    .poll(async () => {
      const issue = await (await principal.page.request.get(`/api/issues/by-number/${n}`)).json();
      return issue.work_items[0].status;
    })
    .toBe("approved");
});

test("a school-wide event shows school time, not the device's", async ({ browser }) => {
  const { page } = await as(browser, person("MTH", "principal").email);
  await page.goto(`/items/${recall("leadership").slice(4)}`);
  // Stored for 18:00 in Tehran; this must not depend on the browser's zone.
  await expect(page.getByText(/18:00–20:00/)).toBeVisible();
});

test("groups in other branches are named, with their branch", async ({ browser }) => {
  const { page } = await as(browser, person("AZR", "ceo").email);
  await page.goto(`/items/${recall("leadership").slice(4)}`);
  await expect(page.getByText("Principals · Motahari Campus").first()).toBeVisible();
  await expect(page.getByText("A group")).toHaveCount(0);
});

test("search finds an item by number, however fast you press Enter", async ({ browser }) => {
  const { page } = await as(browser, person("AZR", "teacher1").email);
  const key = recall("midterm");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.keyboard.press("/");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.type(key);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: /Upload your midterm grades/ })).toBeVisible();

  await page.goto(`/items?q=${key}`);
  await expect(page.getByRole("link", { name: new RegExp(`${key},`) })).toBeVisible();
});

test("a department head runs their department without being a branch admin", async ({ browser }) => {
  const head = person("AZR", "ithead");
  // The branch admin makes them head of IT.
  const admin = await as(browser, person("AZR", "principal").email);
  await admin.page.goto("/people?tab=groups");
  await admin.page.getByRole("button", { name: /^School-wide IT (Department )?\d+/ }).click();
  await admin.page.getByRole("tab", { name: /^Members/ }).click();
  const row = admin.page.getByRole("listitem").filter({ hasText: head.email });
  await expect(row).toBeVisible();
  if (await row.getByRole("button", { name: "Make head" }).isVisible()) {
    await row.getByRole("button", { name: "Make head" }).click();
    await toast(admin.page, /^Now a head of/);
  }
  await expect(row.getByText("Head", { exact: true })).toBeVisible();

  // The principal sends IT a shared job; the IT tech takes it and hands it in.
  const title = `Replace the Lab 3 projector bulb (${Date.now()})`;
  const key = await newItem(admin.page, { kind: "Action", title, to: ["IT"], mode: "One person picks it up", send: /^Send task$/ });
  const n = key.slice(4);
  const tech = await as(browser, person("AZR", "it").email);
  await tech.page.goto(`/items/${n}/mine`);
  await tech.page.getByRole("button", { name: "I'll take it" }).click();
  await toast(tech.page, "It's yours now");
  await tech.page.getByRole("button", { name: "Start", exact: true }).click();
  await tech.page.getByRole("button", { name: "Send for approval" }).first().click();
  await tech.page.getByRole("dialog").getByRole("textbox").first().fill("New bulb fitted, tested with a laptop.");
  await tech.page.getByRole("dialog").getByRole("button", { name: "Send for approval" }).click();
  await toast(tech.page, "Sent for approval");

  // The head (not an admin, not the sender) chooses members and approves.
  const h = await as(browser, head.email);
  await h.page.goto("/people?tab=groups");
  await h.page.getByRole("button", { name: /^School-wide IT (Department )?\d+/ }).click();
  await expect(h.page.getByRole("button", { name: "Add people" })).toBeVisible();
  await expect(h.page.getByRole("button", { name: "New group" })).toHaveCount(0);

  await h.page.goto("/approvals");
  const waiting = h.page.getByRole("listitem").filter({ hasText: person("AZR", "it").first_name });
  await waiting.first().getByRole("button", { name: "Approve" }).click();
  await toast(h.page, /^Approved/);
  await h.page.waitForTimeout(5500);
  const issue = await (await h.page.request.get(`/api/issues/by-number/${n}`)).json();
  expect(issue.work_items[0].status).toBe("approved");

  // And closes a question sent to IT.
  const wifi = await (await h.page.request.get(`/api/issues?q=${encodeURIComponent("Wi-fi drops")}&state=open`)).json();
  if (wifi.items.length) {
    await h.page.goto(`/items/${wifi.items[0].number}`);
    await h.page.getByRole("button", { name: "More actions" }).click();
    await h.page.getByRole("menuitem", { name: "Close question" }).click();
    await h.page.getByRole("dialog").getByRole("button", { name: "Close question" }).click();
    await expect(h.page.getByText("This item is closed, so the conversation is read-only.")).toBeVisible();
  }

  // The directory shows who runs IT.
  await h.page.goto("/directory");
  await expect(h.page.getByText(`Head · ${head.email}`).first()).toBeVisible();
});

test("several people join a group at once", async ({ browser }) => {
  const { page } = await as(browser, person("AZR", "principal").email);
  await page.goto("/people?tab=groups");
  const name = "Grade 7 team";
  const entry = page.getByRole("button", { name: new RegExp(`^${name} \\d+`) });
  await expect(page.getByRole("button", { name: /^All members \d+/ })).toBeVisible();
  if (!(await entry.isVisible())) {
    await page.getByRole("button", { name: "New group" }).click();
    await page.getByRole("dialog").getByLabel("Name").fill(name);
    await page.getByRole("dialog").getByRole("button", { name: "Create group" }).click();
    await toast(page, `${name} created`);
  }
  await entry.click();
  await page.getByRole("tab", { name: /^Members/ }).click();
  await expect(page.getByText("No one is in this group yet").or(page.getByText("teacher1@azr.rnn.school"))).toBeVisible();
  if (await page.getByText("No one is in this group yet").isVisible()) {
    await page.getByRole("button", { name: "Add people" }).click();
    await page.getByRole("textbox", { name: "Search people…" }).fill("teacher");
    await page.getByRole("checkbox", { name: /^Select everyone shown/ }).check();
    await expect(page.getByRole("button", { name: `Add 4 to ${name}` })).toBeVisible();
    await page.getByRole("checkbox", { name: /teacher4@/ }).uncheck();
    await page.getByRole("button", { name: `Add 3 to ${name}` }).click();
    await toast(page, "Added 3 people");
  }
  await expect(page.getByRole("tab", { name: /^Members 3/ })).toBeVisible();
});

test("root users are listed, and no developer notes show", async ({ browser }) => {
  const { page } = await as(browser, ROOT.email);
  await page.goto("/branches");
  await expect(page.getByText(ROOT.email, { exact: true })).toBeVisible();
  await expect(page.getByText(/gap G-\d+/)).toHaveCount(0);
});

test("the department answering a question can close it from the page", async ({ browser }) => {
  const teacher = await as(browser, person("AZR", "teacher2").email);
  const key = await newItem(teacher.page, { kind: "Ticket", title: `Printer in room 9 is out of toner (${Date.now()})`, to: ["IT"], send: /^Ask$/ });
  const it = await as(browser, person("AZR", "it").email);
  await it.page.goto(`/items/${key.slice(4)}`);
  await expect(it.page.getByRole("button", { name: "Reply" })).toBeVisible();
  await it.page.getByRole("button", { name: "Close question", exact: true }).click();
  await it.page.getByRole("dialog").getByRole("button", { name: "Close question" }).click();
  await expect(it.page.getByText("This item is closed, so the conversation is read-only.")).toBeVisible();
});

test("closing an import without the passwords says so plainly", async ({ browser }) => {
  const { page } = await as(browser, ROOT.email);
  await page.goto("/branches");
  const card = page.getByRole("heading", { name: "Sadra Campus", exact: true }).locator("xpath=ancestor::div[.//button[@aria-label='Add people']][1]");
  await card.getByRole("button", { name: "Add people" }).click();
  await page.getByRole("menuitem", { name: "Import from Excel" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.locator('input[type="file"]').setInputFiles(fixture("new-hire-SDR.xlsx"));
  const importButton = dlg.getByRole("button", { name: /^Import \d+ (person|people)$/ });
  await expect(importButton).toBeVisible();
  if (await importButton.isDisabled()) return; // imported on an earlier run
  await importButton.click();
  await dlg.getByRole("button", { name: "Done" }).click();
  const confirm = page.getByRole("dialog", { name: "Close without the passwords?" });
  await expect(confirm.getByRole("button", { name: "Close", exact: true })).toHaveCount(0);
  await confirm.getByRole("button", { name: "Close without passwords" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("tabs say what they show, and arrow keys move between them", async ({ browser }) => {
  const { page } = await as(browser, person("AZR", "principal").email);
  await page.goto(`/items/${recall("midterm").slice(4)}`);
  const discussion = page.getByRole("tab", { name: /^Discussion/ });
  await expect(page.getByRole("tabpanel", { name: /^Discussion/ })).toBeVisible();
  await discussion.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tabpanel", { name: /^People/ })).toBeVisible();

  await page.goto("/people?tab=groups");
  await page.getByRole("button", { name: /^School-wide Teachers \d+/ }).click();
  await expect(page.getByRole("tabpanel", { name: "What they can do" })).toBeVisible();

  await page.goto("/directory");
  await expect(page.getByRole("group", { name: "Branches" }).getByRole("button", { name: /^Azar Campus ?, \d+ people$/ })).toBeVisible();
});
