"""Builds the four branch rosters (Excel, the import template's columns) and
roster.json, which tells the tests who plays which role."""
import json, zipfile, pathlib
from xml.sax.saxutils import escape

HERE = pathlib.Path(__file__).parent
SRC = HERE.parents[2] / "instructions" / "people-import-example.xlsx"

BRANCHES = [
    ("AZR", "Azar Campus"), ("MTH", "Motahari Campus"), ("SDR", "Sadra Campus"), ("FRZ", "Farzan Campus"),
]
FIRST = ["مریم", "علی", "فاطمه", "حسین", "زهرا", "رضا", "سارا", "محمد", "نرگس", "امیر", "لیلا", "مهدی"]
LAST = ["حسینی", "رضایی", "محمدی", "کریمی", "احمدی", "موسوی", "جعفری", "صادقی", "نوری", "کاظمی", "رحیمی", "یزدانی"]
ROLES = ["principal", "vice", "teacher1", "teacher2", "teacher3", "teacher4", "it", "nurse", "counselor", "accountant"]
LATIN = {"principal": "principal", "vice": "vice", "it": "it", "nurse": "nurse", "counselor": "counselor", "accountant": "accounts"}

roster = {"branches": [], "ceo": None}
for b, (code, name) in enumerate(BRANCHES):
    people = []
    for i, role in enumerate(ROLES):
        k = (b * 3 + i) % len(FIRST)
        local = LATIN.get(role, role)
        people.append({"role": role, "email": f"{local}@{code.lower()}.rnn.school",
                       "first_name": FIRST[k], "last_name": LAST[(k + b) % len(LAST)]})
    if code == "AZR":
        people.append({"role": "ceo", "email": "ceo@rnn.school", "first_name": "کامران", "last_name": "نویدی"})
        people.append({"role": "ithead", "email": "it.head@rnn.school", "first_name": "بهروز", "last_name": "فنی"})
    # Someone listed twice and a row with no name, to see the import's checks.
    extra = [] if code != "FRZ" else [dict(people[2]), {"role": None, "email": "no.name@frz.rnn.school", "first_name": "", "last_name": ""}]
    roster["branches"].append({"code": code, "name": name, "file": f"roster-{code}.xlsx", "people": people})

    rows = [["email", "first_name", "last_name"]] + [[p["email"], p["first_name"], p["last_name"]] for p in people + extra]
    def cell(r, c, v):
        ref = "ABC"[c] + str(r + 1)
        return f'<c r="{ref}" t="inlineStr"><is><t>{escape(v)}</t></is></c>' if v else ""
    sheet = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
             '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
             + "".join(f'<row r="{r + 1}">' + "".join(cell(r, c, v) for c, v in enumerate(row)) + "</row>" for r, row in enumerate(rows))
             + "</sheetData></worksheet>")
    with zipfile.ZipFile(SRC) as zin, zipfile.ZipFile(HERE / f"roster-{code}.xlsx", "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = sheet.encode() if item.filename == "xl/worksheets/sheet1.xml" else zin.read(item.filename)
            zout.writestr(item, data)
(HERE / "roster.json").write_text(json.dumps(roster, ensure_ascii=False, indent=1))
print("ok")
