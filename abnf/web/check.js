import { parse } from "abnfp";
import serialize, { wrapper} from "../tools/lib/serialize.mjs";
import {listMissingExtendedDefs, makeParsable, coreNames} from "../tools/lib/processAbnf.mjs";
import {processDependencies} from "../tools/lib/processDependencies.mjs";

import html from "https://unpkg.com/escape-html-template-tag@2.2.3/dist/index.module.mjs";

const  abnfIndex = await (await fetch("../index.json")).json(); ;

let abnf;
let importsMap = { extends: {}, imports: {}};

const enc = new TextEncoder();

const validateBtn = document.getElementById("validate");
const abnfInp = document.getElementById("abnf");
const importsContainer = document.getElementById("imports");
const logOutput = document.getElementById("log");
const abnfOutput = document.getElementById("output");

window.Buffer = {
  from: str => enc.encode(" ")
};

function nameIsFrom(name, rfcData, dep) {
  const imported = Object.keys(rfcData.dependencies).find(k => rfcData.dependencies[k].names.includes(name.toUpperCase()));
  const extended = Object.keys(dep.extends || {}).map(n => n.toUpperCase()).includes(name.toUpperCase());
  if (extended) return {extended};
  if (imported) return {imported};
  return {};
}

validateBtn.addEventListener("click", validateAbnf);

function generateAbnfImportMap() {
  const map = {};
  for (const el of importsContainer.querySelectorAll("select")) {
    if (el.value) {
      map[el.name] = el.value;
    }
  }
  return map;
}

function generateDependencySelector(name, map) {
  const el = document.createElement("fieldset");
  const legend = document.createElement("legend");
  legend.textContent = `Import definition for "${name}"`;
  el.append(legend);
  const matchingSources = abnfIndex.filter(rfc => rfc.rules.includes(name));
  if (matchingSources.length) {
    const selector = document.createElement("select");
    selector.name = name;
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "Pick an existing matching RFC";
    selector.append(defaultOption);
    for (const src of matchingSources) {
      const option = document.createElement("option");
      option.value = src.name;
      option.textContent = `${src.name}: ${src.title}`;
      if (map?.[name] === src.name) {
	option.selected = true;
      }
      selector.append(option);
    }
    el.append(selector);
  } else {
    const p = document.createElement("p");
    p.className = "error";
    p.textContent = "No matching rule found in the RFCs known by this tool";
    el.append(p);
  }
  return el;
}

async function abnfLoader(name) {
  if (name === "__input") {
    return abnf;
  }
  return (await fetch(`../source/${name.toLowerCase()}.abnf`)).text();
}

async function dependencyLoader(name) {
  console.log("Loading dependencies for " + name);
  if (name === "__input") {
    return importsMap;
  }
  try {
    const res = await fetch(`../dependencies/${name.toLowerCase()}.json`);
    // await to catch potential exception here
    return await res.json();
  } catch (e) {
    return {};
  }
}

async function validateAbnf(e) {
  e.preventDefault();
  validateBtn.disabled = true;
  abnf = abnfInp.value;
  const map = generateAbnfImportMap();
  let undefinedRefs, missingRefs, importedRefs = new Set();
  try {
    missingRefs = listMissingExtendedDefs(abnf);
    undefinedRefs = new Set(missingRefs);
  } catch (e) {
    logOutput.textContent = e;
    validateBtn.disabled = false;
    return;
  }
  const parsableAbnf = makeParsable(abnf);
  const rules = parse(parsableAbnf);

  importsContainer.innerHTML = "";
  rules.refs.forEach(ref => {
    if (!rules.defs[ref.name.toUpperCase()] && !coreNames.has(ref.name.toUpperCase())) {
      undefinedRefs.add(ref.name.toUpperCase());
      importedRefs.add(ref.name.toUpperCase());
    }
  });
  for (const name of undefinedRefs) {
    const el = generateDependencySelector(name, map);
    importsContainer.append(el);
  }
  let complete = true;
  for (const name of missingRefs) {
    if (map[name]) {
      importsMap.extends[name] = map[name];
    } else {
      complete = false;
    }
  }
  for (const name of importedRefs) {
    if (map[name]) {
      importsMap.imports[name] = map[name];
    } else {
      complete = false;
    }
  }
  console.log(importsMap);
  if (complete) {
    validateBtn.disabled = true;

    try {
      const consolidatedAbnf = await processDependencies({abnfName: "__input"}, abnfLoader, dependencyLoader);
      abnfOutput.textContent =  consolidatedAbnf;
      validateBtn.disabled = false;
    } catch (e) {
      console.error(e);
      logOutput.textContent = e;
      validateBtn.disabled = false;
      return;
    }
  }
  validateBtn.disabled = false;
}


