import fs from "fs/promises";
import xpath from "xpath";
import xmldom from "xmldom";

import loadXmlRfc from "../../lib/load-xml-rfc.mjs";

const dom = xmldom.DOMParser;

const rfcNum = parseInt(process.argv[2], 10);
const localpath = process.argv[3];

async function extractDfns(rfcNum, localpath) {
  let body;
  if (localpath) {
    body = await fs.readFile(`${localpath}/rfc${rfcNum}.xml`, 'utf-8');
  } else {
    body = await loadXmlRfc(rfcNum);
  }

  // extract textContent of sourcecode elements with type=abnf
  const doc = new dom().parseFromString(body, 'text/xml');
  const dfnNodes = xpath.select("//iref[@primary='true']", doc);
  const dfns = dfnNodes.map(n => {
    const attributes = Object.fromEntries(Object.values(n.attributes).map(a => [a.name, a.value]));
    const type = attributes['subitem'] ? attributes['item'] : undefined;
    const name = type ? attributes['subitem'] : attributes['item'];
    const ret = { name, id: attributes['pn'] };
    if (type) {
      ret.type = type;
    }
    return ret;
  });
  return dfns;
}

const dfns = await extractDfns(rfcNum, localpath);
if (dfns.length) {
  fs.writeFile(new URL(`../rfc${rfcNum}.json`, import.meta.url), JSON.stringify(dfns, null, 2));
}
