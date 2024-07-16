const fs = require("fs").promises;

const xpath = require('xpath'),
      dom = require('xmldom').DOMParser;

const rfcNum = parseInt(process.argv[2], 10);
// Prior to RFC 8650, there is no official XML version of RFCs)
if (rfcNum < 8650) {
  console.error(`No official XML version for RFC ${rfcNum}`);
  process.exit(2);
}

(async function() {
  let body;
  try {
    const res = await fetch(`https://www.rfc-editor.org/rfc/rfc${rfcNum}.xml`);
    if (res.status !== 200) {
      console.error(`HTTP Error fetching RFC ${rfcNum}:`);
      console.error(res.status);
      process.exit(2);
    }
    body = await res.text();
  } catch (e) {
    console.error(`Error fetching RFC ${rfcNum}:`);
    console.trace(e);
    process.exit(2);
  }

  // extract textContent of sourcecode elements with type=abnf
  const doc = new dom().parseFromString(body, 'text/xml');
  const abnfNodes = xpath.select("//sourcecode[@type='abnf']/text()", doc);
  const extractPreamble = `; Extracted from IETF RFC ${rfcNum}
; Copyright (c) IETF Trust and the persons identified as authors of the code. All rights reserved.
; Redistribution and use in source and binary forms, with or without modification, is permitted pursuant to, and subject to the license terms contained in, the Revised BSD License set forth in Section 4.c of the IETF Trust's Legal Provisions Relating to IETF Documents (https://trustee.ietf.org/license-info).
`;
  const extract = extractPreamble + abnfNodes.map(n => n.data).join("\n");
  fs.writeFile(__dirname + `/../source/rfc${rfcNum}.abnf`, extract);
})();
