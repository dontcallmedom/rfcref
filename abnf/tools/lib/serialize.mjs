export default function serialize(rule) {
  const base = {2: "b", 10: "d", 16: "x"}[rule.base];
  switch(rule.type) {
  case "rule":
    return `${rule.name} = ${serialize(rule.def)}`;
  case "caseSensitveString":
    if (rule.base) {
      return `%${base}${Buffer.from(rule.str)[0].toString(rule.base)}`;
    } else {
      return `"${rule.str}"`;
    }
  case "caseInsensitveString":
    if (rule.base) {
      return `%${base}${parseInt(rule.str, rule.base)}`;
    } else {
      return `"${rule.str}"`;
    }
  case "alternation":
    return rule.alts.map(d => serialize(d)).join(" / ");
  case "ruleref":
    return rule.name;
  case "concatenation":
    return rule.elements.map(d => serialize(d)).join(" ");
  case "group":
    return `(${serialize(rule.alt)})`;
  case "range":
    return `%${base}${rule.first.toString(rule.base)}-${rule.last.toString(rule.base)}`;
  case "prose":
    return `<${rule.str}>`;
  case "repetition":
    let ret = `${serialize(rule.rep)}${serialize(rule.el)}`;
    if (rule.rep.min === 0 && rule.rep.max === 1) {
      ret += "]";
    }
    return ret;
  case "repeat":
    if (rule.min === rule.max) {
      return rule.min;
    }
    if (rule.min === 0 && rule.max === 1) {
      return "[";
    }
    return `${rule.min === 0 ? "" : rule.min}*${rule.max === null ? "" : rule.max}`;
  default:
    throw new Error(`Unexpected type ${rule.type} from ABNF rule: ${rule}`);
  }
}

