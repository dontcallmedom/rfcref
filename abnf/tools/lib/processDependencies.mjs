import promises from "node:fs";
import assert from "node:assert";
import { parseString } from "abnf";

import { listMissingExtendedDefs, listMissingReferencedDefs, extractRulesFromDependency, makeParsable, renameRule, listNames, removeRule, rfc5234Abnf, coreNames, hideMissingExtendedDefs, listNamesNeededForExtractingRules } from "./processAbnf.mjs";

const readFile = { promises };


function UC(obj) {
  if (Array.isArray(obj)) {
    return obj.map(s => s.toUpperCase());
  } else {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => { return [k.toUpperCase(), v];}));
  }
}

function renameRules(abnf, renames, abnfName) {
  //  we need to make the abnf parsable first
  const parsableBase = hideMissingExtendedDefs(listMissingExtendedDefs(abnf, abnfName));
  const cutMarker ='; ----------------- X CUT THERE X -------\n';
  let parsableAbnf = parsableBase + '\n' + cutMarker + abnf;
  for (const [oldName, newName] of renames) {
    parsableAbnf = renameRule(oldName, newName, parsableAbnf, abnfName).trim();
  }
  return parsableAbnf.split(cutMarker)[1];
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

export async function collectNeededExtracts({abnfName, profile}, abnfLoader, dependencyLoader, names, neededExtracts, stack = []) {
  const abnf = await abnfLoader(abnfName);
  let dependencies = await dependencyLoader(abnfName) || {};
  if (profile) {
    dependencies = dependencies.find(d => d.name === profile);
  }
  dependencies.extends = UC(dependencies.extends ?? {});
  dependencies.imports = UC(dependencies.imports ?? {});
  dependencies.ignore = UC(dependencies.ignore ?? []);
  const extendedDefs = new Set(listMissingExtendedDefs(abnf, abnfName));

  if (!names) {
    names = listNames(abnf, abnfName);
  } else {
    names = new Set(names);
  }

  const diff = extendedDefs.difference(new Set(Object.keys(dependencies.extends))).difference(new Set(dependencies.ignore));
  if (diff.size > 0) {
    throw new Error(`${abnfName} extends definitions that are not listed in its dependencies: ${[...diff].join(", ")}`);
  }

  let unknownRefs = new Set(listMissingReferencedDefs(makeParsable(abnf, abnfName), abnfName))
      .difference(new Set(Object.keys(dependencies.imports)));

  // Automatically import name from RFC5234
  const fromCore = unknownRefs.intersection(coreNames);
  if (fromCore.size) {
    unknownRefs = unknownRefs.difference(coreNames);
    for (const n of fromCore) {
      dependencies.imports[n] = "rfc5234";
    }
  }
  if (unknownRefs.size) {
    throw new Error(`${abnfName} needs to import referenced definitions ${[...unknownRefs].join(', ')} `);
  }

  const filteredNames = (names.difference(extendedDefs)).difference(new Set(Object.keys(dependencies.imports))).difference(new Set(dependencies.ignore));

  const newNeededExtracts = {__order: [abnfName]};
  let {local, remote} = listNamesNeededForExtractingRules([...filteredNames], abnf, abnfName);
  // remove names that are imported or extended
  newNeededExtracts[abnfName] = { names: local.filter(n => !dependencies.imports[n] && !dependencies.extends[n]), ignore: local.filter(n => dependencies.imports[n] || dependencies.extends[n])};
  newNeededExtracts[abnfName].dependsOn = new Set(Object.values(dependencies.extends)).union(new Set(Object.values(dependencies.imports).map(s => s.source ?? s)));

  if (!neededExtracts) {
    neededExtracts = newNeededExtracts;
  } else {
    neededExtracts = mergeNeededExtract(newNeededExtracts, neededExtracts);
  }

  remote = remote.filter(n => !dependencies.ignore.includes(n));
  const unknownNames = remote.filter(n => !dependencies.imports[n] && !dependencies.extends[n]);
  if (unknownNames.length) {
    throw new Error(`Cannot locate where the followng names should be imported from: ${unknownNames.join(", ")}`);
  }

  const dependencyNames = [...new Set(Object.values(dependencies.imports).map(s => s.source ?? s).concat(Object.values(dependencies.extends)))];
  for (const dependencyName of dependencyNames) {
    if (!neededExtracts.__order.includes(dependencyName)) {
      neededExtracts.__order.push(dependencyName);
    }
    const toBeImportedNames = Object.keys(dependencies.extends).filter(n => dependencies.extends[n] === dependencyName).filter(n => !neededExtracts[dependencyName]?.names?.includes(n));
    for (const i of Object.keys(dependencies.imports)) {
      if ((dependencies.imports[i].source ?? dependencies.imports[i]) !== dependencyName) {
	continue;
      }
      const name = dependencies.imports[i].name ?? i;
      const alreadyImported = neededExtracts[dependencyName]?.names?.includes(name);
      if (alreadyImported || coreNames.has(name)) {
	continue;
      }
      if (dependencies.imports[i].source === dependencyName) {
	if (!neededExtracts[dependencyName]) {
	  neededExtracts[dependencyName] = {names: [], ignore: [], dependsOn: new Set()};
	}
	if (!neededExtracts[dependencyName].rename) {
	  neededExtracts[dependencyName].rename = [];
	}
	neededExtracts[dependencyName].rename.push([dependencies.imports[i].name.toUpperCase(), i]);
	toBeImportedNames.push(dependencies.imports[i].name);
      } else if (dependencies.imports[i] === dependencyName) {
	toBeImportedNames.push(i);
      }
    }
    const reimported = stack.find(([aName, depNames], i) => aName === dependencyName && (new Set(depNames).intersection(new Set(toBeImportedNames)).size > 0));
    if (reimported) {
      throw new Error(`Loop detected in importing ${toBeImportedNames} already imported in ${reimported[0]} dependency ${reimported[1]}: ${stack.map(([s, n]) => `${s} (${n})`).join(" → ")} → ${abnfName}`);
    }
    stack.push([dependencyName, toBeImportedNames]);
    neededExtracts = mergeNeededExtract(neededExtracts, await collectNeededExtracts({abnfName: dependencyName}, abnfLoader, dependencyLoader, toBeImportedNames, neededExtracts, stack));
  }

  neededExtracts.__order.sort(sortExtractList(neededExtracts));

  return neededExtracts;
}

function sortExtractList(neededExtracts) {
  return function (a,b) {
    if (neededExtracts[a]?.dependsOn.has(b) && neededExtracts[b]?.dependsOn.has(a)) {
      throw new Error(`Loop detected: ${a} and ${b} depends on each other`);
    }
    if (dependsOn(neededExtracts, a, b)) {
      return 1;
    } else if (dependsOn(neededExtracts, b, a)) {
      return -1;
    }
    return 0;
  };
}

function dependsOn(neededExtracts, a, b) {
  if (neededExtracts[a]?.dependsOn.has(b)) {
    return true;
  }
  return [...neededExtracts[a]?.dependsOn ?? []].some(subdep => dependsOn(neededExtracts, subdep, b));
}

function mergeNeededExtract(ne1, ne2) {
  const ne = {};
  for (const abnfName of new Set(Object.keys(ne1).concat(Object.keys(ne2)).filter(n => n !== "__order"))) {
    if (!ne[abnfName]) {
      ne[abnfName] = {names: [], ignore: [], dependsOn: new Set()};
    }
    if (ne1[abnfName] && ne2[abnfName]) {
      ne[abnfName].names = [...new Set(ne1[abnfName].names).union(new Set(ne2[abnfName].names))];
      ne[abnfName].ignore = [...new Set(ne1[abnfName].ignore).union(new Set(ne2[abnfName].ignore))];
      ne[abnfName].dependsOn = (ne1[abnfName]?.dependsOn ?? new Set()).union(ne2[abnfName].dependsOn);
      ne[abnfName].rename = (ne1[abnfName].rename ?? []).concat(ne2[abnfName].rename ?? []).filter(([n], i, arr) => arr.findIndex(([nn]) => nn === n) === i);
    } else if (ne1[abnfName]) {
      ne[abnfName].names = ne1[abnfName].names.slice();
      ne[abnfName].ignore = ne1[abnfName].ignore.slice();
      ne[abnfName].dependsOn = new Set(ne1[abnfName].dependsOn);
      ne[abnfName].rename = ne1[abnfName].rename?.slice() ?? [];
    } else if (ne2[abnfName]) {
      ne[abnfName].names = ne2[abnfName].names?.slice() ?? [];
      ne[abnfName].ignore = ne2[abnfName].ignore?.slice() ?? [];
      ne[abnfName].dependsOn = new Set(ne2[abnfName].dependsOn);
      ne[abnfName].rename = ne2[abnfName].rename?.slice() ?? [];
    }
  }

  ne.__order = [...new Set(ne1.__order.concat(ne2.__order))].sort(sortExtractList(ne));

  return ne;
}

function annotateWithRenames(importMap) {
  const dependencyOrder = importMap.__order;
  for (let i = 0; i < dependencyOrder.length; i++) {
    const dependencyName = dependencyOrder[i];
    for (const name of importMap[dependencyName].names) {
      for (let j = 0; j < dependencyOrder.slice(i + 1).length; j++) {
	const furtherDepName = dependencyOrder[j + i + 1];

	if (importMap[furtherDepName]?.names?.includes(name)) {
	  const rename = `${dependencyName}-${name}`;
	  const depName = dependencyOrder[j + i];
	  if (!importMap[depName].rename) {
	    importMap[depName].rename = [];
	  }
	  // there is already an alias, move on
	  if (importMap[depName].rename.find(([n]) => n === name )) {
	    break;
	  }
	  importMap[depName].rename.push([name, rename]);
	  break;
	}
      }
    }
  }
}

export async function processDependencies({abnfName, profile}, abnfLoader, dependencyLoader, stack = { names: {}}, callers = []) {
  const importMap = await collectNeededExtracts({abnfName, profile}, abnfLoader, dependencyLoader);
  annotateWithRenames(importMap);
  let extractedRules = "";
  let importedNames = [];
  const dependencyOrder = importMap.__order;

  for (const i in dependencyOrder) {
    const dependencyName = dependencyOrder[i];
    const dependencyAbnf = await abnfLoader(dependencyName);
    // remove imported/extended names
    let filteredAbnf = removeRules(dependencyAbnf, importMap[dependencyName].ignore, dependencyName);
    const localNames = listNames(filteredAbnf);

    // conflict resolution
    // Conversely, if there are conflicts emerging from merging in
    // the gist of dependencyAbnf, at this point, these are names
    // we don't expect to extract, so renaming them locally
    const localConflicts = [...localNames.intersection(new Set(importedNames))].map(conflictingName => [conflictingName, `${dependencyName}-${conflictingName}`]);
    filteredAbnf = renameRules(filteredAbnf, localConflicts, dependencyName);

    importedNames = importedNames.concat(importMap[dependencyName].names);

    filteredAbnf = extractedRules + "\n" + filteredAbnf;
    // renames identified earlier
    for (const [oldName, newName] of importMap[dependencyName].rename || []) {
      filteredAbnf = renameRule(oldName, newName, filteredAbnf, dependencyName);
      const updatedNames = new Set(importedNames);
      if (updatedNames.has(oldName)) {
	updatedNames.delete(oldName);
	updatedNames.add(newName);
      }
      importedNames = [...updatedNames];
    }

    extractedRules = extractRulesFromDependency(importedNames, filteredAbnf , dependencyName);
  }
  return extractedRules.trim();
}
