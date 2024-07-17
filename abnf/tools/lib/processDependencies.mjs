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



export async function processDependencies(sourceName, abnfLoader, dependencyLoader, stack = { sources: {}, names: []}, callers = []) {
  const top = Object.keys(stack.sources).length === 0;

  if (!stack.sources[sourceName]) {
    stack.sources[sourceName] = [];
  }
  if (callers.includes(sourceName)) {
    throw new Error(`Loop detected in dependencies: ${callers.join(" → ")} → ${sourceName}`);
  }
  callers.push(sourceName);
  const sourceAbnf = await abnfLoader(sourceName);

  const dependencies = await dependencyLoader(sourceName) || {};
  dependencies.extends = UC(dependencies.extends ?? {});
  dependencies.imports = UC(dependencies.imports ?? {});

  const extendedDefs = new Set(listMissingExtendedDefs(sourceAbnf));

  // Initialize list of names for conflict detection
  const names = listNames(sourceAbnf);
  // Don't add extended and imported names in the pool of conflicts
  // TODO: deal with importing alias (e.g. host aliased as uri-host)
  const filteredNames = (names.difference(extendedDefs)).difference(new Set(Object.keys(dependencies.imports)));
  stack.names.push(filteredNames);

  const diff = extendedDefs.difference(new Set(Object.keys(dependencies.extends)));
  if (diff.size > 0) {
    throw new Error(`${sourceName} extends definitions that are not listed in its dependencies: ${[...diff].join(", ")}`);
  }

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

    const sourceBase = await processDependencies(source, abnfLoader, dependencyLoader, stack, callers.slice());
    const processedSourceAbnf = sourceBase + "\n" + importedAbnf;

    const filteredSourceAbnf = extractRulesFromDependency(sourceImported, processedSourceAbnf, new Set(stack.sources[sourceName]));

    let unconflictedAbnf = filteredSourceAbnf;
    // handle previous collected aliases
    for (const alias of Object.keys(aliases)) {
      unconflictedAbnf = renameRule(alias, aliases[alias], unconflictedAbnf);
    }

    let importedNames = listNames(unconflictedAbnf);
    do {
      // TODO: this reparse content a lot of time; a smarter renaming function would avoid it
      let parentNames = new Set();
      for (let l = 0 ; l < stack.names.length - 1; l++) {
	parentNames = parentNames.union(stack.names[l]);
      }
      // remove names in importing (they'll be dealt at a different level)
      const conflicts = parentNames.difference(new Set(sourceImported)).intersection(importedNames);
      if (conflicts.size === 0) break;
      const conflictingName = conflicts.values().next().value;
      const rename = `${source}-${conflictingName}`;
      // Rename any rule with a name already collected in stack
      unconflictedAbnf = renameRule(conflictingName, rename, unconflictedAbnf);

      importedNames = listNames(unconflictedAbnf);
    } while (true);

    let last = stack.names[stack.names.length - 1];
    last = last.union(importedNames);
    base += unconflictedAbnf;

    for (const importedName of importedNames) {
      if (stack.sources[source].includes(importedName)) {
	// already imported previously, removing it
	base = removeRule(importedName, base);
      } else {
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

  // only import what's actually needed (if anything) from core ABNF
  if (top) {
    // remove rules marked as imported from original ABNF
    let filteredAbnf = sourceAbnf;

    // remove imported declarations (they're sometimes listed as prose rules)
    // (but we need to make filteredAbnf parsable first)
    const parsableBase = hideMissingExtendedDefs(listMissingExtendedDefs(filteredAbnf));
    let parsableAbnf = parsableBase + filteredAbnf;
    for (const imported of Object.keys(dependencies.imports)) {
      parsableAbnf = removeRule(imported, parsableAbnf).trim();
    }
    filteredAbnf = parsableAbnf.slice(parsableBase.length);

    let consolidated = base + "\n" + filteredAbnf;
    const fromCore = listNames(consolidated).intersection(coreNames);
    if (fromCore.size > 0) {
      const filteredCoreAbnf = extractRulesFromDependency([...fromCore], rfc5234Abnf);
      for (const coreName of fromCore) {
	consolidated = removeRule(coreName, consolidated).trim();
      }

      return filteredCoreAbnf + "\n" + consolidated;
    }
    return consolidated;
  } else {
    return base;
  }

}
