// Generates src/api/schema.d.ts from the running backend's OpenAPI document.
// Two problems in the backend's document are patched before generating (see
// README "API gaps"): it references a `Transition` schema it never defines, and
// several operations share an `operationId` (e.g. `list`).
import { writeFileSync } from "node:fs";
import openapiTS, { astToString } from "openapi-typescript";

const url = process.env.OPENAPI_URL ?? "http://127.0.0.1:8080/api/openapi.json";
const doc = await (await fetch(url)).json();
doc.components.schemas.Transition ??= {
  type: "string",
  enum: ["start", "block", "unblock", "submit", "approve", "reject", "claim", "assign", "cancel"],
};
for (const [path, ops] of Object.entries(doc.paths)) {
  for (const [method, op] of Object.entries(ops)) {
    op.operationId = `${method}_${path.replace(/[^a-zA-Z0-9]+/g, "_")}`;
  }
}
const ast = await openapiTS(doc);
writeFileSync(new URL("../src/api/schema.d.ts", import.meta.url), astToString(ast));
console.log("Wrote src/api/schema.d.ts");
