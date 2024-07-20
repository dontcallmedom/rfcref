import promises from "node:fs";
import assert from "node:assert";
import { parseString } from "abnf";

import { listMissingExtendedDefs, extractRulesFromDependency, renameRule, makeParsable, listNames, removeRule, rfc5234Abnf, coreNames, hideMissingExtendedDefs } from "./processAbnf.mjs";

const readFile = { promises };


function UC(obj) {
  if (Array.isArray(obj)) {
    return obj.map(s => s.toUpperCase());
  } else {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => { return [k.toUpperCase(), v];}));
  }
}

function removeRules(abnf, names) {
  //  we need to make the abnf parsable first
  const parsableBase = hideMissingExtendedDefs(listMissingExtendedDefs(abnf));
  const cutMarker ='; ----------------- X CUT THERE X -------\n';
  let parsableAbnf = parsableBase + '\n' + cutMarker + abnf;
  for (const name of names) {
    parsableAbnf = removeRule(name, parsableAbnf).trim();
  }
  return parsableAbnf.split(cutMarker)[1];
}

export async function processDependencies({source: sourceName, profile}, abnfLoader, dependencyLoader, stack = { sources: {}, names: {}}, callers = []) {
  const top = Object.keys(stack.sources).length === 0;

  if (!stack.sources[sourceName]) {
    stack.sources[sourceName] = [];
  }
  if (callers.includes(sourceName)) {
    throw new Error(`Loop detected in dependencies: ${callers.join(" → ")} → ${sourceName}`);
  }
  callers.push(sourceName);
  let sourceAbnf = await abnfLoader(sourceName);

  let dependencies = await dependencyLoader(sourceName) || {};
  if (profile) {
    dependencies = dependencies.find(d => d.name === profile);
  }
  dependencies.extends = UC(dependencies.extends ?? {});
  dependencies.imports = UC(dependencies.imports ?? {});
  dependencies.ignore = UC(dependencies.ignore ?? []);
  const extendedDefs = new Set(listMissingExtendedDefs(sourceAbnf));

  // Initialize list of names for conflict detection
  const names = listNames(sourceAbnf);
  // Don't add extended, imported and ignored names in the pool of conflicts
  const filteredNames = (names.difference(extendedDefs)).difference(new Set(Object.keys(dependencies.imports))).difference(new Set(dependencies.ignore));
  stack.names[sourceName] = filteredNames;
  const diff = extendedDefs.difference(new Set(Object.keys(dependencies.extends))).difference(new Set(dependencies.ignore));
  if (diff.size > 0) {
    throw new Error(`${sourceName} extends definitions that are not listed in its dependencies: ${[...diff].join(", ")}`);
  }

  // Remove ignored rules
  sourceAbnf = removeRules(sourceAbnf, dependencies.ignore);
  let base = "";

  // TODO: this probably ought to be done once for the full stack rather than
  // per level of recursion
  const sources = [...new Set(Object.values(dependencies.imports).map(s => s.source ?? s).concat(Object.values(dependencies.extends)))];
  for (const source of sources) {
    // TODO: add comment on source
    const importedAbnf = await abnfLoader(source);

    const sourceImported = Object.keys(dependencies.extends).filter(n => dependencies.extends[n] === source);
    //  imports can have aliases
    let aliases = {};
    for (const i of Object.keys(dependencies.imports)) {
      if (dependencies.imports[i].source === source) {
	aliases[dependencies.imports[i].name] = i;
	sourceImported.push(dependencies.imports[i].name);
      } else if (dependencies.imports[i] === source) {
	sourceImported.push(i);
      }
    }

    if (!sourceImported.length) {
      continue;
    }

    const { base: sourceBase, abnf: processedSourceAbnf} = await processDependencies({source}, abnfLoader, dependencyLoader, stack, callers.slice());

    const filteredSourceAbnf = extractRulesFromDependency(sourceImported, sourceBase + "\n" + processedSourceAbnf, new Set(stack.sources[sourceName]));

    let unconflictedAbnf = filteredSourceAbnf;
    // handle previous collected aliases
    for (const alias of Object.keys(aliases)) {
      unconflictedAbnf = renameRule(alias, aliases[alias], unconflictedAbnf);
    }

    let importedNames = listNames(unconflictedAbnf);
    do {
      let parentNames = new Set();
      for (const s of callers) {
	if (s !== source) {
	  parentNames = parentNames.union(stack.names[s]);
	}
      }

      // remove names in importing (they'll be dealt at a different level)
      const conflicts = parentNames.difference(new Set(sourceImported)).intersection(importedNames);
      if (conflicts.size === 0) break;
      const conflictingName = conflicts.values().next().value;
      const rename = `${source}-${conflictingName}`;
      // Rename any rule with a name already collected in stack
      // TODO: this reparse content a lot of time; a smarter renaming function would avoid it
      unconflictedAbnf = renameRule(conflictingName, rename, unconflictedAbnf);

      importedNames = listNames(unconflictedAbnf);
    } while (true);

    stack.names[sourceName] = stack.names[sourceName].union(importedNames);

    base += unconflictedAbnf;

    for (const importedName of importedNames) {
      if (!stack.sources[source].includes(importedName)) {
	// marking it as imported to avoid dup
	stack.sources[source].push(importedName.toUpperCase());
      }
    }
  }
  // remove rules from core ABNF, they'll get added in the end
  if (base.trim()) {
    for (const coreName of coreNames) {
      base = removeRule(coreName, base).trim();
    }
  }

  // remove rules marked as imported from original ABNF
  let filteredAbnf = removeRules(sourceAbnf, Object.keys(dependencies.imports));
  if (top) {
    let consolidated = base + "\n" + filteredAbnf;
    // only import what's actually needed (if anything) from core ABNF
    const fromCore = listNames(consolidated).intersection(coreNames);
    if (fromCore.size > 0) {
      const filteredCoreAbnf = extractRulesFromDependency([...fromCore], rfc5234Abnf);
      for (const coreName of fromCore) {
	consolidated = removeRule(coreName, consolidated).trim();
      }

    }
    return {base: "", abnf: consolidated};

  }
  return { base, abnf: filteredAbnf };
}
