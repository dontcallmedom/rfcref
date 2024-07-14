import test from "node:test";
import assert from "assert";

import { parseString } from "abnf";

import serialize from "../lib/serialize.mjs";

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
  }
];

test("the ABNF rules serializer", async (t) => {
  for (const a of abnfSerializationTests) {
    await t.test(a.desc, () => {
      const parsedRules = parseString(a.abnf);
      const [ , rule ] = Object.entries(parsedRules.defs)[0];
      assert.equal(serialize(rule), a.reserializedAbnf ?? a.abnf.split("\n")[0]);
    });
  }
});
