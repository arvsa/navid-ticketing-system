// A day at Rahe Novin Navid Schools, end to end through the UI.
// Runs against the dev stack and fills its database; start from an empty one
// with only the root user (E2E_ROOT_EMAIL / E2E_ROOT_PASSWORD).
import { expect, test, type Page } from "@playwright/test";
import { ROOT, as, branchName, chooseBranch, finding, fixture, newItem, once, person, recall, remember, roster, shot, toast } from "./helpers";

test.describe.configure({ mode: "serial" });

test("1. root user opens four branches, imports their people and appoints admins", async ({ browser }) => {
  const { page } = await as(browser, ROOT.email);

  await page.goto("/branches");
  const existing = (
    (await (await page.request.get("/api/branches")).json()) as {
      items: { code: string }[];
    }
  ).items.map((b) => b.code);
  for (const b of roster.branches) {
    if (existing.includes(b.code)) continue;
    await page.getByRole("button", { name: "Open a new branch" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Name").fill(b.name);
    await dlg.getByLabel("Code").fill(b.code);
    await dlg.getByRole("button", { name: "Open branch" }).click();
    await toast(page, `${b.name} is open`);
    await expect(dlg).toBeHidden();
  }

  for (const b of roster.branches) {
    const card = branchCard(page, b.name);
    await card.getByRole("button", { name: "Add people" }).click();
    await page.getByRole("menuitem", { name: "Import from Excel" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.locator('input[type="file"]').setInputFiles(fixture(b.file));
    const importButton = dlg.getByRole("button", {
      name: /^Import \d+ (person|people)$/,
    });
    await expect(importButton).toBeVisible();
    if (b.code === "FRZ") await shot(page, "import-check-FRZ");
    if (await importButton.isEnabled()) {
      await importButton.click();
      await expect(dlg.getByRole("heading", { name: `Imported to ${b.name}` })).toBeVisible();
      await dlg.getByRole("button", { name: "Done" }).click();
      // Closing without downloading asks first; the users tool has the passwords.
      const confirm = page.getByRole("dialog", {
        name: "Close without the passwords?",
      });
      await confirm.waitFor();
      if ((await confirm.getByRole("button", { name: "Close", exact: true }).count()) > 1)
        finding(
          "Import: the 'Close without the passwords?' dialog has two buttons named 'Close' (the X keeps the dialog, the other discards the passwords).",
        );
      await confirm.getByRole("button", { name: "Close", exact: true }).last().click();
    } else {
      await dlg.getByRole("button", { name: "Cancel" }).click(); // imported on an earlier run
    }
    await expect(page.getByRole("dialog")).toBeHidden();

    const principal = person(b.code, "principal");
    if (await card.getByText(principal.first_name).first().isVisible()) continue;
    await card.getByRole("button", { name: "Appoint" }).click();
    const appoint = page.getByRole("dialog");
    await appoint.getByRole("textbox").fill(principal.first_name);
    await appoint.getByRole("button", { name: new RegExp(principal.email) }).click();
    await appoint.getByRole("button", { name: "Appoint admin" }).click();
    await toast(page, "Admin appointed");
    await expect(card).toContainText(principal.first_name);
  }
  await shot(page, "branches");
});

/** A branch's card on the Branches page. */
function branchCard(page: Page, name: string) {
  return page
    .getByRole("heading", { name, exact: true })
    .locator("xpath=ancestor::div[.//button[@aria-label='Add people' or normalize-space()='Add people']][1]");
}

type Grant = { title: string; reach?: string; kinds?: string };
const ANY_ITEM = "Any item in the branch";
const ANY_WORK = "Any work in the branch";

/** Roles and departments, set up once for every branch. */
const SCHOOL_GROUPS: { name: string; description: string; department?: boolean; grants: Grant[] }[] = [
  {
    name: "CEO Office",
    description: "The CEO and their office, across the school",
    grants: [
      { title: "Create items" },
      { title: "Give tasks to others", reach: ANY_ITEM },
      { title: "Send to people in other branches" },
      { title: "Approve or send back work" },
      { title: "See branch-wide numbers" },
      { title: "Export the branch to Excel" },
    ],
  },
  {
    name: "Principals",
    description: "Principals and vice principals",
    grants: [
      { title: "Create items" },
      { title: "Give tasks to others", reach: ANY_ITEM },
      { title: "Close or cancel items", reach: ANY_ITEM },
      { title: "Approve or send back work" },
      { title: "Assign or reassign work", reach: ANY_WORK },
      { title: "Send to people in other branches" },
      { title: "See branch-wide numbers" },
      { title: "Export the branch to Excel" },
    ],
  },
  {
    name: "Teachers",
    description: "Everyone who teaches a class",
    grants: [],
  },
  {
    name: "IT",
    description: "IT department: computers, labs, projectors and the network",
    department: true,
    grants: [
      {
        title: "Close or cancel items",
        reach: ANY_ITEM,
        kinds: "Tickets only",
      },
    ],
  },
  {
    name: "Health",
    description: "Health department: the school nurse and first aid",
    department: true,
    grants: [
      {
        title: "Close or cancel items",
        reach: ANY_ITEM,
        kinds: "Tickets only",
      },
    ],
  },
];

async function setGrants(page: Page, groupName: string, grants: Grant[]) {
  for (const g of grants) {
    const toggle = page.getByRole("switch", { name: g.title, exact: true });
    if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
    if (g.reach)
      await page
        .getByRole("radiogroup", { name: `Reach for ${g.title}` })
        .getByRole("radio", { name: g.reach })
        .click();
    if (g.kinds) await page.getByLabel(`Kinds for ${g.title}`).selectOption({ label: g.kinds });
  }
  const save = page.getByRole("button", { name: "Save changes" }).first();
  if (!(await save.isVisible())) return; // nothing changed
  await save.click();
  const confirm = page.getByRole("dialog", {
    name: new RegExp(`Save changes to ${groupName}`),
  });
  await confirm.getByRole("button", { name: "Save changes" }).click();
  await toast(page, /Saved|saved/);
}

test("2. root user sets up roles, departments and templates", async ({ browser }) => {
  const { page } = await as(browser, ROOT.email);
  await page.goto("/people?tab=school");
  const groupNames = ((await (await page.request.get("/api/school-groups?include_archived=true")).json()) as { name: string }[]).map((g) => g.name);
  for (const g of SCHOOL_GROUPS) {
    const entry = page.getByRole("button", { name: new RegExp(`^${g.name} `) });
    if (!groupNames.includes(g.name)) {
      await page.getByRole("button", { name: "New school-wide group" }).click();
      const dlg = page.getByRole("dialog");
      await dlg.getByLabel("Name").fill(g.name);
      await dlg.getByLabel(/Description/).fill(g.description);
      if (g.department) await dlg.getByRole("radiogroup", { name: "Kind of group" }).getByRole("radio", { name: "Department" }).click();
      await dlg.getByRole("button", { name: "Create group" }).click();
      await toast(page, `${g.name} created`);
    }
    await entry.click();
    await expect(page.getByRole("heading", { level: 2, name: new RegExp(g.name) })).toBeVisible();
    await setGrants(page, g.name, g.grants);
  }
  await shot(page, "school-groups");

  // Templates: each sets the kind and adds its tag.
  const TEMPLATES = [
    {
      name: "Midterm grades",
      kind: "Action",
      tag: "midterm",
      report: true,
      days: "3",
      description: "Upload your classes' midterm grades",
    },
    {
      name: "Lab or equipment problem",
      kind: "Ticket",
      tag: "lab",
      description: "Something broken in a lab or classroom",
    },
    {
      name: "Health incident",
      kind: "Ticket",
      tag: "health",
      description: "A student or staff member needs the nurse",
    },
    {
      name: "Parent-teacher conference",
      kind: "Event",
      tag: "parents",
      description: "Meeting parents about their child's progress",
    },
  ];
  await page.goto("/templates");
  const templateNames = ((await (await page.request.get("/api/templates?include_archived=true")).json()) as { name: string }[]).map((x) => x.name);
  for (const x of TEMPLATES) {
    if (templateNames.includes(x.name)) continue;
    await page.getByRole("button", { name: "New template" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Name").fill(x.name);
    await dlg.getByLabel("Kind").selectOption({ label: x.kind });
    await dlg.getByLabel(/Description/).fill(x.description);
    await dlg.getByLabel(/^Tag/).fill(x.tag);
    if (x.report) {
      const sw = dlg.getByRole("switch", { name: "Needs a written report" });
      if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
      await dlg.getByLabel(/Due after/).fill(x.days!);
    }
    await dlg.getByRole("button", { name: "Create template" }).click();
    await toast(page, "Template created");
  }
  await shot(page, "templates");
});

/** Who's in which group, in every branch. */
const STAFFING: Record<string, string[]> = {
  Principals: ["principal", "vice"],
  Teachers: ["teacher1", "teacher2", "teacher3", "teacher4"],
  IT: ["it"],
  Health: ["nurse"],
};

async function openGroup(page: Page, name: string) {
  await page.getByRole("button", { name: new RegExp(`^(School-wide )?${name} (Department )?\\d+`) }).click();
  await expect(page.getByRole("heading", { level: 2, name: new RegExp(`${name}$`) })).toBeVisible();
}

async function addMembers(page: Page, group: string, people: { email: string; first_name: string }[]) {
  await openGroup(page, group);
  await page.getByRole("tab", { name: /^Members/ }).click();
  const panel = page.getByRole("heading", { level: 2, name: new RegExp(`${group}$`) }).locator("xpath=ancestor::div[.//*[@role='tablist']][1]");
  await expect(panel.getByText(/No one is in this group yet|@/).first()).toBeVisible();
  const missing = [];
  for (const p of people)
    if (!(await panel.getByRole("listitem").filter({ hasText: p.email, hasNotText: "No one matches" }).isVisible())) missing.push(p);
  if (!missing.length) return;
  // Several at once: tick each, then add them together.
  await panel.getByRole("button", { name: "Add people" }).click();
  for (const p of missing) {
    await panel.getByRole("textbox", { name: "Search people…" }).fill(p.email);
    await panel.getByRole("checkbox", { name: new RegExp(p.email) }).check();
  }
  await panel.getByRole("button", { name: /^Add (\d+ )?to / }).click();
  await toast(page, /^Added/);
  for (const p of missing) await expect(panel.getByRole("listitem").filter({ hasText: p.email, hasNotText: "No one matches" })).toBeVisible();
}

test("3. each principal signs in for the first time and staffs their branch's groups", async ({ browser }) => {
  for (const b of roster.branches) {
    const { ctx, page } = await as(browser, person(b.code, "principal").email);
    await page.goto("/people?tab=groups");
    for (const [group, roles] of Object.entries(STAFFING))
      await addMembers(
        page,
        group,
        roles.map((r) => person(b.code, r)),
      );

    if (b.code === "AZR") {
      await addMembers(page, "CEO Office", [person("AZR", "ceo")]);
      await addMembers(page, "IT", [person("AZR", "ithead")]);
      // The IT head runs the department: its members and the work sent to it.
      await openGroup(page, "IT");
      const row = page.getByRole("listitem").filter({ hasText: person("AZR", "ithead").email, hasNotText: "No one matches" });
      if (await row.getByRole("button", { name: "Make head" }).isVisible()) {
        await row.getByRole("button", { name: "Make head" }).click();
        await toast(page, /^Now a head of/);
      }
      await expect(row.getByText("Head", { exact: true })).toBeVisible();
      await shot(page, "azr-it-head");
    }
    await ctx.close();
  }
});

test("4. 08:00 the AZR principal asks every teacher for their midterm grades", async ({ browser }) => {
  const { page } = await as(browser, person("AZR", "principal").email);
  const key = await once("midterm", () =>
    newItem(page, {
      kind: "Action",
      template: "Midterm grades",
      title: "Upload your midterm grades",
      to: ["Teachers"],
      mode: "Everyone gets their own",
      priority: "High",
      details: "Please hand in your classes' midterm grades with the grade sheet attached, by Wednesday.",
      send: /^Request \d+ reports$/,
    }),
  );
  await page.goto(`/items/${key.slice(4)}`);
  await expect(page.getByRole("heading", { level: 1, name: "Upload your midterm grades" })).toBeVisible();
  await shot(page, "midterm-sent");
});

/** Opens your part from My work (first time) or directly; false if already handed in. */
async function openMyPart(page: Page, title: string, key: string): Promise<boolean> {
  await page.goto("/my-work");
  const link = page.getByRole("link", { name: new RegExp(title) }).first();
  await expect(page.getByRole("heading", { name: "My work", level: 1 })).toBeVisible();
  if (await link.isVisible()) await link.click();
  else await page.goto(`/items/${key.slice(4)}/mine`);
  await expect(page).toHaveURL(/\/items\/\d+\/mine/);
  await expect(page.getByRole("heading", { name: "Your report", exact: true })).toBeVisible();
  // The report's header says "Handed in 5 min ago" once it's in.
  await page.waitForTimeout(500);
  return !(await page
    .getByText(/^Handed in (?!\.)/)
    .first()
    .isVisible());
}

async function writeAndHandIn(page: Page, title: string, body: string, file?: string) {
  await expect(page.getByRole("heading", { name: "Your report", exact: true })).toBeVisible();
  const start = page.getByRole("button", { name: "Start", exact: true });
  if (await start.isVisible()) {
    await start.click();
    await toast(page, "Started");
  }
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Report", { exact: true }).fill(body);
  await expect(page.getByText(/Draft saved/)).toBeVisible();
  const fileName = file?.split("/").pop();
  if (file && !(await page.getByText(fileName!, { exact: true }).isVisible())) {
    await page.locator('input[type="file"]').first().setInputFiles(file);
    await expect(page.getByText(fileName!, { exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Hand in for approval" }).click();
  await page.getByRole("dialog", { name: "Hand in your report?" }).getByRole("button", { name: "Hand in report" }).click();
  await expect(page.getByText(/^Handed in (?!\.)/).first()).toBeVisible();
}

test("5. 09:30 teachers write their grade reports and hand them in", async ({ browser }) => {
  const grades = fixture("midterm-grades.csv");
  const key = recall("midterm");
  {
    const { ctx, page } = await as(browser, person("AZR", "teacher1").email);
    if (await openMyPart(page, "Upload your midterm grades", key))
      await writeAndHandIn(page, "Midterm grades: 7-1 and 7-2", "Both classes are graded.\n\n- 7-1: average 17.2\n- 7-2: average 15.8", grades);
    await shot(page, "teacher1-handed-in");
    await ctx.close();
  }
  {
    const { ctx, page } = await as(browser, person("AZR", "teacher2").email);
    if (await openMyPart(page, "Upload your midterm grades", key)) {
      if (await page.getByRole("button", { name: "Start", exact: true }).isVisible()) {
        await page.getByRole("button", { name: "Start", exact: true }).click();
        await toast(page, "Started");
      }
      await page.getByRole("button", { name: "I'm blocked" }).first().click();
      await page.getByRole("textbox", { name: "What's holding you up?" }).fill("The grading spreadsheet on the shared drive won't open.");
      await page.getByRole("dialog").getByRole("button", { name: "I'm blocked" }).click();
      await toast(page, "Marked as blocked");
      await page.getByRole("button", { name: "Continue" }).click();
      await toast(page, "Back in progress");
      await writeAndHandIn(page, "Midterm grades: 8-1", "8-1 average 14.9. Two students missed the exam.");
    }
    await ctx.close();
  }
  {
    const { ctx, page } = await as(browser, person("AZR", "teacher4").email);
    if (await openMyPart(page, "Upload your midterm grades", key)) await writeAndHandIn(page, "Midterm grades: 9-3", "9-3 average 16.4.", grades);
    await ctx.close();
  }
});

test("6. 11:00 the principal reviews: approves one, sends one back, approves the rest", async ({ browser }) => {
  const t1 = person("AZR", "teacher1");
  const t4 = person("AZR", "teacher4");
  const principal = await as(browser, person("AZR", "principal").email);
  let page = principal.page;
  await page.goto("/approvals");
  await expect(page.getByRole("heading", { level: 1, name: /Waiting for your approval/ })).toBeVisible();
  const row = (p: { name: string }) => page.getByRole("listitem").filter({ has: page.getByRole("checkbox", { name: `Select ${p.name}` }) });
  await expect(
    page
      .getByRole("checkbox", { name: /^Select / })
      .first()
      .or(page.getByText("No work is waiting for your approval.")),
  ).toBeVisible();
  if (await page.getByText("No work is waiting for your approval.").isVisible()) return principal.ctx.close(); // reviewed on an earlier run

  if (await row(t1).isVisible()) {
    await row(t1).getByRole("button", { name: "Approve" }).click();
    await toast(page, /^Approved .+ work/);
    await expect(row(t1)).toBeHidden();
  }

  const sentBack = (() => {
    try {
      return recall("sentBack");
    } catch {
      return "";
    }
  })();
  if (!sentBack && (await row(t4).isVisible())) {
    await row(t4)
      .getByRole("link", { name: new RegExp(t4.name) })
      .click();
    const review = page.getByRole("dialog");
    await expect(review).toContainText("Midterm grades: 9-3");
    await review
      .getByRole("textbox", { name: new RegExp(`Note for ${t4.first_name}`) })
      .fill("The grade sheet isn't attached. Please add it and hand it in again.");
    await review.getByRole("button", { name: "Send back" }).click();
    await toast(page, /^Sent back to /);
    remember("sentBack", "yes");
  }
  await shot(page, "after-send-back");

  // Teacher 4 sees it came back, adds the file and hands it in again.
  if (!sentBack) {
    const teacher = await as(browser, t4.email);
    await teacher.page.goto("/my-work");
    await expect(teacher.page.getByText("Sent back").first()).toBeVisible();
    await teacher.page
      .getByRole("link", { name: /Upload your midterm grades/ })
      .first()
      .click();
    await expect(teacher.page.getByText("The grade sheet isn't attached").first()).toBeVisible();
    await teacher.page.locator('input[type="file"]').first().setInputFiles(fixture("midterm-grades.csv"));
    await expect(teacher.page.getByText("midterm-grades.csv", { exact: true })).toBeVisible();
    await teacher.page.getByRole("button", { name: "Hand in for approval" }).click();
    await teacher.page.getByRole("dialog", { name: "Hand in your report?" }).getByRole("button", { name: "Hand in report" }).click();
    await expect(teacher.page.getByText(/^Handed in (?!\.)/).first()).toBeVisible();
    await teacher.ctx.close();
  }

  // Approving and leaving the page straight away (the approval waits 5
  // seconds for Undo, in the browser).
  await page.goto("/approvals");
  await expect(page.getByRole("checkbox", { name: /^Select / }).first()).toBeVisible();
  if (await row(t4).isVisible()) {
    await row(t4).getByRole("button", { name: "Approve" }).click();
    await toast(page, /^Approved .+ work/);
    await page.goto("/"); // a full page load drops the pending approval
    await page.waitForTimeout(6000);
    const mine = await (await page.request.get("/api/work-items?status=pending_approval&limit=50")).json();
    if ((mine.items as { assignee_id: string }[]).length)
      finding(
        "Approvals: approving and then reloading, closing the tab or signing out within 5 seconds loses the approval: the request is only sent after a 5-second Undo timer in the page, though the toast already said Approved.",
      );
  }

  // Back to the principal: approve everything waiting at once.
  await page.goto("/approvals");
  await expect(page.getByRole("checkbox", { name: /^Select / }).first()).toBeVisible();
  for (const box of await page.getByRole("checkbox", { name: /^Select / }).all()) await box.check();
  await page.getByRole("button", { name: /^Approve selected \(\d+\)$/ }).click();
  await page
    .getByRole("dialog", { name: /^Approve \d+ pieces? of work\?$/ })
    .getByRole("button", { name: /^Approve \d+$/ })
    .click();
  await toast(page, /^Approved/);
  await page.waitForTimeout(5500); // the Undo window
  await page.reload();
  await expect(page.getByText("No work is waiting for your approval.")).toBeVisible();

  await page.goto(`/items/${recall("midterm").slice(4)}`);
  await expect(page.getByText(/3\s*approved/)).toBeVisible();
  await shot(page, "midterm-after-approvals");
});

async function comment(page: Page, text: string) {
  const box = page.getByRole("textbox", { name: /^Write a comment/ });
  await box.fill(text);
  const saved = page.waitForResponse((r) => r.url().includes("/comments") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Send (Ctrl+Enter)" }).click();
  expect((await saved).status()).toBe(201);
  await expect(box).toHaveValue("");
  await expect(page.getByRole("paragraph").filter({ hasText: text }).first()).toBeVisible();
}

async function isClosed(page: Page, n: string) {
  return ((await (await page.request.get(`/api/issues/by-number/${n}`)).json()) as { state: string }).state !== "open";
}

async function closeItem(page: Page) {
  const direct = page.getByRole("button", { name: /^Close question$|^Close$/ }).first();
  await expect(page.getByRole("button", { name: "More actions" })).toBeVisible();
  if (await direct.isVisible()) await direct.click();
  else {
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /^Close( question)?$/ }).click();
    finding("Tickets: the department answering a ticket can only close it from the More actions menu; the asker gets a Close question button.");
  }
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Close( question)?$/ })
    .last()
    .click();
  await expect(page.getByText("This item is closed, so the conversation is read-only.")).toBeVisible();
}

test("7. 10:15 a teacher reports a broken projector to the whole IT department; IT answers and closes it", async ({ browser }) => {
  const teacher = await as(browser, person("AZR", "teacher3").email);
  const key = await once("projector", () =>
    newItem(teacher.page, {
      kind: "Ticket",
      template: "Lab or equipment problem",
      title: "Projector in Lab 2 won't turn on",
      to: ["IT"],
      priority: "High",
      details: "Since this morning the Lab 2 projector shows no picture. I have a class there at 13:00.",
      files: [fixture("projector.png")],
      send: /^Ask$/,
    }),
  );
  const n = key.slice(4);
  if (await isClosed(teacher.page, n)) return teacher.ctx.close(); // done on an earlier run

  // Anyone in IT can take it: the IT tech sees it in the inbox.
  const it = await as(browser, person("AZR", "it").email);
  await it.page.getByRole("button", { name: /^Notifications/ }).click();
  await expect(it.page.getByText(/Projector in Lab 2/).first()).toBeVisible();
  await it.page.goto(`/items/${n}`);
  await expect(it.page.getByRole("heading", { level: 1, name: "Projector in Lab 2 won't turn on" })).toBeVisible();
  await expect(it.page.getByText("projector.png").first()).toBeVisible();
  if (!(await it.page.getByText("On my way. It's probably the HDMI switch again.").isVisible()))
    await comment(it.page, "On my way. It's probably the HDMI switch again.");
  await shot(it.page, "it-ticket");

  // The teacher sees the reply, then IT closes it once it's fixed.
  await teacher.page.goto(`/items/${n}`);
  await expect(teacher.page.getByText("On my way. It's probably the HDMI switch again.")).toBeVisible();
  if (!(await teacher.page.getByText("Thank you!").isVisible())) await comment(teacher.page, "Thank you!");
  if (!(await it.page.getByText("Fixed: replaced the HDMI switch. Closing this.").isVisible()))
    await comment(it.page, "Fixed: replaced the HDMI switch. Closing this.");
  await it.page.reload();
  await closeItem(it.page);
  await teacher.page.reload();
  await expect(teacher.page.getByText(/closed/i).first()).toBeVisible();
  await teacher.ctx.close();
  await it.ctx.close();
});

test("8. 12:40 a Motahari teacher calls the nurse; Health answers", async ({ browser }) => {
  const teacher = await as(browser, person("MTH", "teacher1").email);
  const key = await once("fever", () =>
    newItem(teacher.page, {
      kind: "Ticket",
      template: "Health incident",
      title: "Student in 8-2 has a high fever",
      to: ["Health"],
      priority: "Critical",
      send: /^Ask$/,
    }),
  );
  if (await isClosed(teacher.page, key.slice(4))) return teacher.ctx.close();
  const nurse = await as(browser, person("MTH", "nurse").email);
  await nurse.page.goto(`/items/${key.slice(4)}`);
  await comment(nurse.page, "Bring them to the health room, I'll call the parents.");
  await closeItem(nurse.page);
  await teacher.ctx.close();
  await nurse.ctx.close();
});

async function rsvp(page: Page, n: string, answer: "Going" | "Maybe" | "Can't go", note?: string) {
  await page.goto(`/items/${n}`);
  const group = page.getByRole("radiogroup", { name: "Are you coming?" });
  await expect(group).toBeVisible();
  if (note) await page.getByLabel(/Note for the organiser/).fill(note);
  await group.getByRole("radio", { name: answer }).click();
  await toast(page, answer === "Going" ? "You're going" : answer === "Maybe" ? "Marked as maybe" : "Marked as can't go");
}

test("9. 13:30 the CEO invites every branch's principals to a leadership meeting; they reply", async ({ browser }) => {
  const ceo = await as(browser, person("AZR", "ceo").email);
  const key = await once("leadership", () =>
    newItem(ceo.page, {
      kind: "Event",
      title: "Leadership meeting: term 2 planning",
      to: ["Principals", "Principals", "Principals", "Principals"],
      details: "Agenda: midterm results, staffing, the spring trip.",
      send: /^Create event$/,
    }),
  );
  await ceo.page.goto(`/items/${key.slice(4)}`);
  await expect(ceo.page.getByText("Who's coming")).toBeVisible();
  if (await ceo.page.getByText("A group").first().isVisible())
    finding(
      "School-wide items: groups in other branches show as 'A group' (e.g. 'Invited: Principals, A group, A group, A group'), even to the sender who picked them; they should say which group and branch.",
    );
  if (
    await ceo.page
      .getByText(/Organised by .*\.$/)
      .first()
      .isVisible()
  )
    finding(
      "Bidi: short Farsi names inside English sentences render with the initial and period on the wrong side ('Organised by ن کامران.', 'From ح مریم.'); wrap names in <bdi>.",
    );
  await shot(ceo.page, "leadership-event");

  const replies: [string, "Going" | "Maybe" | "Can't go", string?][] = [
    ["AZR", "Going"],
    ["MTH", "Maybe", "I may be late: parents' evening runs until 16:00."],
    ["SDR", "Can't go"],
  ];
  for (const [code, answer, note] of replies) {
    const p = await as(browser, person(code, "principal").email);
    await rsvp(p.page, key.slice(4), answer, note);
    await p.ctx.close();
  }
  // The FRZ vice principal (also in Principals) doesn't answer.
  await ceo.page.reload();
  await expect(ceo.page.getByText("Who's coming")).toBeVisible();
  await shot(ceo.page, "leadership-replies");
  await ceo.ctx.close();
});

test("10. 14:00 the AZR counselor invites the teachers to the parent-teacher conference", async ({ browser }) => {
  const counselor = await as(browser, person("AZR", "counselor").email);
  const key = await once("ptc", () =>
    newItem(counselor.page, {
      kind: "Event",
      template: "Parent-teacher conference",
      title: "Parent-teacher conference: grade 7",
      to: ["Teachers"],
      send: /^Create event$/,
    }),
  );
  for (const [role, answer] of [
    ["teacher1", "Going"],
    ["teacher2", "Going"],
    ["teacher3", "Maybe"],
  ] as const) {
    const p = await as(browser, person("AZR", role).email);
    await rsvp(p.page, key.slice(4), answer);
    if (role === "teacher1") {
      await p.page.goto("/calendar");
      await expect(p.page.getByText("Parent-teacher conference: grade 7").first()).toBeVisible();
      await shot(p.page, "teacher-calendar");
    }
    await p.ctx.close();
  }
  await counselor.ctx.close();
});

test("11. 15:00 the AZR principal filters items and exports exactly what's filtered", async ({ browser }) => {
  const { page } = await as(browser, person("AZR", "principal").email);
  await page.goto("/");
  await shot(page, "principal-home");

  await page.goto("/items");
  const side = page.getByRole("complementary", { name: "Filters" });
  await side.getByRole("radio", { name: "All statuses" }).check();
  await side.getByRole("checkbox", { name: "High" }).check();
  await side.getByRole("button", { name: "Any tag" }).click();
  await page.getByRole("option", { name: /#midterm/ }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Created/ }).click();
  await page.getByRole("button", { name: "Last 7 days" }).click();
  await expect(page).toHaveURL(/priority=high/);
  await expect(page).toHaveURL(/tags=midterm/);
  await expect(page.getByRole("link", { name: /Upload your midterm grades/ }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Projector in Lab 2/ })).toBeHidden();
  await expect(page.getByLabel("Filters in use").getByRole("button", { name: /^Remove #midterm/ })).toBeVisible();
  await shot(page, "items-filtered");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.xlsx$/);
  await toast(page, "Export downloaded");

  // Removing a chip widens the list again.
  await page
    .getByLabel("Filters in use")
    .getByRole("button", { name: /^Remove #midterm/ })
    .click();
  await side.getByRole("checkbox", { name: "High" }).uncheck();
  await expect(page.getByRole("link", { name: /Projector in Lab 2/ })).toBeVisible();
});

test("12. 15:30 the Motahari admin hires someone, resets a password and deactivates a leaver", async ({ browser }) => {
  const admin = await as(browser, person("MTH", "principal").email);
  const page = admin.page;
  await page.goto("/people?tab=members");

  // A new art teacher starts today.
  const newHire = "art@mth.rnn.school";
  const known = (await (await page.request.get(`/api/directory`)).text()).includes(newHire);
  if (!known) {
    await page.getByRole("button", { name: "Add people" }).first().click();
    await page.getByRole("menuitem", { name: "Add one person" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Email").fill(newHire);
    await dlg.getByLabel(/First name/).fill("نیلوفر");
    await dlg.getByLabel(/Last name/).fill("هنرمند");
    await dlg.getByRole("button", { name: "Add member" }).click();
    await expect(dlg.getByText("Temporary password")).toBeVisible();
    await dlg.getByRole("button", { name: "Done" }).click();
  }

  const openPerson = async (email: string) => {
    await page.getByRole("searchbox", { name: "Search people" }).fill(email);
    await page
      .getByRole("button", { name: new RegExp(email) })
      .first()
      .click();
  };

  // A teacher forgot their password.
  const t2 = person("MTH", "teacher2");
  await openPerson(t2.email);
  await page.getByRole("button", { name: "Reset password" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByText(/temporary password/i).first()).toBeVisible();
  await shot(page, "reset-password");
  // The operator tool shows it until they sign in and choose their own.
  const { temporaryPassword } = await import("./helpers");
  expect(temporaryPassword(t2.email)).toBeTruthy();
  await page.keyboard.press("Escape");

  // The accountant left.
  await page.goto("/people?tab=members");
  await openPerson(person("MTH", "accountant").email);
  const deactivate = page.getByRole("button", { name: "Deactivate account" });
  if (await deactivate.isVisible()) {
    await deactivate.click();
    await page.getByRole("dialog").getByRole("button", { name: "Deactivate" }).click();
    await toast(page, "Deactivated");
  }
  await admin.ctx.close();
});

test("13. 16:30 end of the day: inbox, directory, profile and search", async ({ browser }) => {
  const { page } = await as(browser, person("AZR", "teacher1").email);

  await page.goto("/inbox");
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  await shot(page, "teacher-inbox");
  const markAll = page.getByRole("button", { name: "Mark all as read" });
  if (await markAll.isVisible()) {
    await markAll.click();
    await expect(page.getByRole("button", { name: /^Notifications$/ })).toBeVisible();
  }

  // Who's in IT across the school?
  await page.goto("/directory");
  if (await page.getByRole("tablist", { name: "Branches" }).getByRole("button").first().isVisible())
    finding(
      "Directory: the branch switcher is a tablist of plain buttons (no tab roles), and their names run the count into the name ('Azar Campus12').",
    );
  await page.getByRole("searchbox", { name: "Find a person or department" }).fill("IT");
  await expect(page.getByText(person("AZR", "ithead").email).first()).toBeVisible();
  await expect(page.getByText(person("SDR", "it").email).first()).toBeVisible();
  await shot(page, "directory-it");

  await page.goto("/profile");
  const bio = "I teach maths to grades 7 and 8. Find me in room 14 or the staff room at lunch.";
  if (!(await page.getByText(bio).isVisible())) {
    await page
      .getByRole("button", { name: /^Edit$|Add a short bio/ })
      .first()
      .click();
    await page.getByLabel("About").fill(bio);
    await page.getByRole("button", { name: "Save" }).click();
    await toast(page, "Saved");
  }
  await page
    .getByRole("button", { name: /Add a profile picture|Change profile picture/ })
    .first()
    .waitFor();
  await page.locator('input[type="file"][accept*="image"]').nth(1).setInputFiles(fixture("projector.png")); // [0] is the cover
  await toast(page, "Profile picture updated");
  await shot(page, "teacher-profile");

  // Global search jumps to an item by number.
  const heading = page.getByRole("heading", { level: 1, name: /Upload your midterm grades/ });
  await page.keyboard.press("/");
  await page.keyboard.type(recall("midterm"));
  await page.keyboard.press("Enter");
  if (!(await heading.isVisible({ timeout: 3000 }).catch(() => false))) {
    finding(
      "Search: typing or pasting a number (ISS-1) and pressing Enter at once runs a title search instead of opening the item: the number is read from a 250 ms debounced copy of the input.",
    );
    if (await page.getByText("Try a number like ISS-1042.").isVisible())
      finding("Items: searching 'ISS-1' in the items search box finds nothing, while its empty state says 'Try a number like ISS-1042.'");
    await page.keyboard.press("/");
    await page.keyboard.type(recall("midterm"));
    await page.waitForTimeout(500);
    await page.keyboard.press("Enter");
  }
  await expect(heading).toBeVisible();
});

test("14. the root user looks across the school, exports people, and the day in Farsi", async ({ browser }) => {
  const { page } = await as(browser, ROOT.email);
  await page.goto("/items");
  await page.getByRole("complementary", { name: "Filters" }).getByRole("radio", { name: "All statuses" }).check();
  await expect(page.getByRole("link", { name: /Leadership meeting/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Student in 8-2 has a high fever/ })).toBeVisible();
  await shot(page, "root-items");

  await page.goto("/export");
  await page.getByRole("radiogroup", { name: "What to export" }).getByRole("radio", { name: "People" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Excel file" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);

  // The same day, as Farsi readers see it.
  const fa = await as(browser, person("AZR", "principal").email, "fa");
  for (const [path, name] of [
    ["/", "fa-home"],
    ["/items", "fa-items"],
    [`/items/${recall("midterm").slice(4)}`, "fa-midterm"],
    [`/items/${recall("leadership").slice(4)}`, "fa-leadership"],
    ["/calendar", "fa-calendar"],
    ["/directory", "fa-directory"],
    ["/people?tab=groups", "fa-groups"],
  ]) {
    await fa.page.goto(path);
    await fa.page.waitForTimeout(1200);
    await expect(fa.page.locator("html")).toHaveAttribute("dir", "rtl");
    await shot(fa.page, name);
  }
});
