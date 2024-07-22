const id = x => x;

export function wrapper(customized = {}) {
  return {
    rule: id,
    rulenamedecl: id,
    rulename: id,
    ruledef: id,
    str: id,
    codechar: id,
    operator: id,
    prose: id,
    repetitor: id
  };
}

export default function serialize(rule, wrap = wrapper()) {
  const base = {2: "b", 10: "d", 16: "x"}[rule.base];
  switch(rule.type) {
  case "rule":
    return `${wrap.rule(`${wrap.rulenamedecl(rule.name)} ${wrap.operator("=")} ${wrap.ruledef(serialize(rule.def, wrap))}`)}`;
  case "caseSensitveString":
    if (rule.base) {
      return `${wrap.codechar(`${wrap.operator("%")}${base}${Buffer.from(rule.str)[0].toString(rule.base)}`)}`;
    } else {
      return `${wrap.operator('"')}${wrap.str(rule.str)}${wrap.operator('"')}`;
    }
  case "caseInsensitveString":
    if (rule.base) {
      return `${wrap.codechar(`${wrap.operator("%")}${base}${parseInt(rule.str, rule.base)}`)}`;
    } else {
      return `${wrap.operator('"')}${wrap.str(rule.str)}${wrap.operator('"')}`;
    }
  case "alternation":
    return rule.alts.map(d => serialize(d, wrap)).join(` ${wrap.operator("/")} `);
  case "ruleref":
    return wrap.rulename(rule.name);
  case "concatenation":
    return rule.elements.map(d => serialize(d, wrap)).join(" ");
  case "group":
    return `${wrap.operator("(")}${serialize(rule.alt, wrap)}${wrap.operator(")")}`;
  case "range":
    return `${wrap.codechar(`${wrap.operator("%")}${base}${rule.first.toString(rule.base)}${wrap.operator("-")}${rule.last.toString(rule.base)}`)}`;
  case "prose":
    return `${wrap.operator("<")}${wrap.prose(rule.str)}${wrap.operator(">")}`;
  case "repetition":
    let ret = `${serialize(rule.rep, wrap)}${serialize(rule.el, wrap)}`;
    if (rule.rep.min === 0 && rule.rep.max === 1) {
      ret += wrap.operator("]");
    }
    return ret;
  case "repeat":
    if (rule.min === rule.max) {
      return wrap.repetitor(rule.min);
    }
    if (rule.min === 0 && rule.max === 1) {
      return wrap.operator("[");
    }
    return `${rule.min === 0 ? "" : wrap.repetitor(rule.min)}${wrap.operator("*")}${rule.max === null ? "" : wrap.repetitor(rule.max)}`;
  default:
    throw new Error(`Unexpected type ${rule.type} from ABNF rule: ${rule}`);
  }
}

