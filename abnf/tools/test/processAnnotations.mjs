import test from "node:test";
import assert from "assert";

import { processAnnotations } from "../lib/processAnnotations.mjs";

const testSources = {
  "basic": 'TEST = KNOWN',
  "basicAndVal": 'TEST = KNOWN\nVAL = "value"',
  "extends" : 'KNOWN =/ "another"',
  "conflicting": 'TEST = KNOWN\nANOTHER = "conflict"',
  "deeperConflicting": 'TEST = KNOWN\nANOTHER = "conflict"\nTEST2 = KNOWN2',
  "singleRule": 'KNOWN = "known"',
  "singleRuleWithCruft": 'KNOWN = "known"\nUNNEEDED = "unneeded"',
  "codependentRules": 'KNOWN = *ANOTHER\nANOTHER = "known"',
  "deepConflict": 'KNOWN = DEEPER\nKNOWN2 = ANOTHER',
  "deeper": 'DEEPER = ANOTHER\nANOTHER = "known"',
  "basicWithProseImport": "TEST = KNOWN\nKNOWN = <imported>",
};

function annotationMapper(a) {
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

const annotationTests = [
  {
    desc: "imports a single name",
    abnf: "basic",
    annotations: {
      imports: {
	"known": "singleRule"
      }
    },
    out: testSources.singleRule
  },
  {
    desc: "imports a single name but ignore unneeded one",
    abnf: "basic",
    annotations: {
      imports: {
	"known": "singleRuleWithCruft"
      }
    },
    out: testSources.singleRule
  },
  {
    desc: "imports a single name and its dependent",
    abnf: "basic",
    annotations: {
      imports: {
	"known": "codependentRules"
      }
    },
    out: testSources.codependentRules
  },
  {
    desc: "imports a name for an extension",
    abnf: "extends",
    annotations: {
      extends: {
	"known": "singleRule"
      }
    },
    out: testSources.singleRule
  },
  {
    desc: "throws when hitting an unlisted extension",
    abnf: "extends",
    annotations: {},
    error: /not listed in its annotations/
  },
  {
    desc: "Does not cycle indefinitely in dependency resolution",
    abnf: "basicAndVal",
    annotations: {
      multiple: {
	"basicAndVal": {
	  extends: { known: "singleRule" }
	},
	"singleRule": {
	  imports: { val: "basicAndVal" }
	}
      }
    },
    error: /Loop detected/
  },
  {
    desc: "resolves conflicting name",
    abnf: "conflicting",
    annotations: {
      imports: {
	"known": "codependentRules"
      }
    },
    out: testSources.codependentRules.replaceAll("ANOTHER", "codependentRules-ANOTHER")
  },
  {
    desc: "resolves conflicting name two levels down",
    abnf: "deeperConflicting",
    annotations: {
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
    out: 'KNOWN = DEEPER\nKNOWN2 = deepConflict-ANOTHER\nDEEPER = deepConflict-ANOTHER\ndeepConflict-ANOTHER = "known"'
  },
  {
    desc: "imports a single name and removes it from the original",
    abnf: "basicWithProseImport",
    annotations: {
      imports: {
	"known": "singleRule"
      }
    },
    fullOut: testSources.singleRule + "\n" + testSources.basic
  },

];

test("the ABNF annotation processor", async (t) => {
  for (const a of annotationTests) {
    await t.test(a.desc, async () => {
      let out;
      try {
	out = await processAnnotations(a.abnf, abnfLoader, annotationMapper(a.annotations) );
      } catch (e) {
	assert(!!a.error && e.message.match(a.error), `Unexpected error: ${e.message} ${e.stack}`);
	return;
      }
      assert(!a.error, "Expected test to throw");
      assert.equal(out, a.fullOut ?? a.out + "\n" + abnfLoader(a.abnf));
    });
  }
});
