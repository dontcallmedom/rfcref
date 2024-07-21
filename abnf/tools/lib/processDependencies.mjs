import promises from "node:fs";
import assert from "node:assert";
import { parseString } from "abnf";

import { listMissingExtendedDefs, listMissingReferencedDefs, extractRulesFromDependency, makeParsable, renameRule, listNames, removeRule, rfc5234Abnf, coreNames, hideMissingExtendedDefs } from "./processAbnf.mjs";

const readFile = { promises };


function UC(obj) {
  if (Array.isArray(obj)) {
    return obj.map(s => s.toUpperCase());
  } else {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => { return [k.toUpperCase(), v];}));
  }
}

function removeRules(abnf, names, abnfName) {
  //  we need to make the abnf parsable first
  const parsableBase = hideMissingExtendedDefs(listMissingExtendedDefs(abnf, abnfName));
  const cutMarker ='; ----------------- X CUT THERE X -------\n';
  let parsableAbnf = parsableBase + '\n' + cutMarker + abnf;
  for (const name of names) {
    parsableAbnf = removeRule(name, parsableAbnf, abnfName).trim();
  }
  return parsableAbnf.split(cutMarker)[1];
}

export async function processDependencies({abnfName, profile}, abnfLoader, dependencyLoader, stack = { names: {}}, callers = []) {
  const top = callers.length === 0;

  if (callers.includes(abnfName)) {
    throw new Error(`Loop detected in dependencies: ${callers.join(" → ")} → ${abnfName}`);
  }
  callers.push(abnfName);
  let abnf = await abnfLoader(abnfName);

  let dependencies = await dependencyLoader(abnfName) || {};
  if (profile) {
    dependencies = dependencies.find(d => d.name === profile);
  }
  dependencies.extends = UC(dependencies.extends ?? {});
  dependencies.imports = UC(dependencies.imports ?? {});
  dependencies.ignore = UC(dependencies.ignore ?? []);
  const extendedDefs = new Set(listMissingExtendedDefs(abnf, abnfName));

  // Initialize list of names for conflict detection
  const names = listNames(abnf, abnfName);

  // Don't add extended, imported and ignored names in the pool of conflicts
  const filteredNames = (names.difference(extendedDefs)).difference(new Set(Object.keys(dependencies.imports))).difference(new Set(dependencies.ignore));
  stack.names[abnfName] = [...filteredNames].reduce((acc, n) => {acc[n] = abnfName; return acc;}, {});
  const diff = extendedDefs.difference(new Set(Object.keys(dependencies.extends))).difference(new Set(dependencies.ignore));
  if (diff.size > 0) {
    throw new Error(`${abnfName} extends definitions that are not listed in its dependencies: ${[...diff].join(", ")}`);
  }

  const unknownRefs = new Set(listMissingReferencedDefs(makeParsable(abnf, abnfName), abnfName))
	.difference(new Set(Object.keys(dependencies.imports)))
	.difference(coreNames);
  if (unknownRefs.size) {
    throw new Error(`${abnfName} needs to import referenced definitions ${[...unknownRefs].join(', ')} `);
  }


  // Remove ignored rules
  abnf = removeRules(abnf, dependencies.ignore, abnfName);
  let base = "";

  // TODO: this probably ought to be done once for the full stack rather than
  // per level of recursion
  const dependencyNames = [...new Set(Object.values(dependencies.imports).map(s => s.source ?? s).concat(Object.values(dependencies.extends)))];
  for (const dependencyName of dependencyNames) {

    const toBeImportedNames = Object.keys(dependencies.extends).filter(n => dependencies.extends[n] === dependencyName);
    //  imports can have aliases
    let aliases = {};
    for (const i of Object.keys(dependencies.imports)) {
      const name = dependencies.imports[i].name ?? i;
      const alreadyImported = stack.names[dependencyName] && stack.names[dependencyName][name] === (dependencies.imports[i].source ?? dependencies.imports[i]);
      if (dependencies.imports[i].source === dependencyName && !alreadyImported) {
	aliases[dependencies.imports[i].name] = i;
	toBeImportedNames.push(dependencies.imports[i].name);
      } else if (dependencies.imports[i] === dependencyName && !alreadyImported) {
	toBeImportedNames.push(i);
      }
    }

    if (!toBeImportedNames.length) {
      continue;
    }

    const { base: dependencyBase, abnf: processedDependencyAbnf} = await processDependencies({abnfName: dependencyName}, abnfLoader, dependencyLoader, stack, callers.slice());

    const alreadyImportedNames =
	  new Set(Object.keys(stack.names[abnfName])
		  .filter(n => stack.names[abnfName][n] !== abnfName));
    const filteredSourceAbnf = extractRulesFromDependency(toBeImportedNames, dependencyBase + "\n" + processedDependencyAbnf, dependencyName, alreadyImportedNames);
    let unconflictedAbnf = filteredSourceAbnf;
    // handle previous collected aliases
    for (const alias of Object.keys(aliases)) {
      unconflictedAbnf = renameRule(alias, aliases[alias], unconflictedAbnf, dependencyName);
    }

    let importedNames = listNames(unconflictedAbnf, dependencyName);

    do {
      let parentNames = new Set();
      for (const s of callers) {
	if (s !== dependencyName) {
	  parentNames = parentNames.union(new Set(Object.keys(stack.names[s]).filter(n => stack.names[s][n] !== dependencyName)));
	}
      }

      // remove names in importing (they'll be dealt at a different level)
      const conflicts = parentNames.difference(new Set(toBeImportedNames)).intersection(importedNames);
      if (conflicts.size === 0) break;
      const conflictingName = conflicts.values().next().value;
      const rename = `${dependencyName}-${conflictingName}`;
      // Rename any rule with a name already collected in stack
      // TODO: this reparse content a lot of time; a smarter renaming function would avoid it
      unconflictedAbnf = renameRule(conflictingName, rename, unconflictedAbnf, dependencyName);

      importedNames = listNames(unconflictedAbnf, dependencyName);
    } while (true);

    for (const n of importedNames) {
      if (!stack.names[abnfName][n]) {
	stack.names[abnfName][n] = stack.names[dependencyName][n] ?? dependencyName;
      }
    }

    base += unconflictedAbnf;
  }
  // remove rules from core ABNF, they'll get added in the end
  if (base.trim()) {
    for (const coreName of coreNames) {
      base = removeRule(coreName, base, `imports for ${abnfName}`).trim();
    }
  }

  // remove rules marked as imported from original ABNF
  let filteredAbnf = removeRules(abnf, Object.keys(dependencies.imports), abnfName);
  if (top) {
    let consolidated = base + "\n" + filteredAbnf;
    // only import what's actually needed (if anything) from core ABNF
    const fromCore = listNames(consolidated, abnfName).intersection(coreNames);
    if (fromCore.size > 0) {
      const filteredCoreAbnf = extractRulesFromDependency([...fromCore], rfc5234Abnf, "rfc5234");
      for (const coreName of fromCore) {
	consolidated = removeRule(coreName, consolidated, abnfName).trim();
      }

    }
    return {base: "", abnf: consolidated};

  }
  return { base, abnf: filteredAbnf };
}
