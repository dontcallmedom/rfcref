import { readdir, readFile, writeFile } from "fs/promises";

import { rfcLoader, dependencyLoader } from "./lib/loaders.mjs";
import { buildImportMap } from "./lib/processDependencies.mjs";

async function buildIndex(localRfcPath) {
  const paths = await readdir(new URL("../consolidated/", import.meta.url));
  const index = [];
  for (const path of paths) {
    const [rfcName, profile] = path.split(".")[0].split("-");
    const rfcEntry ={name: rfcName.toUpperCase(), path: `consolidated/${path}`};
    if (profile) {
      rfcEntry.profile = profile;
    }

    const importMap = await buildImportMap({abnfName: rfcName, profile}, rfcLoader, dependencyLoader);
    delete importMap.__order;
    delete importMap[rfcName];
    delete importMap["rfc5234"];
    for (const dep of Object.values(importMap)) {
      delete dep.ignore;
      delete dep.dependsOn;
    }
    rfcEntry.dependencies = Object.fromEntries(Object.entries(importMap).map(([k, v]) => [k.toUpperCase(), v]));
    let metadata;
    if (localRfcPath) {
      metadata = JSON.parse(await readFile(`${localRfcPath}/${rfcName}.json`, "utf-8"));
    } else {
      metadata = await (await fetch(`https://www.rfc-editor.org/rfc/${rfcName}.json`)).json();
    }
    rfcEntry.title = metadata.title;
    rfcEntry.status = metadata.status;
    rfcEntry.obsoletes = metadata.obsoletes;
    rfcEntry.obsoleted_by = metadata.obsoleted_by;
    rfcEntry.updates = metadata.updates;
    rfcEntry.updated_by = metadata.updated_by;
    index.push(rfcEntry);
  }
  return index;
}

const index = await buildIndex(process.argv[2]);
writeFile(new URL("../index.json", import.meta.url), JSON.stringify(index, null, 2));
