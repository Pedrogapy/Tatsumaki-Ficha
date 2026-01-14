// =========
// Tatsumaki RPG Sheet — app.js
// Data-driven (character.json) + local save (localStorage)
// =========

// ------------------------------
// Dice + expression evaluator (Etapa 7)
// - Aceita: + - * / parênteses
// - Aceita: d20 (sem número -> 1d20)
// - Aceita: referências @attributes.* / @skills.*
// - Sem eval()
// ------------------------------

function rollDice(n, sides){
  let rolls = [];
  let sum = 0;
  for(let i=0;i<n;i++){
    const r = 1 + Math.floor(Math.random()*sides);
    rolls.push(r);
    sum += r;
  }
  return { sum, rolls };
}

function clampInt(n, min, max){
  const v = Math.trunc(Number(n));
  if(!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

function fmtNumber(n){
  if(!Number.isFinite(n)) return String(n);
  // Evita “.0000000004”
  const rounded = Math.round(n * 100) / 100;
  if(Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

function deaccent(str){
  try{
    return String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }catch(_){
    return String(str || '');
  }
}

function addKeyAliases(map, rawKey, value){
  const k = String(rawKey || '').trim();
  if(!k) return;
  const kUnd = k.replace(/\s+/g, '_');
  const kPlain = deaccent(k);
  const kPlainUnd = kPlain.replace(/\s+/g, '_');

  // original
  map[k] = value;
  // espaço -> _
  map[kUnd] = value;
  // sem acento
  map[kPlain] = value;
  map[kPlainUnd] = value;
  // lowercase para facilitar
  map[k.toLowerCase()] = value;
  map[kUnd.toLowerCase()] = value;
  map[kPlain.toLowerCase()] = value;
  map[kPlainUnd.toLowerCase()] = value;
}

function getAtPath(obj, parts){
  let cur = obj;
  for(const p of parts){
    if(cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function resolveRefs(expr, ctx){
  if(!expr) return "";
  return expr.replace(/@([A-Za-zÀ-ÿ0-9_\.]+)/g, (m, path) => {
    const parts = path.split(".");
    const v = getAtPath(ctx, parts);
    if(v === undefined || v === null || Number.isNaN(Number(v))) return "0";
    return String(v);
  });
}

function normalizeExpr(expr){
  return String(expr || '')
    .replace(/\s+/g, '')
    .replace(/,/g, '.')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/[–—]/g, '-')
    .replace(/\u00BC/g, '1/4') // ¼
    .replace(/\u00BD/g, '1/2') // ½
    .replace(/\u00BE/g, '3/4'); // ¾
}

function tokenizeExpression(expr){
  const tokens = [];
  const s = normalizeExpr(expr);
  let i = 0;

  const isDigit = (c) => c >= '0' && c <= '9';
  const isOp = (c) => c === '+' || c === '-' || c === '*' || c === '/';

  while(i < s.length){
    const c = s[i];

    if(c === '(' || c === ')'){
      tokens.push({ type: 'paren', value: c });
      i++; continue;
    }

    if(isOp(c)){
      tokens.push({ type: 'op', value: c });
      i++; continue;
    }

    // Dice sem número: d20
    if(c === 'd' || c === 'D'){
      i++;
      let sidesStr = '';
      while(i < s.length && isDigit(s[i])){ sidesStr += s[i]; i++; }
      const sides = Number(sidesStr);
      if(!Number.isFinite(sides) || sides <= 0){
        return { ok: false, error: `Dado inválido: d${sidesStr || '?'}` };
      }
      tokens.push({ type: 'dice', n: 1, sides: clampInt(sides, 2, 100000) });
      continue;
    }

    // Número ou NdM
    if(isDigit(c) || c === '.'){
      let numStr = '';
      while(i < s.length && (isDigit(s[i]) || s[i] === '.')){
        numStr += s[i]; i++;
      }

      // Dice: <num>d<sides>
      if(i < s.length && (s[i] === 'd' || s[i] === 'D')){
        i++;
        let sidesStr = '';
        while(i < s.length && isDigit(s[i])){ sidesStr += s[i]; i++; }
        const n = Number(numStr);
        const sides = Number(sidesStr);
        if(!Number.isFinite(n) || !Number.isFinite(sides) || n <= 0 || sides <= 0){
          return { ok: false, error: `Dado inválido: ${numStr}d${sidesStr || '?'}` };
        }
        const dn = clampInt(n, 1, 500); // evita explosão
        const ds = clampInt(sides, 2, 100000);
        tokens.push({ type: 'dice', n: dn, sides: ds });
        continue;
      }

      const v = Number(numStr);
      if(!Number.isFinite(v)){
        return { ok: false, error: `Número inválido: ${numStr}` };
      }
      tokens.push({ type: 'number', value: v });
      continue;
    }

    // Qualquer outro caractere: erro explícito
    return { ok: false, error: `Caractere inválido: "${c}"` };
  }

  return { ok: true, tokens };
}

function toRPN(tokens){
  const out = [];
  const stack = [];
  const prec = { 'u-': 3, '*': 2, '/': 2, '+': 1, '-': 1 };
  const rightAssoc = { 'u-': true };

  let prev = null;
  const isValue = (t) => t && (t.type === 'number' || t.type === 'dice' || (t.type === 'paren' && t.value === ')'));

  for(const t of tokens){
    if(t.type === 'number' || t.type === 'dice'){
      out.push(t);
      prev = t;
      continue;
    }
    if(t.type === 'paren'){
      if(t.value === '('){
        stack.push(t);
        prev = t;
      }else{
        while(stack.length && stack[stack.length-1].type !== 'paren'){
          out.push(stack.pop());
        }
        if(!stack.length) return { ok: false, error: 'Parênteses desbalanceados.' };
        stack.pop(); // remove '('
        prev = t;
      }
      continue;
    }
    if(t.type === 'op'){
      let op = t.value;

      // Unário: -x
      if(op === '-' && (!prev || (prev.type === 'op') || (prev.type === 'paren' && prev.value === '('))){
        op = 'u-';
      }

      while(stack.length){
        const top = stack[stack.length-1];
        if(top.type !== 'op') break;
        const p1 = prec[op] ?? 0;
        const p2 = prec[top.value] ?? 0;
        const shouldPop = rightAssoc[op] ? (p1 < p2) : (p1 <= p2);
        if(!shouldPop) break;
        out.push(stack.pop());
      }

      stack.push({ type: 'op', value: op });
      prev = { type: 'op', value: op };
      continue;
    }
  }

  while(stack.length){
    const t = stack.pop();
    if(t.type === 'paren') return { ok: false, error: 'Parênteses desbalanceados.' };
    out.push(t);
  }

  return { ok: true, rpn: out };
}

function evalRPN(rpn, options){
  const st = [];
  const opts = options || {};

  const rollDiceTerm = (n, sides) => {
    // Modo d20 só faz sentido com 1d20
    if(sides === 20 && n === 1 && (opts.d20Mode === 'adv' || opts.d20Mode === 'dis')){
      const a = rollDice(1, 20).rolls[0];
      const b = rollDice(1, 20).rolls[0];
      const chosen = (opts.d20Mode === 'adv') ? Math.max(a,b) : Math.min(a,b);
      const modeTxt = opts.d20Mode === 'adv' ? 'vantagem' : 'desvantagem';
      return { sum: chosen, rolls: [a,b], chosen, detail: `1d20(${modeTxt}:[${a},${b}]→${chosen})` };
    }
    const r = rollDice(n, sides);
    return { sum: r.sum, rolls: r.rolls, detail: `${n}d${sides}=[${r.rolls.join(',')}]→${r.sum}` };
  };

  for(const t of rpn){
    if(t.type === 'number'){
      st.push({ value: t.value, repr: fmtNumber(t.value) });
      continue;
    }
    if(t.type === 'dice'){
      const n = clampInt(t.n, 1, 500);
      const sides = clampInt(t.sides, 2, 100000);
      const r = rollDiceTerm(n, sides);
      st.push({ value: r.sum, repr: r.detail });
      continue;
    }
    if(t.type === 'op'){
      const op = t.value;
      if(op === 'u-'){
        const a = st.pop();
        if(!a) return { ok: false, error: 'Expressão inválida (unário).' };
        st.push({ value: -a.value, repr: `(-${a.repr})` });
        continue;
      }
      const b = st.pop();
      const a = st.pop();
      if(!a || !b) return { ok: false, error: 'Expressão inválida.' };

      let v = 0;
      if(op === '+') v = a.value + b.value;
      else if(op === '-') v = a.value - b.value;
      else if(op === '*') v = a.value * b.value;
      else if(op === '/') v = (b.value === 0) ? NaN : (a.value / b.value);
      else return { ok: false, error: `Operador desconhecido: ${op}` };

      st.push({ value: v, repr: `(${a.repr} ${op} ${b.repr})` });
      continue;
    }
  }

  if(st.length !== 1) return { ok: false, error: 'Expressão inválida (pilha).' };
  return { ok: true, value: st[0].value, repr: st[0].repr };
}

function stripOuterParens(s){
  let t = String(s || '').trim();
  // remove um nível de parênteses externos se existir
  if(t.startsWith('(') && t.endsWith(')')){
    // verifica balanceamento simples
    let depth = 0;
    let ok = true;
    for(let i=0;i<t.length;i++){
      const c = t[i];
      if(c === '(') depth++;
      if(c === ')') depth--;
      if(depth === 0 && i < t.length-1){ ok = false; break; }
    }
    if(ok) t = t.slice(1,-1);
  }
  return t;
}

function evalExpr(expr, ctx, options){
  const resolved = normalizeExpr(resolveRefs(expr, ctx));
  if(!resolved) return { total: 0, detail: "(sem rolagem)" };

  const tok = tokenizeExpression(resolved);
  if(!tok.ok){
    return { total: 0, detail: `${expr} => ERRO: ${tok.error}` };
  }
  const rpn = toRPN(tok.tokens);
  if(!rpn.ok){
    return { total: 0, detail: `${expr} => ERRO: ${rpn.error}` };
  }
  const ev = evalRPN(rpn.rpn, options);
  if(!ev.ok){
    return { total: 0, detail: `${expr} => ERRO: ${ev.error}` };
  }

  const total = ev.value;
  const repr = stripOuterParens(ev.repr);
  const detail = `${expr} => ${repr} = ${fmtNumber(total)}`;
  return { total, detail, resolved, repr };
}

// Advantage/Disadvantage for d20 checks (used for "Sorte" and future skill checks)
function rollD20WithMode(mod = 0, mode = "normal"){ // mode: normal|adv|dis
  const m = Number(mod || 0);
  const expr = `1d20${m ? (m > 0 ? "+" : "") + m : ""}`;
  const res = evalExpr(expr, ctx || {}, { d20Mode: mode });
  return { total: res.total, detail: res.detail };
}

// ------------------------------
// Character + context
// ------------------------------
let character = null;
let ctx = null;

// ------------------------------
// Etapa 8 — Perícias (catálogo + UI + rolagem)
// ------------------------------
let skillsCatalog = null;
let skillIndex = null;

const ATTR_LABEL = {
  FOR: "Força",
  ARC: "Arcano",
  DES: "Destreza",
  FORT: "Fortitude",
  INT: "Inteligência",
  SAB: "Sabedoria"
};

function normKey(s){
  return deaccent(String(s || "")).toLowerCase().trim().replace(/[^a-z0-9]+/g, "_");
}

async function loadSkillsCatalog(){
  try{
    skillsCatalog = await fetch("data/skills_catalog.json").then(r => r.json());
    return true;
  }catch(e){
    console.warn("Falha ao carregar skills_catalog.json", e);
    skillsCatalog = null;
    return false;
  }
}

function buildSkillIndexFromCharacter(c){
  const idx = {};
  const groups = c?.skills || {};
  Object.values(groups).forEach(arr => {
    (arr || []).forEach(s => {
      const attr = String(s.attribute || "").toUpperCase();
      if(!attr) return;
      if(!idx[attr]) idx[attr] = {};
      addKeyAliases(idx[attr], s.name, s);
    });
  });
  return idx;
}

function lookupSkill(attrCode, name, aliases){
  const a = String(attrCode || "").toUpperCase();
  const map = (skillIndex && skillIndex[a]) ? skillIndex[a] : null;
  if(!map) return null;

  const tries = [name].concat(Array.isArray(aliases) ? aliases : []).filter(Boolean);
  for(const t of tries){
    if(map[t]) return map[t];
    const n = normKey(t);
    if(map[n]) return map[n];
    const l = String(t).toLowerCase();
    if(map[l]) return map[l];
    const d = deaccent(l);
    if(map[d]) return map[d];
  }
  return null;
}

function getAttrObjByCode(code){
  const name = ATTR_LABEL[String(code || "").toUpperCase()] || String(code || "");
  return (ctx?.attributes?.[name] || ctx?.attributes?.[name.toLowerCase()] || ctx?.attributes?.[deaccent(name)] || null);
}

function skillMatchesQuery(skill, q){
  if(!q) return true;
  const n = normKey(skill?.name || "");
  const d = normKey(skill?.desc || "");
  return n.includes(q) || d.includes(q);
}

function applySkillUiToState(){
  const modeEl = document.getElementById("skillMode");
  const autoEl = document.getElementById("autoMagicAdv");
  if(modeEl) state.ui.skillMode = String(modeEl.value || "normal");
  if(autoEl) state.ui.autoMagicAdv = !!autoEl.checked;
}

function applyStateToSkillUi(){
  const modeEl = document.getElementById("skillMode");
  const autoEl = document.getElementById("autoMagicAdv");
  if(modeEl) modeEl.value = state?.ui?.skillMode || "normal";
  if(autoEl) autoEl.checked = !!state?.ui?.autoMagicAdv;
}

function rollSkillCheck(entry, modeOverride){
  const autoMagic = !!document.getElementById("autoMagicAdv")?.checked;
  const uiMode = String(document.getElementById("skillMode")?.value || "normal");
  let mode = String(modeOverride || uiMode);

  if(autoMagic && entry?.magic && mode === "normal"){
    mode = "adv";
  }

  const mod = Number(entry?.total ?? 0);
  const res = rollD20WithMode(mod, mode);

  const modeTxt = (mode === "adv") ? " (vantagem)" : (mode === "dis") ? " (desvantagem)" : "";
  const tagTxt = entry?.magic && autoMagic ? " [auto]" : "";

  log(`Perícia ${entry.name} [${entry.attr}]${modeTxt}${tagTxt}: ${res.detail}`);
  try{ window.__sfx?.play?.("roll"); }catch(_){/* ignore */}
  render();
}

function renderSkillsTab(){
  const root = document.getElementById("skillsRoot");
  if(!root) return;

  if(!skillsCatalog || !skillIndex){
    root.innerHTML = '<div class="skillEmpty">Catálogo de perícias indisponível.</div>';
    return;
  }

  const q = normKey(document.getElementById("skillSearch")?.value || "");
  root.innerHTML = "";

  let any = false;

  (skillsCatalog.groups || []).forEach(group => {
    const gCode = String(group.code || "").toUpperCase();
    const gName = String(group.name || gCode);

    const attrObj = getAttrObjByCode(gCode);
    const attrMeta = attrObj ? `Atributo ${attrObj.value} (¼=${attrObj.quarter})` : "";

    const rawSkills = Array.isArray(group.skills) ? group.skills : [];
    const filtered = rawSkills.filter(s => skillMatchesQuery(s, q));

    // Se houver busca ativa, não mostra grupo vazio
    if(q && filtered.length === 0) return;

    any = true;

    const gEl = document.createElement("div");
    gEl.className = "skillGroup";

    const header = document.createElement("div");
    header.className = "skillGroupHeader";
    header.innerHTML = `<h3>${gName}</h3><div class="skillAttrMeta"><span>${gCode}</span>${attrMeta ? `<span>•</span><span>${attrMeta}</span>` : ""}</div>`;
    gEl.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "skillGrid";

    if(filtered.length === 0){
      const empty = document.createElement("div");
      empty.className = "skillEmpty";
      empty.textContent = "Nenhuma perícia encontrada.";
      grid.appendChild(empty);
    }else{
      filtered.forEach(s => {
        const skillData = lookupSkill(gCode, s.name, s.aliases) || { total: 0, level: 0, proficient: false };
        const total = Number(skillData.total ?? 0);
        const lvl = Number(skillData.level ?? 0);
        const prof = !!skillData.proficient;
        const magic = !!s.magic;

        const card = document.createElement("div");
        card.className = "skillCard";

        const top = document.createElement("div");
        top.className = "skillTop";

        const left = document.createElement("div");
        left.innerHTML = `
          <div class="skillName">${s.name}</div>
          <div class="skillMetaLine">
            <span>${gCode}</span>
            <span>•</span>
            <span>Nível ${lvl}</span>
          </div>
        `;

        const badges = document.createElement("div");
        badges.className = "skillBadges";

        const bTotal = document.createElement("span");
        bTotal.className = "badge total";
        bTotal.textContent = `Total ${total >= 0 ? "+" : ""}${total}`;
        badges.appendChild(bTotal);

        if(prof){
          const bProf = document.createElement("span");
          bProf.className = "badge prof";
          bProf.textContent = "Prof.";
          badges.appendChild(bProf);
        }

        if(magic){
          const bMagic = document.createElement("span");
          bMagic.className = "badge magic";
          bMagic.textContent = "Magia";
          badges.appendChild(bMagic);
        }

        top.appendChild(left);
        top.appendChild(badges);
        card.appendChild(top);

        const actions = document.createElement("div");
        actions.className = "skillActions";

        const btnRoll = document.createElement("button");
        btnRoll.className = "btn btn-sm";
        btnRoll.textContent = "Rolar";
        btnRoll.onclick = () => rollSkillCheck({ name: s.name, attr: gCode, total, magic }, null);

        const btnAdv = document.createElement("button");
        btnAdv.className = "btn btn-ghost btn-sm";
        btnAdv.textContent = "Adv";
        btnAdv.onclick = () => rollSkillCheck({ name: s.name, attr: gCode, total, magic }, "adv");

        const btnDis = document.createElement("button");
        btnDis.className = "btn btn-ghost btn-sm";
        btnDis.textContent = "Dis";
        btnDis.onclick = () => rollSkillCheck({ name: s.name, attr: gCode, total, magic }, "dis");

        actions.appendChild(btnRoll);
        actions.appendChild(btnAdv);
        actions.appendChild(btnDis);
        card.appendChild(actions);

        if(s.desc){
          const desc = document.createElement("div");
          desc.className = "skillDesc";
          desc.textContent = String(s.desc);
          card.appendChild(desc);
        }

        grid.appendChild(card);
      });
    }

    gEl.appendChild(grid);
    root.appendChild(gEl);
  });

  if(!any){
    root.innerHTML = '<div class="skillEmpty">Nenhuma perícia encontrada.</div>';
  }
}

function initSkillsUi(){
  const root = document.getElementById("skillsRoot");
  if(!root) return;

  applyStateToSkillUi();

  const searchEl = document.getElementById("skillSearch");
  const modeEl = document.getElementById("skillMode");
  const autoEl = document.getElementById("autoMagicAdv");

  if(searchEl){
    searchEl.addEventListener("input", () => renderSkillsTab());
  }
  if(modeEl){
    modeEl.addEventListener("change", () => {
      applySkillUiToState();
      saveState();
      renderSkillsTab();
    });
  }
  if(autoEl){
    autoEl.addEventListener("change", () => {
      applySkillUiToState();
      saveState();
      renderSkillsTab();
    });
  }

  renderSkillsTab();
}


function buildContextFromCharacter(c){
  // Attributes: by display name
  const attributes = {};
  (c.attributes || []).forEach(a => {
    addKeyAliases(attributes, a.name, a);
  });

  // Skills: by attribute code and skill name key (spaces -> _)
  const skills = {};
  const allGroups = c.skills || {};
  Object.values(allGroups).forEach(arr => {
    (arr || []).forEach(s => {
      const attr = s.attribute;
      if(!skills[attr]) skills[attr] = {};
      // guarda várias versões da chave (com/sem acento, espaço->_, lowercase)
      addKeyAliases(skills[attr], s.name, s);
    });
  });

  return {
    attributes,
    skills,
    stats: c.stats || {},
    tracks: (c.stats && c.stats.tracks) ? c.stats.tracks : {},
    custom: {} // runtime inputs (e.g. arma pesada dano base)
  };
}

// ------------------------------
// State + persistence
// ------------------------------
let MAX = { ps: 100, pvo: 2, pvd: 3, pf: 100 };

let state = {
  ps: 100,
  pvo: 2,
  pvd: 3,
  pf: 100,
  round: 1,
  // configurable (kept as 2 to match your current behavior)
  globalDamageBonusDice: 2,

  effects: {
    sanguenta: null, // {target, rounds}
    plasma: null     // {target}
  },

  logLines: [],

  ui: {
    skillMode: "normal",
    autoMagicAdv: true
  }
};

function saveKey(){
  const name = (character?.meta?.name || "character").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return `rpg_save:${name}:v1`;
}

function saveState(){
  try{
    const payload = {
      v: 1,
      round: state.round,
      tracks: { ps: state.ps, pf: state.pf, pvo: state.pvo, pvd: state.pvd },
      effects: state.effects,
      globalDamageBonusDice: state.globalDamageBonusDice,
      logLines: state.logLines,
      ui: state.ui
    };
    localStorage.setItem(saveKey(), JSON.stringify(payload));
  }catch(_){}
}

function loadState(){
  try{
    const raw = localStorage.getItem(saveKey());
    if(!raw) return false;
    const s = JSON.parse(raw);
    if(!s || s.v !== 1) return false;
    state.round = s.round ?? 1;
    state.ps = s.tracks?.ps ?? state.ps;
    state.pf = s.tracks?.pf ?? state.pf;
    state.pvo = s.tracks?.pvo ?? state.pvo;
    state.pvd = s.tracks?.pvd ?? state.pvd;
    state.effects = s.effects ?? state.effects;
    state.globalDamageBonusDice = (typeof s.globalDamageBonusDice === "number") ? s.globalDamageBonusDice : state.globalDamageBonusDice;
    state.logLines = Array.isArray(s.logLines) ? s.logLines : [];
    return true;
  }catch(_){
    return false;
  }
}

function resetTracks(){
  state.ps = MAX.ps;
  state.pf = MAX.pf;
  state.pvo = MAX.pvo;
  state.pvd = MAX.pvd;
}

function spend(resourceKey, amount){
  const k = resourceKey.toLowerCase();
  if(typeof state[k] !== "number") return false;
  if(state[k] < amount){
    log(`Sem recurso: ${resourceKey} (${state[k]}/${amount}).`);
    return false;
  }
  state[k] -= amount;
  return true;
}

// ------------------------------
// Logging
// ------------------------------
function log(msg){
  const stamp = `R${state.round}`;
  state.logLines.unshift(`[${stamp}] ${msg}`);
  if(state.logLines.length > 200) state.logLines = state.logLines.slice(0, 200);
  renderLog();

  // Expose minimal hooks for UX layer (ui enhancements without mixing with game logic)
  window.__tats = { state, MAX, character, saveState, renderLog, render, log };
  document.dispatchEvent(new CustomEvent("tats-ready"));

  saveState();
}

function renderLog(){
  const el = document.getElementById("log");
  el.textContent = state.logLines.join("\n");
}

// ------------------------------
// Effects
// ------------------------------
function applySanguenta(target){
  // Custo automático mínimo (do seu JSON): PS 4
  if(!spend("PS", 4)) return;
  const dur = evalExpr("1d4+1", ctx).total;
  state.effects.sanguenta = { target, rounds: dur };

  // regra: substitui plasma no mesmo alvo
  if(state.effects.plasma && state.effects.plasma.target === target){
    state.effects.plasma = null;
  }

  log(`Arma Sanguenta em ${target} por ${dur} rodadas (+1d8 dano).`);
  renderEffects();
}

function togglePlasma(target){
  if(state.effects.plasma && state.effects.plasma.target === target){
    state.effects.plasma = null;
    log(`Plasma desligado em ${target}.`);
    renderEffects();
    return;
  }

  // Custo prático (do texto): PF 8. JSON também marca PVO 1 como auto_cost.
  if(!spend("PF", 8)) return;
  if(!spend("PVO", 1)) return;

  state.effects.plasma = { target };

  // regra: substitui sanguenta no mesmo alvo
  if(state.effects.sanguenta && state.effects.sanguenta.target === target){
    state.effects.sanguenta = null;
  }

  log(`Plasma ativado em ${target} (+1d12, ignora resistências).`);
  renderEffects();
}

function nextRound(){
  state.round++;

  // Reset de ações por rodada (seu sistema: PVO/PVD)
  state.pvo = MAX.pvo;
  state.pvd = MAX.pvd;

  if(state.effects.sanguenta){
    state.effects.sanguenta.rounds--;
    if(state.effects.sanguenta.rounds <= 0){
      log("Arma Sanguenta expirou.");
      state.effects.sanguenta = null;
    }
  }
  render();
  log("Nova rodada: PVO/PVD restaurados.");
}

function startTurn(){
  // Sem aumentar rodada: só restaura ações (útil quando você quer usar "rodada" como contador global)
  state.pvo = MAX.pvo;
  state.pvd = MAX.pvd;
  render();
  log("Turno iniciado: PVO/PVD restaurados.");
}

// ------------------------------
// Damage modifiers (Essência + efeitos por alvo)
// ------------------------------
function addDiceToFirstDiceTerm(expr, bonusDice){
  if(!bonusDice || bonusDice <= 0) return expr;
  return expr.replace(/(\d+)d(\d+)/, (m,a,b) => `${Number(a) + bonusDice}d${b}`);
}

function damageFor(target, baseExpr){
  let totalExpr = baseExpr;
  const notes = [];

  // bônus global de dano (mantive como 2 para não mudar o que você já estava usando)
  totalExpr = addDiceToFirstDiceTerm(totalExpr, state.globalDamageBonusDice);
  if(state.globalDamageBonusDice) notes.push(`Essência +${state.globalDamageBonusDice} dado(s)`);

  if(state.effects.sanguenta && state.effects.sanguenta.target === target){
    totalExpr += "+1d8";
    notes.push("Sanguenta");
  }
  if(state.effects.plasma && state.effects.plasma.target === target){
    totalExpr += "+1d12";
    notes.push("Plasma (ignora resistências)");
  }

  const res = evalExpr(totalExpr, ctx);
  log(`${res.detail}${notes.length ? " | " + notes.join(", ") : ""}`);
}

// ------------------------------
// UI rendering
// ------------------------------
function renderTracks(){
  // show current/max
  document.getElementById("ps").textContent = `${state.ps}/${MAX.ps}`;
  document.getElementById("pvo").textContent = `${state.pvo}/${MAX.pvo}`;
  document.getElementById("pvd").textContent = `${state.pvd}/${MAX.pvd}`;
  document.getElementById("pf").textContent = `${state.pf}/${MAX.pf}`;
  const roundEl = document.getElementById("round");
  if(roundEl) roundEl.textContent = `R${state.round}`;

}

function renderEffects(){
  const ul = document.getElementById("effects");
  ul.innerHTML = "";

  const add = (txt) => {
    const li = document.createElement("li");
    li.textContent = txt;
    ul.appendChild(li);
  };

  if(state.effects.sanguenta){
    add(`Sanguenta em ${state.effects.sanguenta.target} (${state.effects.sanguenta.rounds} rodadas)`);
  }
  if(state.effects.plasma){
    add(`Plasma em ${state.effects.plasma.target} (∞)`);
  }
  if(!state.effects.sanguenta && !state.effects.plasma){
    add("—");
  }
}

function targetKeyFromActionName(name){
  const n = (name || "").toLowerCase();
  if(n.includes("corpo a corpo")) return "melee";
  if(n.includes("espada")) return "sword";
  if(n.includes("arma pesada")) return "heavy";
  return "generic";
}

function renderCombatActions(){
  const root = document.getElementById("combatActions");
  root.innerHTML = "";

  const list = character?.abilities?.combat_tree || [];
  list.forEach(action => {
    const wrap = document.createElement("div");
    wrap.className = "action";

    const title = document.createElement("div");
    title.className = "title";
    const icon = document.createElement("span");
    icon.className = "icon";
    icon.textContent = action.icon || "⚔️";
    const name = document.createElement("span");
    name.textContent = action.name || "Ação";
    title.appendChild(icon);
    title.appendChild(name);

    // show auto cost badge
    const cost = action.auto_cost || {};
    const costParts = Object.entries(cost).map(([k,v]) => `${k} -${v}`);
    if(costParts.length){
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = `Custo: ${costParts.join(" / ")}`;
      title.appendChild(badge);
    }

    wrap.appendChild(title);

    const rollsRow = document.createElement("div");
    rollsRow.className = "rolls";

    // Optional weapon base damage input
    let weaponInput = null;
    if(action.ui && action.ui.weapon_damage_input){
      weaponInput = document.createElement("input");
      weaponInput.type = "text";
      weaponInput.value = action.ui.weapon_damage_default || "2d6";
      weaponInput.title = "Dano base da arma (ex: 2d6)";
      rollsRow.appendChild(weaponInput);
    }

    const targetKey = targetKeyFromActionName(action.name);

    // Render roll buttons
    const rolls = action.rolls || [];
    rolls.forEach(r => {
      if(!r.expr) return; // skip empty
      const btn = document.createElement("button");
      btn.textContent = r.label || "Rolar";
      btn.onclick = () => {
        // Spend cost only when rolling "Teste" (ação principal)
        if((r.label || "").toLowerCase().includes("teste")){
          for(const [k,v] of Object.entries(cost)){
            if(!spend(k, v)) { render(); return; }
          }
        }
        // For damage, apply modifiers
        if((r.label || "").toLowerCase().includes("dano")){
          damageFor(targetKey, r.expr);
        } else {
          const res = evalExpr(r.expr, ctx);
          log(`${action.name} — ${r.label}: ${res.detail}`);
        }
        render();
      };
      rollsRow.appendChild(btn);
    });

    // If this action expects weapon damage input but has no damage roll, create one
    if(action.ui && action.ui.weapon_damage_input){
      const dmgBtn = document.createElement("button");
      dmgBtn.textContent = "Dano";
      dmgBtn.onclick = () => {
        const base = (weaponInput?.value || "2d6").trim() || "2d6";
        const expr = `${base} + @attributes.Força.quarter`;
        damageFor(targetKey, expr);
        render();
      };
      rollsRow.appendChild(dmgBtn);
    }

    wrap.appendChild(rollsRow);
    root.appendChild(wrap);
  });
}

function render(){
  renderTracks();
  renderEffects();
  saveState();
}

// ------------------------------
// Init
// ------------------------------
async function init(){
  character = await fetch("data/character.json").then(r => r.json());
  ctx = buildContextFromCharacter(character);

  // Etapa 8 — Perícias
  await loadSkillsCatalog();
  skillIndex = buildSkillIndexFromCharacter(character);

  // Set name + luck
  document.getElementById("charName").textContent = character?.meta?.name || "Personagem";
  document.title = character?.meta?.name || document.title;
  document.getElementById("luck").textContent = character?.stats?.luck ?? "—";

  // Load MAX from character tracks
  const tracks = character?.stats?.tracks || {};
  MAX = {
    ps: tracks.PS?.max ?? 100,
    pf: tracks.PF?.max ?? 100,
    pvo: tracks.PVO?.max ?? 2,
    pvd: tracks.PVD?.max ?? 3
  };

  // Default current from character
  state.ps = tracks.PS?.current ?? MAX.ps;
  state.pf = tracks.PF?.current ?? MAX.pf;
  state.pvo = tracks.PVO?.current ?? MAX.pvo;
  state.pvd = tracks.PVD?.current ?? MAX.pvd;

  // Restore save if exists
  loadState();

  // Hook controls
  const startTurnBtn = document.getElementById("startTurn");
  if(startTurnBtn){
    startTurnBtn.onclick = () => { startTurn(); };
  }
  document.getElementById("newRound").onclick = () => { nextRound(); };
  document.getElementById("newCombat").onclick = () => {
    state.round = 1;
    state.pvo = MAX.pvo;
    state.pvd = MAX.pvd;
    state.effects = { sanguenta: null, plasma: null };
    log("Novo combate.");
    render();
  };
  document.getElementById("resetAll").onclick = () => {
    resetTracks();
    state.round = 1;
    state.effects = { sanguenta: null, plasma: null };
    state.logLines = [];
    log("Reset total.");
    render();
  };

  // Sorte
  document.getElementById("roll_luck").onclick = () => {
    const mod = Number(character?.stats?.luck ?? 0);
    const mode = (document.getElementById("luckMode")?.value || "normal");
    const res = rollD20WithMode(mod, mode);
    log(`Sorte: ${res.detail}`);
    render();
  };

  // Habilidades rápidas (Sanguenta / Plasma)
  document.getElementById("use_sanguenta").onclick = () => {
    const t = document.getElementById("target_sanguenta").value;
    applySanguenta(t);
    render();
  };
  document.getElementById("toggle_plasma").onclick = () => {
    const t = document.getElementById("target_plasma").value;
    togglePlasma(t);
    render();
  };

  // Etapa 8 — UI de Perícias
  initSkillsUi();

  renderCombatActions();
  render();
  renderLog();

  // Expose minimal hooks for UX layer (ui enhancements without mixing with game logic)
  window.__tats = { state, MAX, character, saveState, renderLog, render, log };
  document.dispatchEvent(new CustomEvent("tats-ready"));

}

init();
