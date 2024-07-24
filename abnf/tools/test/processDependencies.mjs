import test from "node:test";
import assert from "assert";

import { processDependencies, buildImportMap } from "../lib/processDependencies.mjs";

const testSources = {
  "basic": 'TEST = KNOWN',
  "basicAndVal": 'TEST = KNOWN\nVAL = "value"',
  "cycle": 'VAL =/ TEST\nKNOWN = "known"',
  "extends" : 'KNOWN =/ "another"',
  "conflicting": 'ANOTHER = "conflict"\nTEST = KNOWN',
  "multiimport": 'ANOTHER = KNOWN3\nKNOWN = KNOWN2',
  "multiimport2": 'KNOWN2 = KNOWN3',
  "multiimport3": 'KNOWN3 = "known"',
  "deeperConflicting": 'TEST = KNOWN\nANOTHER = "conflict"\nTEST2 = KNOWN2',
  "deeperConflicting2": 'TEST = KNOWN',
  "singleRule": 'KNOWN = "known"',
  "singleRuleWithCruft": 'KNOWN = "known"\nUNNEEDED = "unneeded"',
  "codependentRules": 'KNOWN = *ANOTHER\nANOTHER = "known"',
  "deepConflict": 'KNOWN = DEEPER\nKNOWN2 = ANOTHER',
  "deepConflict2": 'KNOWN = URI\nURI = URI-REFERENCE',
  "deeper": 'DEEPER = ANOTHER\nANOTHER = "known"',
  "deeper2": 'URI-REFERENCE = URI\nURI = "uri"',
  "basicWithProseImport": "TEST = KNOWN\nKNOWN = <imported>",
};

function dependencyMapper(a) {
  let counter = 0;
  return name => {
    counter++;
    if (a.multiple) {
      return a.multiple[name];
    } else {
      if (counter === 1) {
	return a;
      } else {
	return {};
      }
    }
  };
}


function abnfLoader(name) {
  assert(!!testSources[name], `${name} is a not an ABNF test source`);
  return testSources[name];
}

const dependencyTests = [
  {
    desc: "imports a single name",
    abnf: "basic",
    dependencies: {
      imports: {
	"known": "singleRule"
      }
    },
    out: testSources.singleRule,
    importMap: { basic: {names: ['TEST'], ignore: ['KNOWN']}, singleRule: {names: ['KNOWN'], ignore: []}, __order: ["singleRule", "basic"] }
  },
  {
    desc: "imports a single name but ignore unneeded one",
    abnf: "basic",
    dependencies: {
      imports: {
	"known": "singleRuleWithCruft"
      }
    },
    out: testSources.singleRule,
    importMap: { basic: {names: ['TEST'], ignore: ['KNOWN']}, singleRuleWithCruft: {names: ['KNOWN'], ignore: []}, __order: ["singleRuleWithCruft", "basic"] }
  },
  {
    desc: "imports a single name and its dependent",
    abnf: "basic",
    dependencies: {
      imports: {
	"known": "codependentRules"
      }
    },
    fullOut: 'ANOTHER = "known"\nKNOWN = *ANOTHER\nTEST = KNOWN',
    importMap: { basic: {names: ['TEST'], ignore: ['KNOWN']}, codependentRules: {names: ['ANOTHER', 'KNOWN'], ignore: []}, __order: ["codependentRules", "basic"] }
  },
  {
    desc: "imports names several times in a dependency tree",
    abnf: "multiimport",
    dependencies: {
      multiple: {
	"multiimport": {
	  imports: {
	    "known2": "multiimport2",
	    "known3": "multiimport3"
	  }
	},
	"multiimport2": {
	  imports: {
	    "known3": "multiimport3"
	  }
	}
      }
    },
    out: 'KNOWN3 = "known"\nKNOWN2 = KNOWN3',
    importMap: { multiimport: {names: ['ANOTHER', 'KNOWN'], ignore: ['KNOWN2', 'KNOWN3']}, multiimport2: {names: ['KNOWN2'], ignore:[]}, multiimport3: {names: ['KNOWN3'], ignore: []}, __order: ["multiimport3", "multiimport2", "multiimport"] }
  },
  {
    desc: "imports a name for an extension",
    abnf: "extends",
    only: true,
    dependencies: {
      extends: {
	"known": "singleRule"
      }
    },
    fullOut: 'KNOWN = "known" / "another"',
    importMap: { extends: {names: [], ignore: []}, singleRule: {names: [ "KNOWN"], ignore: []}, __order: ["singleRule", "extends"] }
  },
  {
    desc: "throws when hitting an unlisted extension",
    abnf: "extends",
    dependencies: {},
    error: /not listed in its dependencies/
  },
  {
    desc: "Does not cycle indefinitely in dependency resolution",
    abnf: "basicAndVal",
    dependencies: {
      multiple: {
       "basicAndVal": {
         imports: { known: "cycle" },
       },
       "cycle": {
         extends: { val: "basicAndVal" },
         imports: { test: "basicAndVal" }
       }
      }
    },
    error: /Loop detected/
  },
  {
    desc: "resolves conflicting name",
    abnf: "conflicting",
    dependencies: {
      imports: {
	"known": "codependentRules"
      }
    },
    out: testSources.codependentRules.replaceAll("ANOTHER", "codependentRules-ANOTHER"),
    importMap: { conflicting: {names: ['ANOTHER', 'TEST'], ignore: ['KNOWN']}, codependentRules: {names: ['ANOTHER', 'KNOWN'], ignore: []}, __order: ["codependentRules", "conflicting"] }
  },
  {
    desc: "resolves conflicting name two levels down",
    abnf: "deeperConflicting",
    dependencies: {
      multiple: {
	"deeperConflicting": {
	  imports: {
	    "known": "deepConflict",
	    "known2": "deepConflict"
	  },
	},
	"deepConflict": {
	  imports: {
	    "deeper": "deeper",
	    "another": "deeper"
	  }
	}
      }
    },
    fullOut: 'DEEPER = deeper-ANOTHER\nKNOWN = DEEPER\nKNOWN2 = deeper-ANOTHER\ndeeper-ANOTHER = "known"\nANOTHER = "conflict"\nTEST = KNOWN\nTEST2 = KNOWN2',
    importMap: {deeperConflicting: {names: [ 'ANOTHER', 'TEST', 'TEST2' ], ignore: ['KNOWN', 'KNOWN2']}, deepConflict: {names: [ 'KNOWN', 'KNOWN2' ], ignore: []}, deeper: {names: [ 'DEEPER', 'ANOTHER'], ignore: []}, __order: ["deeper", "deepConflict", "deeperConflicting"]}
  },
  {
    desc: "resolves another conflicting name two levels down",
    abnf: "deeperConflicting2",
    dependencies: {
      multiple: {
	"deeperConflicting2": {
	  imports: {
	    "known": "deepConflict2"
	  },
	},
	"deepConflict2": {
	  imports: {
	    "uri-reference": "deeper2"
	  }
	}
      }
    },
    fullOut: 'URI-REFERENCE = deeper2-URI\ndeeper2-URI = "uri"\nKNOWN = URI\nURI = URI-REFERENCE\nTEST = KNOWN',
    importMap: {deeperConflicting2: {names: [ 'TEST' ], ignore: ['KNOWN']}, deepConflict2: {names: [ 'KNOWN', 'URI' ], ignore: []}, deeper2: {names: [ 'URI', 'URI-REFERENCE'], ignore: []}, __order: ["deeper2", "deepConflict2", "deeperConflicting2"]}
  },
  {
    desc: "imports a single name and removes it from the original",
    abnf: "basicWithProseImport",
    dependencies: {
      imports: {
	"known": "singleRule"
      }
    },
    fullOut: testSources.singleRule + "\n" + testSources.basic,
    importMap: {basicWithProseImport: {names: [ 'TEST' ], ignore: ["KNOWN"]}, singleRule: {names: [ 'KNOWN' ], ignore: []}, __order: ["singleRule", "basicWithProseImport"]}
  },

];

test("the ABNF dependency processor", async (t) => {
  for (const a of dependencyTests) {
    await t.test(a.desc, async () => {
      let out;
      try {
	out = await processDependencies({abnfName: a.abnf}, abnfLoader, dependencyMapper(a.dependencies) );
      } catch (e) {
	assert(!!a.error && e.message.match(a.error), `Unexpected error: ${e.message} ${e.stack}`);
	return;
      }
      assert(!a.error, "Expected test to throw");
      assert.equal(out, a.fullOut ?? a.out + "\n" + abnfLoader(a.abnf));
    });
  }
});

test("the ABNF import map builder", async(t) => {
  for (const a of dependencyTests) {
    await t.test(a.desc, async () => {
      let map;
      try {
	map = await buildImportMap({abnfName: a.abnf}, abnfLoader, dependencyMapper(a.dependencies));
      } catch (e) {
	assert(!!a.error && e.message.match(a.error), `Unexpected error: ${e.message} ${e.stack}`);
	return;
      }
      if (a.importMap) {
	Object.keys(map).forEach(k => { if (map[k].dependsOn) { delete map[k].dependsOn; } if (map[k].rename) { delete map[k].rename; } });
	assert.deepEqual(map, a.importMap);
      }
    });
  }
});
