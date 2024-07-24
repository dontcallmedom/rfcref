import { writeFile, readdir } from "fs/promises";
import { processDependencies } from "./lib/processDependencies.mjs";
import { listMissingReferencedDefs, coreNames } from "./lib/processAbnf.mjs";
import { dependencyLoader, rfcLoader } from "./lib/loaders.mjs";
import { parseString } from "abnf";


const importedRfcs = new Set();

const trackingRfcLoader = function(rfcNum) {
  importedRfcs.add(rfcNum);
  return rfcLoader(rfcNum);
};


export default async function consolidateAbnf(rfcNum, profile) {
  let consolidatedAbnf;
  let dependencies = await dependencyLoader(rfcNum);
  if (Array.isArray(dependencies)) {
    if (!profile) {
      throw new Error(`Dependencies for ${rfcNum} are organized in ${dependencies.length} profiles, which must be named as a second parameter. Possible values: ${dependencies.map(d => d.name).join(", ")}`);
    }
    dependencies = dependencies.find(d => d.name === profile);
    if (!dependencies) {
      throw new Error(`Unknown profile ${profile}. Possible values for profile of dependencies for ${rfcNum} are: ${dependencies.map(d => d.name).join(", ")}`);
    }
  }
  if (!Object.keys(dependencies)) {
    console.warn(`No dependencies found for ${rfcNum}, no consolidation needed`);
    consolidatedAbnf = await rfcLoader(rfcNum);
  } else {
    consolidatedAbnf = await processDependencies({abnfName: rfcNum, profile: profile}, rfcLoader, dependencyLoader);
  }

  const consolidatedAbnfPreamble = `; Extracted from IETF ${[...importedRfcs].map(rfc => `RFC ${rfc.slice(3)}`).join(", ")}
; Copyright (c) IETF Trust and the persons identified as authors of the code. All rights reserved.
; Redistribution and use in source and binary forms, with or without modification, is permitted pursuant to, and subject to the license terms contained in, the Revised BSD License set forth in Section 4.c of the IETF Trust's Legal Provisions Relating to IETF Documents (https://trustee.ietf.org/license-info).
`;

  let consolidatedRules;
  try {
    consolidatedRules = parseString(consolidatedAbnf);
  } catch(e) {
    throw new Error("Consolidated ABNF cannot be parsed", e.message);
  }
  const missing = new Set(listMissingReferencedDefs(consolidatedAbnf)).difference(coreNames);
  if (missing.size) {
    throw new Error("The following rules are missing - likely needs to be imported:", [...missing].join(", "));
  }
  return consolidatedAbnf;
}

if ( import.meta.filename === process?.argv[1] ) {
  const topRfcNum = process.argv[2];
  const topProfile = process.argv[3];

  if (!topRfcNum) {
    console.error(`Missing rfc<num> as first parameter`);
    process.exit(2);
  }

  const consolidatedAbnf = await consolidateAbnf(topRfcNum, topProfile);
  const consolidatedRules = parseString(consolidatedAbnf);
  const proseRules = Object.values(consolidatedRules.defs).filter(d => d.def?.type === "prose");
  if (proseRules.length) {
    console.warn("The following rules are prose declaration - check they're not hiding imports:", proseRules.map(r => `${r.name} (${r.def.str})`).join(", "));
  }

  await writeFile(new URL(`../consolidated/${topRfcNum}${topProfile ? `-${topProfile}` : ''}.abnf`, import.meta.url), consolidatedAbnf);
}
