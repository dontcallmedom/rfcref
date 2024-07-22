import { parseFile } from "abnf";

console.log(JSON.stringify(await parseFile(process.argv[2]), null, 2));
