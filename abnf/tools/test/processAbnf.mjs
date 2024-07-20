import test from "node:test";
import assert from "assert";

import { parseString } from "abnf";

import { listMissingExtendedDefs, listMissingReferencedDefs, makeParsable, extractSegment, extractRulesFromDependency, renameRule, removeRule } from "../lib/processAbnf.mjs";

test("the ABNF preprocessor", async (t) => {
  await t.test("returns an emtpy list when there are no extensions of unknown definitions", () => {
    assert.deepEqual(listMissingExtendedDefs(`known = "first value"\nknown =/ "another value"`), []);
  });


  await t.test("identifies declarations extending unknown definitions", () => {
    assert.deepEqual(listMissingExtendedDefs('unknown =/ "another value"'), ['UNKNOWN']);
  });

  await t.test("identifies unknown names in declarations", () => {
    assert.deepEqual(listMissingReferencedDefs('unknown = "value" missing'), ['MISSING']);
  });

  await t.test("prepend ABNF with made-up definitions for missing ones to make it parseable", () => {
    const parsableAbnf = makeParsable('unknown =/ "another value"');
    let rules;
    try {
      rules = parseString(parsableAbnf);
    } catch (e) {
      assert(false, `makeParsable returned non-parsable ABNF: ${e}`);
    }
    assert.equal(Object.keys(rules.defs).length, 1, "makeParsable returns parsable ABNF");
  });

  await t.test("extract a named rule from ABNF", () => {
    const abnf = 'known = "first value"\nanother = "another value"\nknown =/ another';
    assert.equal(extractSegment(abnf, "known"), 'known = "first value" / another');
  });

  await t.test("extract rules from imported ABNF", () => {
    const abnf = 'known = *another\nanother = "another value"\nknown =/ "end"';
    assert.equal(extractRulesFromDependency("known", abnf), 'known = *another / "end"\nanother = "another value"\n\n');
  });

  await t.test("extract several rules at once from imported ABNF", () => {
    const abnf = 'known = *another\nknown2 = "value"\nanother = "another value"\nknown =/ "end"';
    assert.equal(extractRulesFromDependency(["known", "known2"], abnf), 'known = *another / "end"\nknown2 = "value"\nanother = "another value"\n\n');
  });

  await t.test("throws when importing with an unresolved dependency", () => {
    const abnf = 'known = *another\nanother = unknown';
    try {
      extractRulesFromDependency("known", abnf);
      assert(false, "Unreachable code");
    } catch (e) {
      assert(e.message.match(/Cannot extract rule/), "Throws for unknown rule");
    }
  });

  await t.test("renames a rule and its invokations", () => {
    const abnf = 'first = %x31\nknown = *another\nuntouched = %x30\nanother = "another value"\nequality = another / untouched';
    assert.equal(renameRule("another", "somethingelse", abnf),  'first = %x31\nknown = *somethingelse\nuntouched = %x30\nsomethingelse = "another value"\nequality = somethingelse / untouched');
  });

  await t.test("removes a rule and its extensions", () => {
    const abnf = 'first = %x31\nuntouched = %x30\nfirst =/ "second"';
    assert.equal(removeRule("first", abnf),  'untouched = %x30\n');
  });


});
