import { readFile, writeFile } from "fs/promises";
import { parseString } from "abnf";
import assert from "assert";


const imported = {};
const importers = {};
const importedAbnf = {};
const appliedDependencies = {};
const preprocessedDependencies = {};

const coreAbnfImports = ["ALPHA", "BIT", "CHAR", "CR", "CRLF", "CTL", "DIGIT",
			 "DQUOTE", "HEXDIG", "HTAB", "LF", "LWSP", "OCTET",
			 "SP", "VCHAR", "WSP"];

const toUpdateDependencies = {};

const coreAbnf = coreAbnfImports.reduce((acc, b) => {
  acc[b] = "rfc5234";
  return acc;
}, {});

const topRfcNum = process.argv[2];
const topProfile = process.argv[3];

const dependencies = {};

function log(message) {
  console.error(message);
}

// from node-abnf/bin/abnf_check.js
function check_refs(rules) {
  let ret = 0;
  rules.refs.forEach(ref => {
    if (!Object.prototype.hasOwnProperty.call(
      rules.defs,
      ref.name.toUpperCase()
    )) {
      const loc = ref.loc;
      log(`Reference to unknown rule "${ref.name}" at ${loc.source}:${loc.start.line}`);
      ret = 3;
    }
  });
  for (const name in rules.defs) {
    if ((rules.findRefs(name).length === 0) && (name !== rules.first)) {
      const loc = rules.defs[name].loc;
      log(`Unreferenced rule "${name}" at ${loc.source}:${loc.start.line}`);
      ret = 3;
    }
  }
  return ret;
}

async function parseABNF(rfcNum, profile) {
  // TODO: load consolidated instead when importing a dependency?
  let base, content;
  const file = `../source/rfc${rfcNum}.abnf`;
  if (importedAbnf[rfcNum]) {
    ({base, content} = importedAbnf[rfcNum]);
  } else {
    base = await preprocessDependencies(rfcNum, profile);
    content = await readFile(file, 'utf-8');
    importedAbnf[rfcNum] = {base, content};
    await preParserDependencies(rfcNum, profile);
  }
  return parseString(base + "\n" + importedAbnf[rfcNum].content, file);
}

function renameRule(rfcNum, name, importRfc = rfcNum, newName) {
  if (newName) {
    log(`Renaming ${name}  from ${rfcNum} into ${newName}`);
  } else {
    log(`Prefixing ${name} from ${rfcNum} with ${importRfc}`);
    newName = `rfc${importRfc}${name}`;
  }
  let {content, base } = importedAbnf[rfcNum];
  const offset = base.length + 1; // trailing "\n"

  const rules = parseString(base + "\n" + content);
  const instances = rules.refs.filter(r => r.name.toUpperCase() === name.toUpperCase());
  const def = rules.defs[name.toUpperCase()];
  if (def) {
    instances.push(def);
  }
  instances.sort((r1, r2) => r2.loc.start.offset - r1.loc.start.offset);
  // rename all the instance of the rules (both in its definition
  // and its references) starting from the end, to avoid disrupting
  // location information
  for (const r of instances) {
    const {offset: start} = r.loc.start;
    const end = start + name.length;
    if (start > offset) {
      // FIXME: rfcNum may contain profile which wouldn't be ABNF valid?
      content = content.substr(0, start - offset) + `${newName}` + content.substr(end - offset);
    } else {
      base = base.substr(0, start) + `${newName}` + base.substr(end);
    }
  }
  importedAbnf[rfcNum].content = content;
  importedAbnf[rfcNum].base = base;
}

function deleteRule(rfcNum, def) {
  if (def) {
    const {name,loc} = def;
    log(`Deleting ${name} from ${rfcNum}`);
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
  if (rfcNum !== 5234) {
    // load RFC5234 systematically
    // TODO: may need revisiting if we import consolidated dependencies?
    if (!dependenciesDesc.imports) {
      dependenciesDesc.imports = {};
    }
    Object.assign(dependenciesDesc.imports, coreAbnf);
  }
  return dependenciesDesc;
}

function numAndProfile(rfc) {
  if (!rfc) return [];
  const m = rfc.match(/^rfc([0-9]+)\|?(.+)?$/);
  if (m) {
    return [parseInt(m[1], 10), m[2]];
  } else {
    throw new Error(`Cannot parse ${rfc} as refering to an RFC number (and optionally a profile)`);
  }
}

function toRfcKey(num, profile) {
  return `rfc${num}${profile ? `|${profile}`: ''}`;
}

async function preprocessDependencies(rfcNum, profile) {
  if (!preprocessedDependencies[rfcNum]) {
    log("Pre-processing dependencies rule for " + rfcNum + (profile ? " with profile " + profile : ""));
    preprocessedDependencies[rfcNum] = "";
    const dependenciesDesc = await loadDependencies(rfcNum, profile);
    // sorting helps with ensuring "updates" relationship get taken up
    // in order of publication of RFC (which parallels their number)
    for (const [name, rfc] of Object.entries(dependenciesDesc.extends || {}).sort(([,a],[,b]) => a.localeCompare(b))) {
      const [targetRfcNum, targetProfile] = numAndProfile(rfc);
      const rule = await importDependency(name, targetRfcNum, targetProfile);
      if (rule) {
	preprocessedDependencies[rfcNum] += extractRule(targetRfcNum, rule) + "\n";
      }
    }
  }
  return preprocessedDependencies[rfcNum];
}

async function preParserDependencies(rfcNum, profile) {
  const dependenciesDesc = await loadDependencies(rfcNum, profile);
  // optimistically assume that definitions marked as "ignore"
  // are "=/" rules we don't want to trip over when parsing
  for (const name of (dependenciesDesc.ignore || [])) {
    log(`Transforming '=/' ${name} rules from ${rfcNum} into '='`);
    const r = new RegExp(`^(${name} +)(=\/)`, "mi");
    if (!r.test(importedAbnf[rfcNum].content)) {
      throw new Error(`Could not find ${name} rule to neuter`);
    }
    importedAbnf[rfcNum].content = importedAbnf[rfcNum].content.replace(r, "$1 =");
  }
}

async function updateRfc(updated, updater, updatedRules, updaterRules) {
  log("Updating " + updated);
  const [updatedRfcNum, updatedProfile] = numAndProfile(updated);
  const [updaterRfcNum, updaterProfile] = numAndProfile(updater);
  if (!updaterRules) {
    updaterRules = toUpdateDependencies[updater];
  }
  if (!updaterRules) return;
  for (const name of Object.keys(updaterRules.defs)) {
    let supersededRule;
    if (!updatedRules) {
      supersededRule = await importDependency(name, updatedRfcNum, updatedProfile);
    } else {
      supersededRule = updatedRules.defs[name.toUpperCase()];
    }
    deleteRule(updatedRfcNum, supersededRule);
  }
  delete toUpdateDependencies[updated];
}

async function postParserDependencies(rfcNum, rfcRules, profile) {
  if (appliedDependencies[rfcNum]) return;

  log("Applying dependencies rule for " + rfcNum + (profile ? " with profile " + profile : ""));
  const dependenciesDesc = await loadDependencies(rfcNum, profile);
  // Improvement: only when the relevant terms are being used/redefined
  for (let [name, rfc] of Object.entries(dependenciesDesc.imports || {})) {
    let importedName = name;
    if (rfc.name) {
      importedName = rfc.name;
      rfc = rfc.source;
    }
    await importDependency(importedName, ...numAndProfile(rfc));
    if (!importers[name]) {
      importers[name] = [];
    }
    importers[name].push({"importer": toRfcKey(rfcNum, profile), "imported": rfc, importedName: importedName !== name ? importedName : undefined});
    deleteRule(rfcNum, rfcRules.defs[name.toUpperCase()]);
  }

  for (const [name, rfc] of Object.entries(dependenciesDesc.supersedes || {})) {
    const [ targetRfcNum, targetProfile ] = numAndProfile(rfc);
    const supersededRule = await importDependency(name, targetRfcNum, targetProfile);
    deleteRule(targetRfcNum, supersededRule);
  }

  const updatedRfc = dependenciesDesc.updates;
  const [targetRfcNum, targetProfile] = numAndProfile(updatedRfc);
  const rfcKey = toRfcKey(rfcNum, profile);
  if (updatedRfc) {
    if (imported[targetRfcNum]) {
      await updateRfc(updatedRfc, rfcKey , null, rfcRules);
    } else {
      if (!toUpdateDependencies[updatedRfc]) {
	toUpdateDependencies[updatedRfc] = {};
      }
      toUpdateDependencies[updatedRfc][rfcKey] = rfcRules;
      console.log(updatedRfc + " may need to be updated");
    }
  }

  if (toUpdateDependencies[rfcKey]) {
    for (const [updaterRfc, rules] of Object.entries(toUpdateDependencies[rfcKey])) {
      await updateRfc(rfcKey, updaterRfc, rfcRules, rules);
    }
  }

  // remove "ignore" definitions
  for (const name of (dependenciesDesc.ignore || [])) {
    log(`ignoring ${name} from ${rfcNum}`);
    deleteRule(rfcNum, rfcRules.defs[name.toUpperCase()]);
  }

  appliedDependencies[rfcNum] = true;
}

async function preConsolidationDependencies() {
  const conflicts = {};
  const renames = {};
  const importConflicts = {};
  const importedNames = Object.entries(importers).reduce((acc, [name, links]) => {
    for (const {imported, importer, importedName} of links) {
      if (!acc[name]) {
	acc[name] = [];
      }
      if (!acc[name].includes(imported)) {
	acc[name].push(imported);
      }
      if (importedName) {
	if (!renames[imported]) {
	  renames[imported] = {};
	}
	// TODO: detect if several distinct renames occur
	renames[imported][importedName] = name;
      }
    }
    return acc;
  }, {});
  // Is there any known conflicting named definition
  // across our list of dependencies?
  // If so, rename the rule (if possible, don't rename in a given source
  // when it's imported  only from that source)
  for (const rfc of Object.keys(imported).sort()) {
    const [rfcNum, profile] = numAndProfile(rfc);
    const dependenciesDesc = await loadDependencies(rfcNum, profile);
    for (const name of Object.keys(dependenciesDesc.conflicts || {})) {
      if (!conflicts[name]) {
	conflicts[name] = [];
      }
      conflicts[name].push(rfc);
    }
  }
  for (const name of Object.keys(conflicts)) {
    if (conflicts[name].length > 1) {
      let winner = conflicts[name][0];
      if (importedNames[name]) {
	if (importedNames[name].length > 1) {
	  // walk back the list importers and rename them there as well
	  importConflicts[name] = [];
	  for (const {importer, imported} of importers[name]) {
	    importConflicts[name].push([importer, imported]);
	  }
	  throw new Error(`${name} is defined and imported as a rule from more than one source: ${importedNames[name].join(', ')} ${importConflicts[name]}`);
	}
	if (importedNames[name].length === 1) {
	  winner = importedNames[name][0];
	}
      }
      for (const rfc of conflicts[name]) {
	if (rfc === winner) continue;
	// prefix the rule and its references in that ABNF
	// with the RFC name
	const [rfcNum, profile] = numAndProfile(rfc);
	renameRule(rfcNum, name);
      }
      for (const [rfc, importRfc] of (importConflicts[name] ?? [])) {
	const [rfcNum, profile] = numAndProfile(rfc);
	const [importRfcNum] = numAndProfile(importRfc);
	renameRule(rfcNum, name, importRfcNum);

      }
    }
  }
  for (const [rfc, rename] of Object.entries(renames)) {
    const [rfcNum, profile] = numAndProfile(rfc);
    for (const [origName, newName] of Object.entries(rename)) {
      renameRule(rfcNum, origName, rfcNum, newName);
    }
  }
}

async function importDependency(name, rfcNum, profile) {
  const key = toRfcKey(rfcNum, profile);
  log(`importing ${name} from ${key}`);
  name = name.toUpperCase();
  if (!imported[key]) {
    imported[key] = {};
  }
  if (imported[key][name]) return imported[key][name];
  const importedRules = await parseABNF(rfcNum, profile);
  // TODO: replace by loading consolidated ABNF?
  await postParserDependencies(rfcNum, importedRules, profile);
  imported[key][name] = importedRules.defs[name];
  if (importedRules.defs[name]?.def?.type === "ruleref") {
    await importDependency(importedRules.defs[name].def.name, rfcNum, profile);
  } else if (importedRules.defs[name]?.def?.elements) {
    importedRules.defs[name].def.elements.filter(e => e.type === "ruleref")
      .forEach(async e => {
	await importDependency(e.name, rfcNum, profile);
      });
  }
  return imported[key][name];
}

let topRules;
try {
  topRules = await parseABNF(topRfcNum, topProfile);
} catch (e) {
  console.error(e.message, e.grammarSource, e.grammarText?.substr(e.location.start.offset, e.location.end.offset - e.location.start.offset));
  process.exit(2);
}
await postParserDependencies(topRfcNum, topRules, topProfile);

await preConsolidationDependencies();

const consolidatedAbnfPreamble = `; Extracted from IETF ${Object.keys(importedAbnf).map(rfc => `RFC ${rfc}`).join(", ")}
; Copyright (c) IETF Trust and the persons identified as authors of the code. All rights reserved.
; Redistribution and use in source and binary forms, with or without modification, is permitted pursuant to, and subject to the license terms contained in, the Revised BSD License set forth in Section 4.c of the IETF Trust's Legal Provisions Relating to IETF Documents (https://trustee.ietf.org/license-info).
`;

const consolidatedAbnf = consolidatedAbnfPreamble + Object.entries(importedAbnf).map(([rfc, { content }]) => `;;;; from RFC ${rfc}\n${content}`).join("\n");

await writeFile(`../consolidated/rfc${topRfcNum}${topProfile ? `-${topProfile}` : ''}.abnf`, consolidatedAbnf);


try {
  const consolidatedRules = parseString(consolidatedAbnf);
check_refs(consolidatedRules);
} catch(e) {
  console.error(e.message);
}
  // TODO: remove unused rules?




