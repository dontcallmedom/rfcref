import test from "node:test";
import assert from "assert";

import { parseString } from "abnf";
import { listNames } from "../lib/processAbnf.mjs";

import { readdir, readFile } from "fs/promises";

const consolidatedAbnf = {};

test("the consolidated ABNF files", async t => {
  await t.before(async () => {
    const paths = await readdir(new URL("../../consolidated/", import.meta.url));
    for (const p of paths) {
      const rfcNum = p.split("/").slice(-1)[0].split(".")[0].split("-")[0];
      consolidatedAbnf[rfcNum] = {
	source: await readFile(new URL(`../../source/${rfcNum}.abnf`, import.meta.url), "utf-8"),
	consolidated: await readFile(new URL(`../../consolidated/${p}`, import.meta.url), "utf-8"),
	isProfile: p.includes("-")
      };
    }
  });

  await t.test("are parsable", async() => {
    for (const rfcNum of Object.keys(consolidatedAbnf)) {
      try {
	parseString(consolidatedAbnf[rfcNum].consolidated);
      } catch (e) {
	assert(false, `consolidated ${rfcNum} failed to parse: ${e}`);
      }
    }
  });

  await t.test("contain a superset of the rules in their source", async() => {
    for (const rfcNum of Object.keys(consolidatedAbnf)) {
      // this is not necessarily true with a profile
      if (consolidatedAbnf[rfcNum].isProfile) {
	continue;
      }
      const consolidatedNames = listNames(consolidatedAbnf[rfcNum].consolidated);
      const sourceNames = listNames(consolidatedAbnf[rfcNum].source);
      const diff = sourceNames.difference(consolidatedNames)
      assert(diff.size === 0, `${[...diff].join(", ")} are present in source of ${rfcNum} but not in consolidated`);
    }
  });

});
