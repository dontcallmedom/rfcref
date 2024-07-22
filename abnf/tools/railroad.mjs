import { parseFile } from "abnf";
import rr from "railroad";

function walkRule(rule) {
  switch (rule.type) {
  case "rule":
    break;
  case "caseSensitveString":
    break;
  case "caseInsensitveString":
    break;
  case "alternation":
    break;
  case "ruleref":
    break;
  case "concatenation":
    break;
  case "group":
    break;
  case "range":
    break;
  case "prose":
    break;
  case "repetition":
    break;
  case "repeat":
    break;
  default:
    throw new Error(`Unexpected type ${rule.type} from ABNF rule: ${rule}`);
  }
}

export function generateRailroad(path, ruleName) {
  const rules = await parseFile(path);
  if (!ruleName) {
    ruleName = rules.first;
  }
  const rule = rules.defs.find(d => d.name === ruleName.toUpperCase());
  return walkRule(rule);
}

await generateRailroad(process.argv[2]);
