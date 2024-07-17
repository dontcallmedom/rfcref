`extract-abnf-from-xml-rfc.js` takes an RFC number, fetches the XML version of that RFC and extracts the ABNF content from that RFC into `../source/rfc[NUM].abnf`.
`node extract-abnf-from-xml-rfc.js <RFC Number>`

`consolidate-abnf.mjs` takes an RFC number, loads the (previously extracted in `../source`) ABNF from that RFC and the JSON description of dependencies (in `../dependencies`), and generates a consolidated version of the ABNF that includes all the referenced terms from other RFCs.
`node consolidate-abnf.mjs <RFC Number>`

Make sure to install the dependencies with `npm install`.
