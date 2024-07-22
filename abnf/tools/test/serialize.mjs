import test from "node:test";
import assert from "assert";

import { parseString } from "abnf";

import serialize from "../lib/serialize.mjs";
import { wrapper } from "../lib/serialize.mjs";

const classSpanWrap = new Proxy(wrapper(), {
  get(target, name) {
    return i => `<span class='${name}'>${target[name](i)}</span>`;
  }
});

const abnfSerializationTests = [
  {
    desc: "serializes a string value",
    abnf: 'known = "value"'
  },
  {
    desc: "serializes a concatenation",
    abnf: 'known = another value\nvalue = "value"\nanother = "another"'
  },
  {
    desc: "serializes alternatives",
    abnf: 'known = "known" / "value"'
  },
  {
    desc: "serializes incremental alternatives",
    abnf: 'known = "known"\nknown  =/ "value"',
    reserializedAbnf : 'known = "known" / "value"'
  },
  {
    desc: "serializes alternatives",
    abnf: 'known = "known" / "value"'
  },
  {
    desc: "serializes character ref",
    abnf: 'known = %x30',
    reserializedAbnf : 'known = %d48'
  },
  {
    desc: "serializes ranges",
    abnf: 'known = %x30-31'
  },

  {
    desc: "serializes prose",
    abnf: 'known = <prose>'
  },
  {
    desc: "serializes sequence",
    abnf: 'known = (another / value) end\nanother ="another"\nvalue = "value"\nend = "end"'
  },
  {
    desc: "serializes generic variable repetition",
    abnf: 'known = *"known"'
  },
  {
    desc: "serializes bounded variable repetition",
    abnf: 'known = 2*3"known"'
  },
  {
    desc: "serializes specific repetition",
    abnf: 'known = 2"known"'
  },
  {
    desc: "serializes optional sequence",
    abnf: 'known = ["known"]'
  },
  {
    desc: "serializes with a wrapper",
    abnf: 'known = ["known"] / ( 1*4<prose> %x32-33 )',
    wrapper: classSpanWrap,
    reserializedAbnf: `<span class='rule'><span class='rulename'>known</span> <span class='operator'>=</span> <span class='ruledef'><span class='operator'>[</span><span class='operator'>"</span><span class='str'>known</span><span class='operator'>"</span><span class='operator'>]</span> <span class='operator'>/</span> <span class='operator'>(</span><span class='repetitor'>1</span><span class='operator'>*</span><span class='repetitor'>4</span><span class='operator'><</span><span class='prose'>prose</span><span class='operator'>></span> <span class='codechar'><span class='operator'>%</span>x32<span class='operator'>-</span>33</span><span class='operator'>)</span></span></span>`
  }

];

test("the ABNF rules serializer", async (t) => {
  for (const a of abnfSerializationTests) {
    await t.test(a.desc, () => {
      const parsedRules = parseString(a.abnf);
      const [ , rule ] = Object.entries(parsedRules.defs)[0];
      assert.equal(serialize(rule, a.wrapper), a.reserializedAbnf ?? a.abnf.split("\n")[0]);
    });
  }
});
