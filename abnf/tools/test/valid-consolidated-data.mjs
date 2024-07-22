import test from "node:test";
import assert from "assert";
import { readdir, readFile } from "fs/promises";

import { parseString } from "abnf";
import { listNames } from "../lib/processAbnf.mjs";
import consolidateAbnf from "../consolidate-abnf.mjs";


const consolidatedAbnf = {};

test("the consolidated ABNF files", async t => {
  await t.before(async () => {
    const paths = await readdir(new URL("../../consolidated/", import.meta.url));
    for (const p of paths) {
      const rfcNum = p.split("/").slice(-1)[0].split(".")[0].split("-")[0];
      consolidatedAbnf[rfcNum] = {
	source: await readFile(new URL(`../../source/${rfcNum}.abnf`, import.meta.url), "utf-8"),
	consolidated: await readFile(new URL(`../../consolidated/${p}`, import.meta.url), "utf-8"),
	profile: p.split("-")[1]?.split(".")[0]
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

  await t.test("can be regenerated", async() => {
    for (const rfcNum of Object.keys(consolidatedAbnf)) {
      try {
	await consolidateAbnf(rfcNum, consolidatedAbnf[rfcNum].profile);
      } catch (e) {
	assert(false, `Failed to re-consolidate ${rfcNum}: ${e}`);
      }
    }
  });

  await t.test("contain a superset of the rules in their source", async() => {
    for (const rfcNum of Object.keys(consolidatedAbnf)) {
      // this is not necessarily true with a profile
      if (consolidatedAbnf[rfcNum].profile) {
	continue;
      }
      const consolidatedNames = listNames(consolidatedAbnf[rfcNum].consolidated);
      const sourceNames = listNames(consolidatedAbnf[rfcNum].source);
      const diff = sourceNames.difference(consolidatedNames)
      assert(diff.size === 0, `${[...diff].join(", ")} are present in source of ${rfcNum} but not in consolidated`);
    }
  });

});
