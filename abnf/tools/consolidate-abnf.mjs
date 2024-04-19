import { readFile, writeFile } from "fs/promises";
import { parseString } from "abnf";
import assert from "assert";


const imported = {};
const importedAbnf = {};
const appliedDependencies = {};
const preprocessedDependencies = {};

const rfcNum = process.argv[2];
const profile = process.argv[3];

const dependencies = {};

// from node-abnf/bin/abnf_check.js
function check_refs(rules) {
  let ret = 0;
  rules.refs.forEach(ref => {
    if (!Object.prototype.hasOwnProperty.call(
      rules.defs,
      ref.name.toUpperCase()
    )) {
      const loc = ref.loc;
      console.error(`Reference to unknown rule "${ref.name}" at ${loc.source}:${loc.start.line}`);
      ret = 3;
    }
  });
  for (const name in rules.defs) {
    if ((rules.findRefs(name).length === 0) && (name !== rules.first)) {
      const loc = rules.defs[name].loc;
      console.error(`Unreferenced rule "${name}" at ${loc.source}:${loc.start.line}`);
      ret = 3;
    }
  }
  return ret;
}

async function parseABNF(rfcNum, base = "") {
  const file = `../source/rfc${rfcNum}.abnf`;
  const content = await readFile(file, 'utf-8');
  if (!importedAbnf[rfcNum]) {
    importedAbnf[rfcNum] = {base, content};
  }
  return parseString(base + "\n" + content, file);
}

function deleteRule(rfcNum, def) {
  if (def) {
    const {name,loc} = def;
    console.error(`Deleting ${name} from ${rfcNum}`);
    let {content, base } = importedAbnf[rfcNum];
    const offset = base.length + 1; // trailing "\n"
    const {offset: start} = loc.start;
    const {offset: end} = loc.end;
    const len = content.length;
    const filler = (end - start > name.length  + 3 ?
	  `;-${name}` + " ".repeat(end - start - 3 - name.length) :
		    " ".repeat(end - start - 1)) + "\n";
    content = content.substr(0, start - offset) + filler + content.substr(end - offset);
    assert(content.length === len, `Deleting rule doesn't change content size: ${content.length} vs ${len}`);
    importedAbnf[rfcNum].content = content;
  }
}

function extractRule(rfcNum, def) {
  return importedAbnf[rfcNum].content.substr(def.loc.start.offset - 1, def.loc.end.offset - def.loc.start.offset);
}


async function loadDependencies(rfcNum, profile) {
  if (!dependencies[rfcNum]) {
    let dependencyJSON;
    try {
      dependencyJSON = await readFile(`../annotations/rfc${rfcNum}.json`);
    } catch (e) {
      dependencies[`rfc${rfcNum}`] = {};
    }
    if (dependencyJSON) {
      dependencies[`rfc${rfcNum}`] = JSON.parse(dependencyJSON);
    }
  }

  let dependenciesDesc = dependencies[`rfc${rfcNum}`];
  if (Array.isArray(dependenciesDesc)) {
    if (!profile) {
      throw new Error(`Dependencies to ${rfcNum} needs to select a profile`);
    } else {
      dependenciesDesc = dependenciesDesc.find(d => d.name === profile);
      if (!dependenciesDesc) {
	throw new Error(`Unrecognized profile ${profile} when loading dependencies to ${rfcNum}`);
      }
    }
  }
  return dependenciesDesc;
}

async function preprocessDependencies(rfcNum, profile) {
  if (!preprocessedDependencies[rfcNum]) {
    console.error("Pre-processing dependencies rule for " + rfcNum + (profile ? " with profile " + profile : ""));
    preprocessedDependencies[rfcNum] = "";
    const dependenciesDesc = loadDependencies(rfcNum, profile);
    // TODO: sorting helps with ensuring "updates" relationship get taken up
    // in order of publication of RFC (which parallels their number)
    // but this may need to be done more generally than in pre-processing
    for (const [name, rfc] of Object.entries(dependenciesDesc.extends || {}).sort(([,a],[,b]) => a.localeCompare(b))) {
      const targetRfcNum = rfc.substr(3);
      // TODO: preprocess this rfc itself
      const rule = await importDependency(name, targetRfcNum);
      if (rule)
	preprocessedDependencies[rfcNum] += extractRule(targetRfcNum, rule) + "\n";
    }
  }
  return preprocessedDependencies[rfcNum];
}

async function applyDependencies(rfcNum, rfcRules, profile) {
  // TODO: can be removed once preprocessing is made recursive
  if (appliedDependencies[rfcNum]) return;
  console.error("Applyng dependencies rule for " + rfcNum + (profile ? " with profile " + profile : ""));
  const dependenciesDesc = loadDependencies(rfcNum, profile);
  // TODO: load RFC5234 systematically
  // Improvement: only when the relevant terms are being used/redefined
  for (const [name, rfc] of Object.entries(dependenciesDesc.imports || {})) {
    await importDependency(name, rfc.substr(3));
    deleteRule(rfcNum, rfcRules.defs[name.toUpperCase()]);
  }

  for (const [name, rfc] of Object.entries(dependenciesDesc.supersedes || {})) {
    const targetRfcNum = rfc.substr(3);
    const supersededRule = await importDependency(name, targetRfcNum);
    deleteRule(targetRfcNum, supersededRule);
  }

  const updatedRfc = dependenciesDesc.updates;
  const targetRfcNum = updatedRfc?.substr(3);
  if (updatedRfc && imported[targetRfcNum]) {
    console.error("Updating " + updatedRfc);
    for (const name of Object.keys(rfcRules.defs)) {
      const supersededRule = await importDependency(name, targetRfcNum);
      deleteRule(targetRfcNum, supersededRule);
    }
  }

  // remove "ignore" definitions
  for (const name of (dependenciesDesc.ignore || [])) {
    console.error(`ignoring ${name} from ${rfcNum}`);
    deleteRule(rfcNum, rfcRules.defs[name.toUpperCase()]);
  }

  appliedDependencies[rfcNum] = true;
}

async function importDependency(name, rfcNum, profile) {
  console.error(`importing ${name} from ${rfcNum}`);
  name = name.toUpperCase();
  if (!imported[rfcNum]) {
    imported[rfcNum] = {};
  }
  if (imported[rfcNum][name]) return imported[rfcNum][name];
  const importedRules = await parseABNF(rfcNum);
  await applyDependencies(rfcNum, importedRules, profile);
  imported[rfcNum][name] = importedRules.defs[name];
  if (importedRules.defs[name]?.def?.type === "ruleref") {
    await importDependency(importedRules.defs[name].def.name, rfcNum);
  } else if (importedRules.defs[name]?.def?.elements) {
    importedRules.defs[name].def.elements.filter(e => e.type === "ruleref")
      .forEach(async e => {
	await importDependency(e.name, rfcNum);
      });
  }
  return imported[rfcNum][name];
}

const baseABNF = await preprocessDependencies(rfcNum, profile);
const topRules = await parseABNF(rfcNum, baseABNF);
await applyDependencies(rfcNum, topRules, profile);

const consolidatedAbnfPreamble = `; Extracted from IETF ${Object.keys(importedAbnf).map(rfc => `RFC ${rfc}`).join(", ")}
; Copyright (c) IETF Trust and the persons identified as authors of the code. All rights reserved.
; Redistribution and use in source and binary forms, with or without modification, is permitted pursuant to, and subject to the license terms contained in, the Revised BSD License set forth in Section 4.c of the IETF Trust's Legal Provisions Relating to IETF Documents (https://trustee.ietf.org/license-info).
`;

const consolidatedAbnf = consolidatedAbnfPreamble + Object.entries(importedAbnf).map(([rfc, { content }]) => `;;;; from RFC ${rfc}\n${content}`).join("\n");
writeFile(`../consolidated/rfc${rfcNum}${profile ? `-${profile}` : ''}.abnf`, consolidatedAbnf);

const consolidatedRules = parseString(consolidatedAbnf);

// TODO: this doesn't detect extension of an unknown rule
check_refs(consolidatedRules);
// TODO: remove unused rules?

