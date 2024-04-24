import test from "node:test";
import { parseString } from "abnf";
import assert from "assert";

test("the ABNF parser", async (t) => {
  await t.test("accepts valid ABNF", () => {
    const rules = parseString('valid-abnf = ""');
    assert.equal(Object.keys(rules.defs).length, 1, `Accept ABNF with valid syntax and finds ${Object.keys(rules.defs).length} definition`);
  });

  await t.test("rejects ABNF extending an undefined rule", () => {
    try {
      parseString('undefined-extension =/ "foo"');
      assert(false, "Did not reject ABNF with undefined rule");
    } catch (e) {
      assert(true, "Did reject ABNF with undefined rule");
    }
  });

  await t.test("rejects invalid ABNF", () => {
    try {
      parseString('undefined-extension ;=/ "foo"');
      assert(false, "Did not reject ABNF with invalid syntax");
    } catch (e) {
      assert(true, "Did reject ABNF with invalid syntax");
    }

  });
});
