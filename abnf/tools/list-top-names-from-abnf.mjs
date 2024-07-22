import { readFile } from "fs/promises";
import { listUnreferencedDefs } from "./lib/processAbnf.mjs";

import { parseString } from "abnf";

const file = process.argv[2];
const abnf = await readFile(file, "utf-8");

const unreferenced = listUnreferencedDefs(abnf);

if (!unreferenced.length)  {
  const rules = parseString(abnf);
  console.log("Top rule:", rules.first);
} else {
  console.log("Unreferenced rules:", unreferenced.join(", "));
}
