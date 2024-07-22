import assert from "node:assert";
import { readFile } from "fs/promises";

// TODO: add memoized version of parseString on a hash of ABNF to avoid reparsing
import { parseString } from "abnf";

import serialize from "./serialize.mjs";

export function hideMissingExtendedDefs(names) {
  return names.map(n => `${n} = <missing>`).join("\n");
}

export function listNames(abnf, sourceName) {
  const rules = parseString(makeParsable(abnf), sourceName);
  return new Set(Object.keys(rules.defs).map(n => n.toUpperCase()));
}

// FIXME: make a copy of that file in code space?
export const rfc5234Abnf = await readFile(new URL('../../source/rfc5234.abnf', import.meta.url), 'utf-8');
export const coreNames = listNames(rfc5234Abnf);

export function listMissingExtendedDefs(abnf, sourceName) {
  const missingDefs = [];
  const origAbnf = abnf;
  while(true) {
    try {
      parseString(abnf, sourceName + ` with pseudo defs for ${missingDefs.join(', ')}`);
      return missingDefs;
    } catch (e) {
      // Dedicated error types in node-abnf would be more robust
      if (e.message.match(/non-existant/)) {
	const m = e.message.match(/: ([A-Za-z0-9-]+)$/);
	assert(m, `Could not parse error from node-abnf to find non-existant definition in ${sourceName}: ${e.message}`);
	assert(!missingDefs.includes(m[1]), `hideMissingDefs failed to hide ${m[1]}`);
	missingDefs.push(m[1].toUpperCase());
      } else {
	throw e;
      }
    }
    abnf = hideMissingExtendedDefs(missingDefs) + "\n" + origAbnf;
  }
}

export function listMissingReferencedDefs(abnf, sourceName) {
  const referencedDefs = [];
  const rules = parseString(abnf, sourceName);
  rules.refs.forEach(ref => {
    if (!rules.defs[ref.name.toUpperCase()]) {
      referencedDefs.push(ref.name.toUpperCase());
    }
  });
  return referencedDefs;
}


export function listUnreferencedDefs(abnf, sourceName) {
  const unreferencedDefs = [];
  const rules = parseString(abnf, sourceName);

  for (const name in rules.defs) {
    if ((rules.findRefs(name).length === 0)) {
      unreferencedDefs.push(name);
    }
  }
  return unreferencedDefs;

}


export function makeParsable(abnf, sourceName) {
  const missingDefs = listMissingExtendedDefs(abnf, sourceName);
  return hideMissingExtendedDefs(missingDefs) + "\n" + abnf;
}

function extractLoc(abnf, loc) {
  return abnf.substr(loc.start.offset, loc.end.offset - loc.start.offset - 1);
}

export function extractSegment(abnf, name, sourceName) {
  const parsedRules = parseString(abnf, sourceName);
  const def = parsedRules.defs[name.toUpperCase()];
  if (!def) {
    throw new Error(`Cannot extract rule named ${name} from parsed rules for ${sourceName}`);
  }
  return serialize(def);
}

export function listNamesNeededForExtractingRules(names, abnf, abnfName) {
  const extendedDefs = listMissingExtendedDefs(abnf, abnfName);
  const parsableAbnf = hideMissingExtendedDefs(extendedDefs) + "\n" + abnf;

  let extractedAbnfSegments = [];
  names = names.map(n => n.toUpperCase());
  const ret = { local: [], remote: [...extendedDefs]};
  for (const name of names) {
    try {
      extractedAbnfSegments.push(extractSegment(parsableAbnf, name, abnfName));
      ret.local.push(name);
    } catch(e) {
      if (e.message.match(/Cannot extract/)) {
	ret.remote.push(name);
      } else {
	throw e;
      }
    }
  }
  const extractedAbnf = extractedAbnfSegments.join("\n");
  if (!extractedAbnf) return ret;
  const missingDefs = new Set(
    listMissingExtendedDefs(extractedAbnf)
      .concat(listMissingReferencedDefs(extractedAbnf))
  ).difference(new Set(ret.remote));
  if (missingDefs.size) {
    const { local, remote } = listNamesNeededForExtractingRules([...missingDefs.union(new Set(names))], abnf, abnfName);
    return { local: [...new Set(ret.local.concat(local))].sort(), remote: [...new Set(ret.remote.concat(remote))].sort()};

  } else {
    return ret;
  }
}

/* Given the name of a rule defined in a given ANBF
  returns that rule and all other rules it depends on in that ABNF
  throws if that ABNF doesn't have all the rules needed for that
*/
export function extractRulesFromDependency(names, dependencyAbnf, dependencyName, skip = new Set()) {
  if (!names.length || !dependencyAbnf) return "";
  let extractedAbnfSegments = [];
  for (const name of names) {
    extractedAbnfSegments.push(extractSegment(dependencyAbnf, name, dependencyName));
  }
  skip = skip.union(new Set(names.map(n => n.toUpperCase())));
  let missingDefs;
  do {
    missingDefs = new Set(listMissingExtendedDefs(extractedAbnfSegments.join("\n")).concat(listMissingReferencedDefs(extractedAbnfSegments.join("\n"))));
    // check if any of the missing defs is CORE ABNF
    missingDefs = missingDefs.difference(coreNames);
    missingDefs = missingDefs.difference(skip);
    if (missingDefs.size) {
      extractedAbnfSegments.push(extractRulesFromDependency([...missingDefs], dependencyAbnf, dependencyName, skip));
    } else {
      break;
    }
  } while(true);
  return extractedAbnfSegments.join("\n") + "\n";
}


export function removeRule(name, abnf, sourceName) {
  const rules = parseString(abnf, sourceName);
  const def = rules.defs[name.toUpperCase()];
  const rangesToDelete = [];
  if (def) {
    const {name,loc} = def;
    const {offset: start} = loc.start;
    const {offset: end} = loc.end;

    // are there any non local rule (typically =/ extensions)?
    if (def.def.type === "alternation") {
      for (const alt of  def.def.alts) {
	if (alt.loc.start.offset> end || alt.loc.end.offset < start) {
	  // the parser only gives us the location of the RHS definition
	  // we assume the left-hand side starts at the start of the given line
	  rangesToDelete.push({start: alt.loc.start.offset + 1 - alt.loc.start.column, end: alt.loc.end.offset});
	}
      }
    }
    rangesToDelete.push({start, end});
  }
  for (const {start, end} of rangesToDelete.sort((a, b) => b.end - a.end)) {
    const len = abnf.length;
    abnf = abnf.substr(0, start) + abnf.substr(end);
  }
  return abnf;
}

export function renameRule(name, newname, abnf, sourceName) {
  const orig = abnf;
  const rules = parseString(abnf, sourceName);
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

