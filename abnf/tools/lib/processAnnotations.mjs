import promises from "node:fs";
import assert from "node:assert";
import { parseString } from "abnf";

import { listMissingExtendedDefs, extractRulesFromDependency, renameRule, makeParsable, listNames, removeRule, rfc5234Abnf, coreNames } from "./processAbnf.mjs";

const readFile = { promises };


function UC(obj) {
  if (Array.isArray(obj)) {
    return obj.map(s => s.toUpperCase());
  } else {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => { return [k.toUpperCase(), v];}));
  }
}



export async function processAnnotations(sourceName, abnfLoader, annotationLoader, stack = { sources: {}, names: []}, callers = []) {
  const top = Object.keys(stack.sources).length === 0;

  if (!stack.sources[sourceName]) {
    stack.sources[sourceName] = [];
  }
  if (callers.includes(sourceName)) {
    throw new Error(`Loop detected in annotations: ${callers.join(" → ")} → ${sourceName}`);
  }
  callers.push(sourceName);
  const sourceAbnf = await abnfLoader(sourceName);

  const annotations = await annotationLoader(sourceName) || {};
  annotations.extends = UC(annotations.extends ?? {});
  annotations.imports = UC(annotations.imports ?? {});

  const extendedDefs = new Set(listMissingExtendedDefs(sourceAbnf));

  // Initialize list of names for conflict detection
  const names = listNames(sourceAbnf);
  // Don't add extended and imported names in the pool of conflicts
  // TODO: deal with importing alias (e.g. host aliased as uri-host)
  const filteredNames = (names.difference(extendedDefs)).difference(new Set(Object.keys(annotations.imports)));
  stack.names.push(filteredNames);

  const diff = extendedDefs.difference(new Set(Object.keys(annotations.extends)));
  if (diff.size > 0) {
    throw new Error(`${sourceName} extends definitions that are not listed in its annotations: ${[...diff].join(", ")}`);
  }

  let base = "";

  // TODO: this probably ought to be done once for the full stack rather than
  // per level of recursion
  const sources = [...new Set(Object.values(annotations.imports).concat(Object.values(annotations.extends)))];
  for (const source of sources) {
    // TODO: add comment on source
    const importedAbnf = await abnfLoader(source);
    const sourceImported =
      Object.keys(annotations.imports).concat(Object.keys(annotations.extends))
	  .filter(n => annotations.imports[n] === source || annotations.extends[n] === source)
	  .filter(n => !stack.sources[sourceName].includes(n) && !stack.sources[source]?.includes(n));

    if (!sourceImported.length) {
      continue;
    }

    const sourceBase = await processAnnotations(source, abnfLoader, annotationLoader, stack, callers.slice());
    const processedSourceAbnf = sourceBase + "\n" + importedAbnf;

    const filteredSourceAbnf = extractRulesFromDependency(sourceImported, processedSourceAbnf, new Set(stack.sources[sourceName]));

    let unconflictedAbnf = filteredSourceAbnf;

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
  // remove rules marked as imported from original ABNF
  let filteredAbnf = sourceAbnf;

  // FIXME: breaks if filteredAbnf is not parsable due to missing extension base
  for (const imported of Object.keys(annotations.imports).concat([...coreNames.intersection(names)])) {
    filteredAbnf = removeRule(imported, filteredAbnf).trim();
  }

  // only import what's actually needed (if anything) from core ABNF
  if (top) {
    const consolidated = base + "\n" + filteredAbnf;
    const fromCore = listNames(consolidated).intersection(coreNames);
    if (fromCore.size > 0) {
      const filteredCoreAbnf = extractRulesFromDependency([...fromCore], rfc5234Abnf);
      return filteredCoreAbnf + "\n" + consolidated;
    }
    return consolidated;
  } else {
    return base;
  }

}
