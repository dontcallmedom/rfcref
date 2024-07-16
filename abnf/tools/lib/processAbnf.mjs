import assert from "node:assert";
import { readFile } from "fs/promises";

// TODO: add memoized version of parseString on a hash of ABNF to avoid reparsing
import { parseString, parseFile } from "abnf";

import serialize from "./serialize.mjs";

function hideMissingExtendedDefs(names) {
  return names.map(n => `${n} = <missing>`).join("\n");
}

export function listNames(abnf) {
  const rules = parseString(makeParsable(abnf));
  return new Set(Object.keys(rules.defs).map(n => n.toUpperCase()));
}

// FIXME: make a copy of that file in code space?
export const rfc5234Abnf = await readFile(new URL('../../source/rfc5234.abnf', import.meta.url), 'utf-8');
export const coreNames = listNames(rfc5234Abnf);

export function listMissingExtendedDefs(abnf) {
  const missingDefs = [];
  while(true) {
    try {
      parseString(abnf);
      return missingDefs;
    } catch (e) {
      // Dedicated error types in node-abnf would be more robust
      if (e.message.match(/non-existant/)) {
	const m = e.message.match(/: ([A-Za-z0-9]+)$/);
	assert(m, `Could not parse error from node-abnf to find non-existant definition: ${e.message}`);
	assert(!missingDefs.includes(m[1]), `hideMissingDefs failed to hide ${m[1]}`);
	missingDefs.push(m[1].toUpperCase());
      } else {
	throw e;
      }
    }
    abnf = hideMissingExtendedDefs(missingDefs) + "\n" + abnf;
  }
}

export function listMissingReferencedDefs(abnf) {
  const referencedDefs = [];
  const rules = parseString(abnf);
  rules.refs.forEach(ref => {
    if (!rules.defs[ref.name.toUpperCase()]) {
      referencedDefs.push(ref.name.toUpperCase());
    }
  });
  return referencedDefs;
}


export function listUnreferencedDefs(abnf) {
  const unreferencedDefs = [];
  const rules = parseString(abnf);

  for (const name in rules.defs) {
    if ((rules.findRefs(name).length === 0)) {
      unreferencedDefs.push(name);
    }
  }
  return unreferencedDefs;

}


export function makeParsable(abnf) {
  const missingDefs = listMissingExtendedDefs(abnf);
  return hideMissingExtendedDefs(missingDefs) + "\n" + abnf;
}

function extractLoc(abnf, loc) {
  return abnf.substr(loc.start.offset, loc.end.offset - loc.start.offset - 1);
}

export function extractSegment(abnf, name) {
  const parsedRules = parseString(abnf);
  const def = parsedRules.defs[name.toUpperCase()];
  if (!def) {
    throw new Error(`Cannot extract rule named ${name} from parsed rules`);
  }
  return serialize(def);
}


/* Given the name of a rule defined in a given ANBF
  returns that rule and all other rules it depends on in that ABNF
  throws if that ABNF doesn't have all the rules needed for that
*/
export function extractRulesFromDependency(names, dependencyAbnf, skip = new Set()) {
  if (!Array.isArray(names)) {
    names = [names];
  }
  let extractedAbnfSegments = [];
  for (const name of names) {
    extractedAbnfSegments.push(extractSegment(dependencyAbnf, name));
  }
  skip = skip.union(new Set(names.map(n => n.toUpperCase())));
  let missingDefs;
  do {
    missingDefs = new Set(listMissingExtendedDefs(extractedAbnfSegments.join("\n")).concat(listMissingReferencedDefs(extractedAbnfSegments.join("\n"))));
    // check if any of the missing defs is CORE ABNF
    missingDefs = missingDefs.difference(coreNames);
    missingDefs = missingDefs.difference(skip);
    if (missingDefs.size) {
      extractedAbnfSegments.push(extractRulesFromDependency([...missingDefs], dependencyAbnf, skip));
    } else {
      break;
    }
  } while(true);
  return extractedAbnfSegments.join("\n") + "\n";
}

export function removeRule(name, abnf) {
  const rules = parseString(abnf);
  const def = rules.defs[name.toUpperCase()];
  if (def) {
    const {name,loc} = def;
    const {offset: start} = loc.start;
    const {offset: end} = loc.end;
    const len = abnf.length;
    abnf = abnf.substr(0, start) + abnf.substr(end);
  }
  return abnf;
}

export function renameRule(name, newname, abnf) {
  const rules = parseString(abnf);
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
    abnf = abnf.substr(0, start) + newname + abnf.substr(end);
  }
  return abnf;
}

