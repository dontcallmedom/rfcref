import { readFile} from "fs/promises";
import { parseFile } from "abnf";

const rfcNum = process.argv[2];

(async function() {
  const depedencies = JSON.parse(await readFile("abnf/fromxml/dependencies.json"));
  const rules = await parseFile("myfile.abnf");

})();
