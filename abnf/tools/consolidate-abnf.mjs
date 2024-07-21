import { readFile, writeFile, readdir } from "fs/promises";
import { processDependencies } from "./lib/processDependencies.mjs";
import { listMissingReferencedDefs, coreNames } from "./lib/processAbnf.mjs";

import { parseString } from "abnf";

const topRfcNum = process.argv[2];
const topProfile = process.argv[3];

if (!topRfcNum) {
  console.error(`Missing rfc<num> as first parameter`);
  process.exit(2);
}


const importedRfcs = new Set();



async function rfcLoader(rfcNum) {
  importedRfcs.add(rfcNum);
  return readFile(new URL(`../source/${rfcNum}.abnf`, import.meta.url), 'utf-8');
}

async function dependencyLoader(rfcNum) {
  let data;
  try {
    data = await readFile(new URL(`../dependencies/${rfcNum}.json`, import.meta.url));
  } catch (e) {
    return {};
  }
  return JSON.parse(data);
}

let consolidatedAbnf;
let dependencies = await dependencyLoader(topRfcNum);
if (Array.isArray(dependencies)) {
  if (!topProfile) {
    console.error(`Dependencies for ${topRfcNum} are organized in ${dependencies.length} profiles, which must be named as a second parameter. Possible values: ${dependencies.map(d => d.name).join(", ")}`);
    process.exit(2);
  }
  dependencies = dependencies.find(d => d.name === topProfile);
  if (!dependencies) {
    console.error(`Unknown profile ${topProfile}. Possible values for profile of dependencies for ${topRfcNum} are: ${dependencies.map(d => d.name).join(", ")}`);
    process.exit(2);
  }
}
if (!Object.keys(dependencies)) {
  console.error(`No dependencies found for ${topRfcNum}, no consolidation needed`);
  consolidatedAbnf = await rfcLoader(topRfcNum);
} else {
  const { base, abnf } = await processDependencies({source: topRfcNum, profile: topProfile}, rfcLoader, dependencyLoader);
  consolidatedAbnf = base + "\n" + abnf;
}

const consolidatedAbnfPreamble = `; Extracted from IETF ${[...importedRfcs].map(rfc => `RFC ${rfc.slice(3)}`).join(", ")}
; Copyright (c) IETF Trust and the persons identified as authors of the code. All rights reserved.
; Redistribution and use in source and binary forms, with or without modification, is permitted pursuant to, and subject to the license terms contained in, the Revised BSD License set forth in Section 4.c of the IETF Trust's Legal Provisions Relating to IETF Documents (https://trustee.ietf.org/license-info).
`;

let consolidatedRules;
try {
  consolidatedRules = parseString(consolidatedAbnf);
} catch(e) {
  console.error("Consolidated ABNF cannot be parsed", e.message);
  process.exit(2);
}
const missing = new Set(listMissingReferencedDefs(consolidatedAbnf)).difference(coreNames);
if (missing.size) {
  console.error("The following rules are missing - likely needs to be imported:", [...missing].join(", "), ` (draft dependencies file saved in dependencies/${topRfcNum}.json.dist)`);
  await writeFile(new URL(`../dependencies/${topRfcNum}.json.dist`, import.meta.url), JSON.stringify({ imports: Object.fromEntries([...missing].map(m => [m, ""]))}, null, 2));
  process.exit(2);
}

const proseRules = Object.values(consolidatedRules.defs).filter(d => d.def?.type === "prose");
if (proseRules.length) {
  console.warn("The following rules are prose declaration - check they're not hiding imports:", proseRules.map(r => `${r.name} (${r.def.str})`).join(", "));
}

await writeFile(new URL(`../consolidated/${topRfcNum}${topProfile ? `-${topProfile}` : ''}.abnf`, import.meta.url), consolidatedAbnf);
