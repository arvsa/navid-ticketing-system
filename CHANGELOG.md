# Changelog

## Unreleased

### Added

- **Templates.** Super admins keep a school-wide list of templates
  (Set up → Templates): a name, a kind (ticket, action or event), a tag, and
  for actions a default due time and whether each person must hand in a
  written report. They show up as cards next to their kind in the New item
  form. Room is kept for custom fields later.
- **Directory.** Everyone can browse every branch, its departments and the
  people in them, search across the school, and open anyone's profile
  (cover, picture, bio, where they work). Names link to it.
- **Profile pictures.** Upload one on your profile (JPEG, PNG or WebP, up to
  2 MB); it shows beside your name everywhere.
- **Tags.** Items carry tags: the template's, plus any the sender adds or
  edits later. The items list filters by them (`?tag=`).
- **Settings without a rebuild.** Put a `.env` in `config/` next to
  `docker-compose.yml` (see `config/.env.example`): its values win over the
  compose file's, and the backend container restarts the backend with them
  a few seconds after the file is added, changed or removed, waiting until
  nothing holds a lock on the database. `health --db-idle` is that check.

### Changed

- Profiles (bio, cover, picture) are visible to everyone signed in, not only
  people in a shared branch.
- **Reports are actions made from the built-in Report template.** Existing
  reports become actions tagged `report` that still need the written report;
  report permission grants become action grants, so everyone who could file a
  report can now create actions (sending them still needs `issue.target`).
- The New item form no longer has a branch selector: an item goes school-wide
  on its own when its recipients are in more than one branch.
- Other branches' people and groups in the recipient picker are folded until
  you open them or search.
- **Everyone runs what they created.** While an item is open its creator can
  always edit, close and cancel it, actions included, whatever their grants.
- **Comments lock when their item closes.** Writing, editing and deleting
  your own comments works only while the item is open
  (`409 issue_not_open` after); moderators can still remove comments.
- **"Offline bundle" is now "release".** `get-release.sh`,
  `build-release.sh`, `docker-compose.release.yml` and
  `instructions/running-a-release.md`; the archive is
  `navid-release-<version>-<arch>.zip` and unzips to `navid-release/`.
  `get-release.sh` still fetches earlier `navid-offline` archives. The compose
  project stays `navid-offline`, so existing installs keep their data.


## v1.0.1

### Changed

- **The offline bundle starts empty, with one super admin.** On first start
  the backend creates `superadmin@school.local` (or `FIRST_SUPER_ADMIN_EMAIL`)
  when the database has no users, and prints its temporary password in
  `docker compose logs backend`. No demo data.
- The offline bundle's compose project is now `navid-offline`, so it no
  longer reuses the data of an earlier demo install (`navid-demo`).

### Upgrading

- To remove an earlier demo install and its data:
  `docker compose -p navid-demo down -v`.

## v1.0.0

The first release. The super admin now runs the app rather than the daily
work, branch admins can send work anywhere in the school, and work can be
passed along with every step reviewed on its way back up.

### Added

- **Super admin Setup page.** Super admins open on a Setup page: branches and
  their admins, people and groups, school-wide groups, export, the school's
  name and analytics. A "Send to branches" corner lets them send an item when
  they need to, without the daily pages in the way.
- **School analytics** (super admins), over the last 4, 12 or 26 weeks:
  - activity per branch, week by week (items created, work finished);
  - average time to finish, per branch;
  - on-time rate, per branch (finished work handed in by its due date);
  - workload per person: open work, how much is overdue, and how much is
    waiting for review.

  Every chart has a table view, and its colors are checked for contrast and
  color blindness in both themes.
- **Passing work along.** Whoever holds a task (an action or a report) can pass
  it to anyone in its branch, and pass it on again. A hand-in is reviewed by
  the person who passed it on; their approval sends it one level up, until the
  person who sent the item (or the branch's approvers) gives the final
  approval. Sending it back returns it to whoever handed it in, who can redo
  it or pass it down again. Every step is in the item's history, and the
  review drawer shows the chain and who reviews first.
- **Passing questions on.** A question (ticket) asked to you can be passed to
  someone else in your branch to answer.
- **Muting an item.** Mute an item to stop its comments and changes; work
  given to you, hand-ins waiting for your review and mentions still arrive.
- **Sending to other branches.** Branch admins can send items to chosen people
  or whole branches anywhere in the school, and can give this to others in
  their branch. A branch item can also go to its whole branch.
- **School-wide groups.** A group set up once for the whole school (for
  example, Teachers): every branch, including new ones, gets its own copy with
  the same permissions, and each branch admin chooses its members.
- **Bulk import of people** from Excel or CSV (English or Farsi column names),
  with a downloadable template. The file is checked first, row by row, and
  only imported when every row is fine; new people's temporary passwords can
  be downloaded once.
- **People export** (super admins): on Export, choose People to download
  everyone in chosen branches, or the whole school, as Excel: one row per
  person per branch with email, first and last name (the import template's
  columns), branch, admin, groups, account status, joined and last sign-in.
- **School name setting**, shown in everyone's header and on the sign-in page.
- **Person cards.** Click a name or avatar to see the person's email and
  branches.
- **Hints on icon buttons**, shown after a short pause or on keyboard focus.
- "Leave without saving?" when leaving unsaved permission changes.

### Changed

- **Super admins step out of the daily work.** My work, To approve, Calendar
  and the New button are hidden for them; they keep every power.
- **The sender runs what they sent.** On an item sent to other branches only
  the sender edits, closes or resends it, and the sender approves its work
  (alongside the work's branch approvers).
- The old rule that only super admins could edit and approve their own items
  is gone, and so are those items (see *Upgrading*).
- **A branch can open without an admin**: open it, import its people, then
  appoint the admin. Once it has an admin, its last one still can't be
  removed.
- The time zone list can be searched by country and zone name ("Iran",
  "Iran Time") as well as by its ID (Asia/Tehran), which is the default for
  new branches.
- "To approve" appears whenever something is waiting for your review, not
  only for people with the approve permission.
- Farsi is the default language unless someone picks English.
- A calmer dark theme: warm graphite, softer text, and gentler colors; the
  selected tab is a raised surface instead of a bright block.
- Less on screen: icon buttons for New, Edit, Rename, Export, Add member,
  Import, Attach and Send; shorter explanations on the group pages; no big
  number pills on Home (the panels below show the same counts); no duplicate
  "Send to branches" button.
- Saving a group's permissions is a single step: all or nothing, with one
  notification to admins instead of one per change.

### Fixed

- The SLA reminder job failed every run once many people were due: all
  recipients went into one database notification, over Postgres's 8000-byte
  limit. Recipients are now de-duplicated and split.
- On an item, the status filters overlapped the "Sent to" row.
- Notifications about groups now name the group and the person.
- A sent-back report could not be changed or given files by whoever holds
  the work now (after it was passed on or approved up the chain); the
  holder can now edit it and attach files, and its writer stays credited.
- Reviewers can attach files when approving or sending back; they go on that
  part's thread, where the assignee sees them.
- Work waiting for your review from a school-wide item, an item you sent to
  another branch, or work you passed on now shows on To approve, and the
  item shows in your branch's Items list, not only on Home.

### Optimized

- Bulk import checks the whole file in one pass and adds everyone in one
  transaction, with passwords prepared in parallel, so hundreds of people go
  in at once.
- Group permission changes reach every branch copy and every member's open
  pages in one save.

### Upgrading

- Database migrations 0007 to 0013 run on start. **Migration 0010 deletes the
  items that only super admins could approve**, with their work, comments,
  reports and notifications (their attached files stay on disk).
- Build the backend with `SQLX_OFFLINE=true` when the database is behind the
  code.
- The offline bundle builds as version 1.0.0 by default.
