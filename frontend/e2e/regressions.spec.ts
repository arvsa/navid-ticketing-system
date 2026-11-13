// Checks for the bugs the school-day run found. Needs the data org-day.spec.ts
// leaves (run it first).
import { expect, test } from "@playwright/test";
import { as, newItem, person, toast } from "./helpers";

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
  const row = principal.page.getByRole("listitem").filter({ hasText: person("AZR", "teacher4").first_name }).filter({ has: principal.page.getByRole("button", { name: "Approve" }) });
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
