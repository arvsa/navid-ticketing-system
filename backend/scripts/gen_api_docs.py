#!/usr/bin/env python3
"""Generate docs/api.html, a self-contained API reference.

Endpoints, parameters, bodies, responses and field types come from the
server's OpenAPI document; summaries and access notes are curated below;
error codes are read from docs/REFERENCE.md.

    python3 scripts/gen_api_docs.py                         # fetch from http://127.0.0.1:8080
    python3 scripts/gen_api_docs.py --url http://127.0.0.1:8099
    python3 scripts/gen_api_docs.py --file openapi.json     # or from a saved document

Re-run it whenever endpoints change.
"""

import argparse
import html
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Sidebar order and display names of the OpenAPI tags.
TAGS = [
    ("auth", "Session"),
    ("issues", "Issues"),
    ("work items", "Work items"),
    ("comments", "Comments"),
    ("reports", "Reports"),
    ("attachments", "Attachments"),
    ("events", "Events"),
    ("notifications", "Notifications & live updates"),
    ("dashboard", "Dashboard & export"),
    ("branches", "Branches"),
    ("members", "Members"),
    ("groups", "Groups & permissions"),
    ("users", "Users"),
    ("health", "Health"),
]

# "METHOD path": (summary, who may call it)
ANYONE = "Anyone signed in."
ENDPOINTS = {
    "GET /api/healthz": ("Check that the server and its database are up.", "Public, no session needed."),
    "POST /api/auth/login": ("Sign in with email and password. Sets the `sid` session cookie and returns your profile.", "Public. Five wrong passwords in a row lock the account for 15 minutes."),
    "POST /api/auth/logout": ("Sign out: ends this session and clears the cookie.", ANYONE),
    "GET /api/me": ("Your profile, branches, and effective permissions in each branch.", "Anyone signed in, even before changing a temporary password."),
    "POST /api/me/password": ("Change your password. Signs out your other sessions.", "Anyone signed in, even before changing a temporary password."),
    "GET /api/permissions": ("The catalog of grantable permissions and their allowed scopes, for admin screens.", ANYONE),

    "GET /api/branches": ("Branches you belong to (every branch for super admins).", ANYONE),
    "POST /api/branches": ("Create a branch with its first admin. An \"All members\" group is created automatically.", "Super admins only."),
    "GET /api/branches/{id}": ("One branch.", "Members of the branch and super admins."),
    "PATCH /api/branches/{id}": ("Rename a branch, change its code, timezone or email, or deactivate it.", "Super admins only."),
    "PUT /api/branches/{id}/admins/{user_id}": ("Make someone an admin of the branch (adds them as a member if needed).", "Super admins only."),
    "DELETE /api/branches/{id}/admins/{user_id}": ("Remove someone's admin role. A branch always keeps at least one admin.", "Super admins only."),
    "PUT /api/users/{id}/super-admin": ("Make a user a super admin.", "Super admins only."),
    "DELETE /api/users/{id}/super-admin": ("Remove a user's super admin role. At least one super admin always remains.", "Super admins only."),

    "GET /api/branches/{id}/members": ("The branch's member directory. Filter by group with `group_id`.", "Holders of `member.view` (everyone, by default). `include_left=true`: admins only."),
    "POST /api/branches/{id}/members": ("Add someone by email. New accounts get a one-time temporary password in the response.", "Admins and holders of `member.manage`. Bringing back someone who left: admins only."),
    "PATCH /api/branches/{id}/members/{user_id}": ("Edit a member's name or email.", "Admins; holders of `member.manage` for non-admin members."),
    "DELETE /api/branches/{id}/members/{user_id}": ("Remove someone from the branch. Their open work there becomes unassigned.", "Admins; holders of `member.manage` for non-admin members. Admins must be demoted first."),
    "GET /api/branches/{id}/members/{user_id}/effective-permissions": ("What someone may do in the branch, and which group each permission comes from.", "Admins, and the member themselves."),
    "POST /api/users/{id}/reset-password": ("Give a user a new temporary password and sign them out everywhere.", "Admins of a branch they belong to; holders of `member.manage` for non-admins. Super admin accounts: super admins only."),
    "PATCH /api/users/{id}/active": ("Deactivate (or reactivate) an account.", "Admins or `member.manage` for single-branch, non-admin members; otherwise super admins."),

    "GET /api/branches/{id}/groups": ("The branch's groups.", "Any member of the branch."),
    "POST /api/branches/{id}/groups": ("Create a group.", "Branch admins only."),
    "PATCH /api/groups/{id}": ("Rename a group, edit its description, archive or restore it.", "Branch admins only. \"All members\" can't be renamed or archived."),
    "DELETE /api/groups/{id}": ("Delete a group; one that issues were sent to is archived instead.", "Branch admins only."),
    "PUT /api/groups/{id}/members/{user_id}": ("Add a branch member to a group.", "Branch admins only."),
    "DELETE /api/groups/{id}/members/{user_id}": ("Remove someone from a group. Takes effect on their next request.", "Branch admins only."),
    "GET /api/groups/{id}/permissions": ("A group's grants.", "Branch admins only."),
    "POST /api/groups/{id}/permissions": ("Grant a permission to a group, optionally for one issue type, at a scope.", "Branch admins only."),
    "DELETE /api/group-permissions/{id}": ("Revoke a grant.", "Branch admins only."),

    "GET /api/issues": ("Issues you can see, newest first. Filter by branch, type, state, `assignee=me`, or title search `q`.", "Anyone signed in; private issues only where you may read them."),
    "POST /api/issues": ("Create a ticket, action, report or event, optionally sent to people or groups.", "Holders of `issue.create` for the type (members: tickets, reports, events). Targets need `issue.target`; `is_private` needs `issue.set_private`."),
    "GET /api/issues/{id}": ("One issue with its targets, work items, event details, files and your read state.", "Anyone who can read it (otherwise 404)."),
    "GET /api/issues/by-number/{n}": ("The same, looked up by number (`ISS-<n>`).", "Anyone who can read it (otherwise 404)."),
    "PATCH /api/issues/{id}": ("Edit title, description, priority, privacy or event details. Send the `version` you last saw.", "Holders of `issue.edit` (your own issues by default); privacy needs `issue.set_private`."),
    "POST /api/issues/{id}/close": ("Close the issue; any unfinished work is cancelled.", "Creators of tickets, reports and events; holders of `issue.close`; admins."),
    "POST /api/issues/{id}/cancel": ("Cancel the issue. For events, invitees who haven't declined are told.", "Same as closing."),
    "POST /api/issues/{id}/targets": ("Send the issue to another person, group or (super admins) whole branch. Creates work items and invitations.", "Holders of `issue.target`."),
    "DELETE /api/issues/{id}/targets/{target_id}": ("Stop sending the issue to a target; its unfinished work is cancelled.", "Holders of `issue.target`."),
    "POST /api/issues/{id}/read": ("Mark the issue as read (clears its `unread` flag).", "Anyone who can read it."),
    "PUT /api/issues/{id}/watch": ("Watch the issue to be told about new comments.", "Anyone who can read it."),
    "DELETE /api/issues/{id}/watch": ("Stop watching the issue.", "Anyone who can read it."),
    "GET /api/issues/{id}/history": ("The issue's change history.", "Anyone who can read it; staff-only comments appear only for staff."),

    "GET /api/work-items": ("Work you can see. Filter by `assignee=me`, status or branch.", ANYONE),
    "GET /api/work-items/{id}": ("One work item.", "Anyone who can read its issue."),
    "POST /api/work-items/{id}/{transition}": ("Move work along: `start`, `block`, `unblock`, `submit`, `approve`, `reject` (note required), `claim`, `assign` (`assignee_id`), `cancel`. Send the `version` you last saw.", "Updating: the assignee. Claim: members of the target group. Assign: admins or `work_item.assign`. Approve or reject: admins or `work_item.approve`, never your own work. Cancel: admins."),

    "GET /api/issues/{id}/comments": ("Comments on an issue, oldest first. Narrow to one work item with `work_item_id`.", "Anyone who can read the issue; staff-only comments only for staff."),
    "POST /api/issues/{id}/comments": ("Add a comment. Mentioned people (`mention_user_ids`) are notified.", "Holders of `comment.create`; staff-only comments need `comment.internal` or admin."),
    "PATCH /api/comments/{id}": ("Edit your comment.", "The comment's author."),
    "DELETE /api/comments/{id}": ("Delete a comment (its place in the thread remains).", "The author, admins, and holders of `comment.moderate`."),

    "GET /api/issues/{id}/reports": ("Written reports on a report issue: submitted ones, plus your own drafts.", "Anyone who can read the issue."),
    "POST /api/issues/{id}/reports": ("Start a report: for your work item, or for yourself on your own report issue.", "The work item's assignee, or the issue's creator."),
    "PATCH /api/reports/{id}": ("Edit your report. Send the `version` you last saw.", "The author, until the work is approved."),
    "POST /api/reports/{id}/submit": ("Submit the report. Then the work item can be submitted for approval.", "The author."),

    "POST /api/issues/{id}/attachments": ("Upload a file (max 25 MB) to the issue, your comment or your report. Send it as `multipart/form-data`.", "Anyone who may comment; for comments and reports, their author."),
    "GET /api/attachments/{id}": ("Download a file.", "Anyone who can see it (otherwise 404)."),

    "GET /api/calendar": ("Events you can see between `from` and `to`, with your RSVP.", ANYONE),
    "PUT /api/events/{id}/rsvp": ("Answer an invitation: `going`, `maybe` or `declined`.", "Invitees."),
    "GET /api/events/{id}/rsvps": ("Who's coming, with counts.", "Anyone who can read the event."),

    "GET /api/notifications": ("Your inbox, newest first. `unread=true` for unread only.", ANYONE),
    "GET /api/notifications/unread-count": ("The number of unread notifications, for the badge.", ANYONE),
    "POST /api/notifications/{id}/read": ("Mark one notification read.", "Its recipient."),
    "POST /api/notifications/read-all": ("Mark every notification read.", ANYONE),
    "GET /api/stream": ("Live updates (Server-Sent Events). Events carry IDs only; refetch what changed. See Live updates below.", ANYONE),

    "GET /api/dashboard": ("Numbers for one branch (`branch_id`) or all of yours: open issues, work by status, overdue and due-soon work, your work, approvals waiting for you, upcoming events, unread count.", "Anyone signed in. Branch-wide numbers need `dashboard.branch` or admin."),
    "GET /api/exports": ("Download an Excel workbook (Tickets, Actions, Reports, Events) for one branch, or several for super admins.", "One branch: admins and holders of `export.run`. Several or all: super admins."),
}

# Ready-to-use bodies for the most common calls (others get one built from
# their required fields).
EXAMPLES = {
    "POST /api/auth/login": {"email": "member1@north.demo.school", "password": "demo-password"},
    "POST /api/issues": {"branch_id": "BRANCH_ID", "type": "ticket", "title": "The projector is broken", "description": "Room 12"},
    "PATCH /api/issues/{id}": {"version": 1, "title": "New title"},
    "POST /api/issues/{id}/close": {"version": 1},
    "POST /api/issues/{id}/cancel": {"version": 1},
    "POST /api/issues/{id}/targets": {"user_id": "USER_ID"},
    "POST /api/issues/{id}/comments": {"body": "It flickers and then turns off."},
    "POST /api/work-items/{id}/{transition}": {"version": 1},
    "PUT /api/events/{id}/rsvp": {"response": "going"},
    "POST /api/me/password": {"current_password": "old-password", "new_password": "a-new-password"},
    "POST /api/groups/{id}/permissions": {"permission": "issue.create", "issue_type": "action", "scope": "branch"},
}

BASE = "http://127.0.0.1:8080"
ORIGIN = "http://localhost:5173"


def load_spec(args):
    if args.file:
        return json.loads(Path(args.file).read_text())
    with urllib.request.urlopen(f"{args.url.rstrip('/')}/api/openapi.json") as res:
        return json.load(res)


def error_codes():
    """(status, code, meaning) rows from docs/REFERENCE.md."""
    rows = []
    for line in (ROOT / "docs" / "REFERENCE.md").read_text().splitlines():
        m = re.match(r"\|\s*(\d{3})\s*\|\s*`([a-z_]+)`\s*\|\s*(.+?)\s*\|\s*$", line)
        if m:
            rows.append(m.groups())
    return rows


def esc(text):
    return html.escape(str(text), quote=True)


def md(text):
    """Escape, then render `code` spans."""
    return re.sub(r"`([^`]+)`", r"<code>\1</code>", esc(text))


def ref_name(ref):
    return ref.rsplit("/", 1)[-1]


def type_of(schema):
    """A short, linked type description."""
    if not schema:
        return "any"
    if "$ref" in schema:
        name = ref_name(schema["$ref"])
        return f'<a href="#schema-{esc(name)}">{esc(name)}</a>'
    for key in ("oneOf", "anyOf"):
        if key in schema:
            parts = [type_of(s) for s in schema[key]]
            return " | ".join(dict.fromkeys(parts))
    if "allOf" in schema:
        return " & ".join(type_of(s) for s in schema["allOf"])
    if "enum" in schema:
        return " | ".join(f"<code>{esc(json.dumps(v))}</code>" for v in schema["enum"])
    types = schema.get("type", "object")
    types = types if isinstance(types, list) else [types]
    out = []
    for t in types:
        if t == "array":
            out.append(f"array of {type_of(schema.get('items'))}")
        elif t == "null":
            out.append("null")
        else:
            fmt = schema.get("format")
            out.append(f"{t} <span class=\"fmt\">({esc(fmt)})</span>" if fmt else t)
    return " | ".join(out)


def example_value(schema, spec, depth=0):
    """A placeholder value for a schema, for curl examples."""
    if depth > 3 or not schema:
        return None
    if "$ref" in schema:
        return example_value(spec["components"]["schemas"].get(ref_name(schema["$ref"])), spec, depth + 1)
    for key in ("oneOf", "anyOf"):
        if key in schema:
            for s in schema[key]:
                if s.get("type") != "null":
                    return example_value(s, spec, depth + 1)
    if "enum" in schema:
        return schema["enum"][0]
    t = schema.get("type", "object")
    t = next((x for x in t if x != "null"), "string") if isinstance(t, list) else t
    fmt = schema.get("format")
    if t == "object":
        props = schema.get("properties", {})
        return {k: example_value(v, spec, depth + 1) for k, v in props.items() if k in schema.get("required", [])}
    if t == "array":
        return []
    if t == "boolean":
        return False
    if t in ("integer", "number"):
        return 1
    if fmt == "uuid":
        return "UUID"
    if fmt == "date-time":
        return "2026-10-20T09:00:00Z"
    return "..."


def curl(method, path, op, spec):
    url = BASE + re.sub(r"\{(\w+)\}", lambda m: m.group(1).upper(), path)
    public = op.get("security") == [{}]
    lines = [f"curl{' -b cookies.txt' if not public else ''}{' -c cookies.txt' if path == '/api/auth/login' else ''}"
             + (f" -X {method}" if method != "GET" else "") + f" '{url}'"]
    if method != "GET":
        lines.append(f"  -H 'Origin: {ORIGIN}'")
    content = (op.get("requestBody") or {}).get("content", {})
    key = f"{method} {path}"
    if "application/json" in content:
        body = EXAMPLES.get(key)
        if body is None:
            body = example_value(content["application/json"].get("schema"), spec)
        lines.append("  -H 'Content-Type: application/json'")
        lines.append(f"  -d '{json.dumps(body)}'")
    elif "multipart/form-data" in content:
        lines.append("  -F 'file=@notes.pdf;type=application/pdf'")
    if path == "/api/exports":
        lines[0] = lines[0].replace("curl", "curl -o export.xlsx", 1)
    return " \\\n".join(lines)


def fields_table(schema, spec):
    """Rows for an object schema's properties."""
    if "$ref" in schema:
        schema = spec["components"]["schemas"].get(ref_name(schema["$ref"]), {})
    rows = []
    required = set(schema.get("required", []))
    for part in schema.get("allOf", []):
        sub = spec["components"]["schemas"].get(ref_name(part["$ref"]), {}) if "$ref" in part else part
        required |= set(sub.get("required", []))
        for name, prop in sub.get("properties", {}).items():
            rows.append((name, prop))
    rows += list(schema.get("properties", {}).items())
    if not rows:
        return ""
    out = ['<table><thead><tr><th>Field</th><th>Type</th><th>Notes</th></tr></thead><tbody>']
    for name, prop in rows:
        desc = prop.get("description") or next((s.get("description") for s in prop.get("oneOf", []) if s.get("description")), "")
        req = '<span class="req">required</span> ' if name in required else ""
        out.append(f"<tr><td><code>{esc(name)}</code></td><td>{type_of(prop)}</td><td>{req}{md(desc)}</td></tr>")
    out.append("</tbody></table>")
    return "".join(out)


def params_table(op):
    params = op.get("parameters", [])
    if not params:
        return ""
    out = ['<h4>Parameters</h4><table><thead><tr><th>Name</th><th>In</th><th>Type</th><th>Notes</th></tr></thead><tbody>']
    for p in params:
        req = '<span class="req">required</span> ' if p.get("required") else ""
        out.append(f"<tr><td><code>{esc(p['name'])}</code></td><td>{esc(p['in'])}</td>"
                   f"<td>{type_of(p.get('schema'))}</td><td>{req}{md(p.get('description', ''))}</td></tr>")
    out.append("</tbody></table>")
    return "".join(out)


def responses(op):
    out = ['<h4>Responses</h4><ul class="responses">']
    for status, res in op.get("responses", {}).items():
        if status == "4XX":
            out.append('<li><span class="status err">4XX</span> <a href="#schema-ErrorResponse">ErrorResponse</a>: see <a href="#errors">error codes</a></li>')
            continue
        content = res.get("content", {})
        what = res.get("description", "")
        for ctype, c in content.items():
            schema = c.get("schema")
            what = (type_of(schema) if schema else f"<code>{esc(ctype)}</code>") + (f": {md(res.get('description'))}" if res.get("description") else "")
        out.append(f'<li><span class="status ok">{esc(status)}</span> {what or "No content"}</li>')
    out.append("</ul>")
    return "".join(out)


def anchor(method, path):
    return "op-" + method.lower() + re.sub(r"[^a-z0-9]+", "-", path.lower()).rstrip("-")


def build(spec):
    ops = {}
    for path, item in spec["paths"].items():
        for method, op in item.items():
            ops.setdefault(op.get("tags", ["other"])[0], []).append((method.upper(), path, op))
    method_order = {"GET": 0, "POST": 1, "PUT": 2, "PATCH": 3, "DELETE": 4}
    for tag in ops:
        ops[tag].sort(key=lambda o: (o[1], method_order.get(o[0], 9)))

    missing = [f"{m} {p}" for tag in ops for m, p, _ in ops[tag] if f"{m} {p}" not in ENDPOINTS]
    if missing:
        raise SystemExit(f"Add summaries for: {', '.join(missing)}")

    nav, sections = [], []
    for tag, title in TAGS:
        if tag not in ops:
            continue
        nav.append(f'<div class="nav-group"><div class="nav-title">{esc(title)}</div>')
        cards = []
        for method, path, op in ops[tag]:
            summary, access = ENDPOINTS[f"{method} {path}"]
            a = anchor(method, path)
            nav.append(f'<a class="nav-op" href="#{a}" data-search="{esc((method + " " + path + " " + summary).lower())}">'
                       f'<span class="m m-{method.lower()}">{method}</span><span class="p">{esc(path[4:])}</span></a>')
            body = ""
            content = (op.get("requestBody") or {}).get("content", {})
            if "application/json" in content:
                schema = content["application/json"].get("schema", {})
                body = f'<h4>Request body: {type_of(schema)}</h4>' + fields_table(schema, spec)
            elif content:
                rb = op["requestBody"]
                body = f'<h4>Request body: <code>{esc(next(iter(content)))}</code></h4><p>{md(rb.get("description", ""))}</p>'
            cards.append(f'''
<article class="op" id="{a}" data-search="{esc((method + " " + path + " " + summary).lower())}">
  <header><span class="m m-{method.lower()}">{method}</span><code class="path">{esc(path)}</code></header>
  <p class="summary">{md(summary)}</p>
  <p class="access"><strong>Who:</strong> {md(access)}</p>
  {params_table(op)}
  {body}
  {responses(op)}
  <details><summary>curl</summary><div class="code-wrap"><button class="copy" type="button">Copy</button><pre><code>{esc(curl(method, path, op, spec))}</code></pre></div></details>
</article>''')
        nav.append("</div>")
        sections.append(f'<section class="group" id="tag-{esc(tag.replace(" ", "-"))}"><h2>{esc(title)}</h2>{"".join(cards)}</section>')

    schemas = []
    for name in sorted(spec["components"]["schemas"]):
        s = spec["components"]["schemas"][name]
        desc = f"<p>{md(s.get('description', ''))}</p>" if s.get("description") else ""
        if "enum" in s:
            inner = "<p>One of: " + ", ".join(f"<code>{esc(v)}</code>" for v in s["enum"]) + "</p>"
        else:
            inner = fields_table(s, spec) or f"<p>{type_of(s)}</p>"
        schemas.append(f'<div class="schema" id="schema-{esc(name)}" data-search="{esc(name.lower())}"><h3>{esc(name)}</h3>{desc}{inner}</div>')

    errors = "".join(
        f'<tr><td><span class="status {"err" if st != "500" else "err"}">{st}</span></td><td><code>{esc(code)}</code></td><td>{md(meaning)}</td></tr>'
        for st, code, meaning in error_codes())
    total = sum(len(v) for v in ops.values())
    page = TEMPLATE.replace("{{NAV}}", "".join(nav)).replace("{{SECTIONS}}", "".join(sections)) \
        .replace("{{SCHEMAS}}", "".join(schemas)).replace("{{ERRORS}}", errors) \
        .replace("{{COUNT}}", str(total)).replace("{{BASE}}", BASE).replace("{{ORIGIN}}", ORIGIN)
    return page


TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>School Ticketing API</title>
<style>
:root {
  --bg: #fbfbfa; --panel: #ffffff; --text: #1d2125; --muted: #5d6670; --line: #e3e5e8;
  --accent: #2f5d8a; --code-bg: #f2f3f5; --side: #f4f5f6;
  --get: #2e7d4f; --post: #2f5d8a; --put: #8a5a1f; --patch: #6b4a99; --delete: #a33a3a;
  --ok: #2e7d4f; --err: #a33a3a;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #15181b; --panel: #1c2024; --text: #e6e8ea; --muted: #9aa3ab; --line: #2c3238;
    --accent: #7fb0e0; --code-bg: #23282d; --side: #181c1f;
    --get: #6cc795; --post: #7fb0e0; --put: #e0b070; --patch: #b79be6; --delete: #ec8585;
    --ok: #6cc795; --err: #ec8585;
  }
}
:root[data-theme="dark"] {
  --bg: #15181b; --panel: #1c2024; --text: #e6e8ea; --muted: #9aa3ab; --line: #2c3238;
  --accent: #7fb0e0; --code-bg: #23282d; --side: #181c1f;
  --get: #6cc795; --post: #7fb0e0; --put: #e0b070; --patch: #b79be6; --delete: #ec8585;
  --ok: #6cc795; --err: #ec8585;
}
* { box-sizing: border-box; }
html { scroll-padding-top: 16px; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.88em; }
code { background: var(--code-bg); padding: 1px 5px; border-radius: 4px; }
pre { background: var(--code-bg); padding: 12px 14px; border-radius: 6px; overflow-x: auto; margin: 0; }
pre code { background: none; padding: 0; }
.layout { display: grid; grid-template-columns: 300px minmax(0, 1fr); min-height: 100vh; }
aside { background: var(--side); border-right: 1px solid var(--line); position: sticky; top: 0; height: 100vh;
  overflow-y: auto; padding: 18px 14px 40px; }
aside .brand { font-weight: 650; font-size: 16px; margin: 0 6px 4px; }
aside .sub { color: var(--muted); font-size: 13px; margin: 0 6px 14px; }
#search { width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel);
  color: var(--text); font-size: 14px; margin-bottom: 14px; }
.nav-intro a { display: block; padding: 3px 6px; font-size: 14px; }
.nav-group { margin-top: 14px; }
.nav-title { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin: 0 6px 4px; }
.nav-op { display: flex; gap: 8px; align-items: baseline; padding: 3px 6px; border-radius: 4px; color: var(--text); font-size: 13px; }
.nav-op:hover { background: var(--panel); text-decoration: none; }
.nav-op .p { font-family: ui-monospace, Menlo, monospace; font-size: 12px; overflow-wrap: anywhere; }
main { padding: 32px 40px 80px; max-width: 980px; }
h1 { font-size: 28px; margin: 0 0 6px; }
h2 { font-size: 21px; margin: 44px 0 14px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
h3 { font-size: 16px; margin: 0 0 8px; }
h4 { font-size: 13px; margin: 16px 0 6px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.lead { color: var(--muted); margin: 0 0 22px; }
.intro { display: grid; gap: 10px; }
.intro ul { margin: 6px 0; padding-left: 20px; }
.m { display: inline-block; min-width: 54px; text-align: center; font: 600 11px/1.9 ui-monospace, Menlo, monospace;
  border-radius: 4px; color: #fff; padding: 0 6px; flex: none; }
.m-get { background: var(--get); } .m-post { background: var(--post); } .m-put { background: var(--put); }
.m-patch { background: var(--patch); } .m-delete { background: var(--delete); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .m { color: #111; } }
:root[data-theme="dark"] .m { color: #111; }
.op { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 16px 18px; margin: 0 0 14px; }
.op header { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.op .path { background: none; padding: 0; font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
.summary { margin: 10px 0 4px; }
.access { margin: 0; color: var(--muted); font-size: 14px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; margin: 4px 0; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: 12px; color: var(--muted); font-weight: 600; }
td:first-child { white-space: nowrap; }
.fmt { color: var(--muted); }
.req { font-size: 11px; color: var(--err); font-weight: 600; text-transform: uppercase; letter-spacing: .03em; }
.responses { list-style: none; padding: 0; margin: 4px 0; font-size: 14px; }
.responses li { padding: 3px 0; }
.status { display: inline-block; min-width: 40px; font: 600 12px ui-monospace, Menlo, monospace; }
.status.ok { color: var(--ok); } .status.err { color: var(--err); }
details { margin-top: 12px; }
details summary { cursor: pointer; color: var(--accent); font-size: 14px; }
.code-wrap { position: relative; margin-top: 8px; }
.copy { position: absolute; top: 6px; right: 6px; font-size: 12px; padding: 3px 8px; border-radius: 4px;
  border: 1px solid var(--line); background: var(--panel); color: var(--text); cursor: pointer; }
.schema { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px 18px; margin: 0 0 12px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px 18px; }
.theme { float: right; font-size: 12px; padding: 4px 8px; border-radius: 4px; border: 1px solid var(--line);
  background: var(--panel); color: var(--text); cursor: pointer; }
.hidden { display: none !important; }
@media (max-width: 860px) {
  .layout { display: block; }
  aside { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); max-height: 45vh; }
  main { padding: 22px 16px 60px; }
  td:first-child { white-space: normal; }
}
</style>
</head>
<body>
<div class="layout">
<aside>
  <div class="brand">School Ticketing API</div>
  <div class="sub">{{COUNT}} endpoints</div>
  <input id="search" type="search" placeholder="Filter endpoints and types" aria-label="Filter endpoints and types">
  <nav class="nav-intro">
    <a href="#start">Getting started</a>
    <a href="#conventions">Conventions</a>
    <a href="#live">Live updates</a>
    <a href="#errors">Error codes</a>
    <a href="#schemas">Types</a>
  </nav>
  {{NAV}}
</aside>
<main>
  <button class="theme" type="button" id="theme">Theme</button>
  <h1>School Ticketing API</h1>
  <p class="lead">Branches, people and groups; tickets, actions, reports and events; work and approvals; comments, files, notifications, a dashboard and exports.</p>

  <section id="start" class="intro">
    <h2>Getting started</h2>
    <div class="card">
      <ul>
        <li><strong>Base URL:</strong> <code>{{BASE}}/api</code></li>
        <li><strong>Sign in</strong> with <a href="#op-post-api-auth-login"><code>POST /api/auth/login</code></a>. It sets an HttpOnly cookie, <code>sid</code>; send it with every request.</li>
        <li><strong>Every non-GET request</strong> must also send <code>Origin: {{ORIGIN}}</code> (the frontend's address), or you get <code>403 origin_mismatch</code>.</li>
        <li>The machine-readable version of this page is <a href="{{BASE}}/api/openapi.json"><code>/api/openapi.json</code></a>.</li>
      </ul>
    </div>
    <div class="code-wrap"><button class="copy" type="button">Copy</button><pre><code># Sign in (the cookie is saved in cookies.txt)
curl -c cookies.txt -X POST {{BASE}}/api/auth/login \
  -H 'Origin: {{ORIGIN}}' -H 'Content-Type: application/json' \
  -d '{"email": "member1@north.demo.school", "password": "demo-password"}'

# Then send the cookie with -b
curl -b cookies.txt {{BASE}}/api/me</code></pre></div>
  </section>

  <section id="conventions" class="intro">
    <h2>Conventions</h2>
    <div class="card"><ul>
      <li><strong>JSON</strong> in and out. Times are RFC 3339 in UTC, e.g. <code>2026-10-20T09:00:00Z</code>.</li>
      <li><strong>IDs</strong> are UUIDs. Issues also have a number, shown as <code>ISS-42</code>.</li>
      <li><strong>Lists are paged:</strong> <code>?limit=50</code> (max 200). If the response has a <code>next_cursor</code>, pass it as <code>?after=...</code> for the next page.</li>
      <li><strong>Edits are versioned:</strong> send the <code>version</code> you last saw. If someone changed it meanwhile you get <code>409 version_conflict</code>; reload and retry.</li>
      <li><strong>404 means "not found or not yours to see"</strong>; the API never reveals that a private issue exists.</li>
      <li><strong>Errors</strong> always look like <code>{"error": {"code": "...", "message": "..."}}</code>. Branch on <code>code</code>.</li>
    </ul></div>
  </section>

  <section id="live" class="intro">
    <h2>Live updates</h2>
    <div class="card">
      <p><a href="#op-get-api-stream"><code>GET /api/stream</code></a> is a Server-Sent Events stream. Events carry only IDs, for example <code>{"kind": "issue_updated", "issue_id": "...", "branch_ids": ["..."]}</code>; refetch what changed through the normal endpoints.</p>
      <ul>
        <li><code>issue_created</code>, <code>issue_updated</code>, <code>work_item_updated</code>, <code>comment_*</code>, <code>report_*</code>, <code>rsvp_changed</code>: refetch that issue and any list showing it.</li>
        <li><code>notification</code>: your inbox changed; refetch the unread count.</li>
        <li><code>permissions_changed</code>, <code>member_changed</code>, <code>group_changed</code>, <code>branch_changed</code>: refetch <code>/api/me</code> and branch data.</li>
        <li><code>resync</code>: events may have been missed; refetch everything. <code>session_ended</code>: sign in again.</li>
      </ul>
      <p>Debounce refetches to at most once every 2 seconds, and refetch everything after reconnecting.</p>
    </div>
  </section>

  {{SECTIONS}}

  <section id="errors">
    <h2>Error codes</h2>
    <table><thead><tr><th>Status</th><th>Code</th><th>Meaning</th></tr></thead><tbody>{{ERRORS}}</tbody></table>
  </section>

  <section id="schemas">
    <h2>Types</h2>
    {{SCHEMAS}}
  </section>
</main>
</div>
<script>
(function () {
  var search = document.getElementById('search');
  search.addEventListener('input', function () {
    var q = search.value.trim().toLowerCase();
    document.querySelectorAll('[data-search]').forEach(function (el) {
      el.classList.toggle('hidden', q !== '' && el.getAttribute('data-search').indexOf(q) === -1);
    });
    document.querySelectorAll('.nav-group, section.group').forEach(function (g) {
      var visible = g.querySelectorAll('[data-search]:not(.hidden)').length > 0;
      g.classList.toggle('hidden', q !== '' && !visible);
    });
  });
  document.querySelectorAll('.copy').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.parentElement.querySelector('pre').innerText;
      navigator.clipboard.writeText(text).then(function () {
        btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = 'Copy'; }, 1200);
      });
    });
  });
  var root = document.documentElement, key = 'api-docs-theme';
  try { var saved = localStorage.getItem(key); if (saved) root.setAttribute('data-theme', saved); } catch (e) {}
  document.getElementById('theme').addEventListener('click', function () {
    var dark = root.getAttribute('data-theme') ? root.getAttribute('data-theme') === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    var next = dark ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem(key, next); } catch (e) {}
  });
})();
</script>
</body>
</html>
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default=BASE, help="server to read /api/openapi.json from")
    parser.add_argument("--file", help="read a saved OpenAPI document instead")
    parser.add_argument("--out", default=str(ROOT / "docs" / "api.html"))
    args = parser.parse_args()
    page = build(load_spec(args))
    Path(args.out).write_text(page)
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
