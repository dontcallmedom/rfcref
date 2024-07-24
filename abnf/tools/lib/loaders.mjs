import { readFile } from "fs/promises";

export async function rfcLoader(rfcNum) {
  return readFile(new URL(`../../source/${rfcNum}.abnf`, import.meta.url), 'utf-8');
}

export async function dependencyLoader(rfcNum) {
  let data;
  try {
    data = await readFile(new URL(`../../dependencies/${rfcNum}.json`, import.meta.url));
  } catch (e) {
    return {};
  }
  return JSON.parse(data);
}
