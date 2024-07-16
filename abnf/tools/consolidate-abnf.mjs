import { readFile, writeFile, readdir } from "fs/promises";
import { processAnnotations } from "./lib/processAnnotations.mjs";
import { listMissingReferencedDefs, coreNames } from "./lib/processAbnf.mjs";

import { parseString } from "abnf";

const topRfcNum = process.argv[2];
const topProfile = process.argv[3];

const importedRfcs = new Set();



async function rfcLoader(rfcNum) {
  importedRfcs.add(rfcNum);
  return readFile(new URL(`../source/${rfcNum}.abnf`, import.meta.url), 'utf-8');
}

async function annotationLoader(rfcNum) {
  let data;
  try {
    data = await readFile(new URL(`../annotations/${rfcNum}.json`, import.meta.url));
  } catch (e) {
    return {};
  }
  return JSON.parse(data);
}

let consolidatedAbnf;
if (!Object.keys(await annotationLoader(topRfcNum)).length) {
  console.error(`No annotations found for ${topRfcNum}, no consolidation needed`);
  consolidatedAbnf = await rfcLoader(topRfcNum);
} else {
  consolidatedAbnf = await processAnnotations(process.argv[2], rfcLoader, annotationLoader);
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
  console.error("The following rules are missing - likely needs to be imported:", [...missing].join(", "));
  process.exit(2);
}

const proseRules = Object.values(consolidatedRules.defs).filter(d => d.def?.type === "prose");
if (proseRules.length) {
  console.warn("The following rules are prose declaration - check they're not hiding imports:", proseRules.map(r => `${r.name} (${r.def.str})`).join(", "));
}

await writeFile(new URL(`../consolidated/${topRfcNum}${topProfile ? `-${topProfile}` : ''}.abnf`, import.meta.url), consolidatedAbnf);
