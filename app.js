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
  if(autoEl) setAutoMagicAdv(!!autoEl.checked);
}

function applyStateToSkillUi(){
  const modeEl = document.getElementById("skillMode");
  const autoEl = document.getElementById("autoMagicAdv");
  if(modeEl) modeEl.value = state?.ui?.skillMode || "normal";
  if(autoEl) autoEl.checked = !!state?.ui?.autoMagicAdv;
  const b = document.getElementById('essenceAutoMagicAdv');
  if(b) b.checked = !!state?.ui?.autoMagicAdv;
}


// ------------------------------
// Resultado global (persistente)
// - Mostra 1 resultado por vez
// - Só fecha no X (ou ESC)
// ------------------------------
// ------------------------------
let __resultOverlayEl = null;
let __resultOverlayContentEl = null;
let __resultOverlayCloseEl = null;
let __resultOverlayKeyBound = false;

/**
 * Resultado global (caixa no canto)
 * Fix: às vezes o overlay era inicializado antes do DOM estar pronto e ficava "preso" em null.
 * Aqui eu re-consulto os elementos sempre que precisar e só marco listeners por elemento.
 */
function initResultOverlay(){
  __resultOverlayEl = document.getElementById('resultOverlay');
  __resultOverlayContentEl = document.getElementById('resultOverlayContent');
  __resultOverlayCloseEl = document.getElementById('resultOverlayClose');

  // Bind do botão fechar (uma vez por elemento)
  if(__resultOverlayCloseEl && !__resultOverlayCloseEl.dataset.bound){
    __resultOverlayCloseEl.dataset.bound = '1';
    __resultOverlayCloseEl.addEventListener('click', () => hideResultOverlay());
  }

  // Bind do ESC (uma vez global)
  if(!__resultOverlayKeyBound){
    __resultOverlayKeyBound = true;
    window.addEventListener('keydown', (e) => {
      if(e.key === 'Escape' && __resultOverlayEl && !__resultOverlayEl.hidden){
        hideResultOverlay();
      }
    });
  }
}

function hideResultOverlay(){
  // sempre revalida refs
  initResultOverlay();
  if(!__resultOverlayEl) return;
  __resultOverlayEl.hidden = true;
  if(__resultOverlayContentEl) __resultOverlayContentEl.innerHTML = '';
}

function showResultOverlay(payload){
  // sempre revalida refs (evita falha intermitente)
  initResultOverlay();
  if(!__resultOverlayEl || !__resultOverlayContentEl) return;

  const title = String(payload?.title || 'Resultado');
  const meta = String(payload?.meta || '').trim();
  const big = String(payload?.big || '').trim();
  const detail = String(payload?.detail || '').trim();

  // Limpa e reconstrói sem HTML inseguro
  __resultOverlayContentEl.innerHTML = '';

  const titleEl = document.createElement('div');
  titleEl.className = 'resultTitle';
  titleEl.textContent = title;
  __resultOverlayContentEl.appendChild(titleEl);

  if(meta){
    const metaEl = document.createElement('div');
    metaEl.className = 'resultMeta';
    metaEl.textContent = meta;
    __resultOverlayContentEl.appendChild(metaEl);
  }

  if(big){
    const bigEl = document.createElement('div');
    bigEl.className = 'resultBig';
    bigEl.textContent = big;
    __resultOverlayContentEl.appendChild(bigEl);
  }

  if(detail){
    const dEl = document.createElement('div');
    dEl.className = 'resultDetail';
    dEl.textContent = detail;
    __resultOverlayContentEl.appendChild(dEl);
  }

  __resultOverlayEl.hidden = false;
}


// Etapa 9 — helpers de UI (resultado destacado + animação + atalhos)
let skillResultTimer = null;
let combatResultTimer = null;
let skillsHotkeysBound = false;

function skillKey(attrCode, skillName){
  return `${String(attrCode||'').toUpperCase()}:${normKey(skillName)}`;
}

function modeLabel(mode){
  if(mode === 'adv') return 'Vantagem';
  if(mode === 'dis') return 'Desvantagem';
  return 'Normal';
}

function showSkillResultBanner(payload){
  // Um único resultado na tela (overlay global).
  if(!payload) return;
  const mode = payload.mode ? `Modo: ${payload.mode}` : '';
  showResultOverlay({
    title: `Perícia — ${payload.skill || 'Teste'}`,
    meta: mode,
    big: `Total: ${payload.total}`,
    detail: payload.detail
  });
}



function showCombatResultBanner(payload){
  // Um único resultado na tela (overlay global).
  if(!payload) return;
  const label = payload.label ? ` — ${payload.label}` : '';
  showResultOverlay({
    title: `Combate — ${payload.name || 'Ação'}${label}`,
    meta: payload.target ? `Alvo: ${payload.target}` : '',
    big: (payload.total !== undefined && payload.total !== null) ? `Total: ${payload.total}` : '',
    detail: payload.detail || ''
  });
}


function animateSkillCard(cardEl){
  if(!cardEl) return;
  // remove destaque de outros
  document.querySelectorAll('.skillCard.is-last').forEach(n => n.classList.remove('is-last'));
  cardEl.classList.add('is-last');
  // shimmer
  cardEl.classList.remove('is-rolling');
  // força reflow
  void cardEl.offsetWidth;
  cardEl.classList.add('is-rolling');
  setTimeout(() => cardEl.classList.remove('is-rolling'), 650);
}

function rollSkillCheck(entry, modeOverride, cardEl){
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

  // Etapa 9 — resultado destacado + memorização do último resultado
  const key = skillKey(entry.attr, entry.name);
  const info = { total: res.total, mode, detail: res.detail, at: Date.now() };
  state.ui.lastSkillRolls = state.ui.lastSkillRolls || {};
  state.ui.lastSkillRolls[key] = info;
  state.ui.lastSkillResult = { name: entry.name, attr: entry.attr, total: res.total, mode, detail: res.detail };
  saveState();

  showSkillResultBanner(state.ui.lastSkillResult);
  animateSkillCard(cardEl);
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
        // Importante: o "Total" é a coluna Total da ficha. Ele já inclui atributo/nível e quaisquer bônus extras.
        // Quando você edita atributos, eu recalculo skillData.total usando (nível + 1/8 atributo + bonus_extra).
        const total = Number(skillData.total ?? 0);
        const lvl = Number(skillData.level ?? 0);
        const prof = !!skillData.proficient;
        const magic = !!s.magic;

        const k = skillKey(gCode, s.name);

        const card = document.createElement("div");
        card.className = "skillCard";
        card.tabIndex = 0;
        card.dataset.skillKey = k;
        card.dataset.skillName = s.name;
        card.dataset.skillAttr = gCode;
        card.dataset.skillTotal = String(total);
        card.dataset.skillMagic = magic ? "1" : "0";

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
        btnRoll.onclick = () => rollSkillCheck({ name: s.name, attr: gCode, total, magic }, null, card);

        const btnAdv = document.createElement("button");
        btnAdv.className = "btn btn-ghost btn-sm";
        btnAdv.textContent = "Adv";
        btnAdv.onclick = () => rollSkillCheck({ name: s.name, attr: gCode, total, magic }, "adv", card);

        const btnDis = document.createElement("button");
        btnDis.className = "btn btn-ghost btn-sm";
        btnDis.textContent = "Dis";
        btnDis.onclick = () => rollSkillCheck({ name: s.name, attr: gCode, total, magic }, "dis", card);

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

        // Último resultado (Etapa 9)
        const lastInfo = state?.ui?.lastSkillRolls ? state.ui.lastSkillRolls[k] : null;
        if(lastInfo){
          const last = document.createElement('div');
          last.className = 'skillLast';
          last.innerHTML = `Último: <b>${fmtNumber(Number(lastInfo.total))}</b> <span>(${modeLabel(lastInfo.mode)})</span>`;
          card.appendChild(last);
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

  // Mostra o último resultado, se existir
  if(state?.ui?.lastSkillResult){
    showSkillResultBanner(state.ui.lastSkillResult);
  }

  // Teclado dentro da lista (setas/enter)
  root.addEventListener('focusin', (e) => {
    const card = e.target?.closest?.('.skillCard');
    if(card?.dataset?.skillKey){
      state.ui.lastFocusedSkillKey = card.dataset.skillKey;
      saveState();
    }
  });

  root.addEventListener('keydown', (e) => {
    // Se o foco estiver em um botão/controle dentro do card, deixa o comportamento padrão
    const tgt = e.target;
    if(tgt && (tgt.tagName === 'BUTTON' || tgt.tagName === 'INPUT' || tgt.tagName === 'SELECT' || tgt.tagName === 'TEXTAREA')) return;

    const card = e.target?.closest?.('.skillCard');
    if(!card) return;
    const key = e.key;

    const cards = Array.from(root.querySelectorAll('.skillCard'));
    const idx = cards.indexOf(card);
    if(idx < 0) return;

    const detectCols = () => {
      if(cards.length < 2) return 1;
      const y0 = cards[0].getBoundingClientRect().top;
      for(let i=1;i<cards.length;i++){
        const y = cards[i].getBoundingClientRect().top;
        if(Math.abs(y - y0) > 2) return i; // primeira quebra de linha
      }
      return 1;
    };
    const cols = detectCols();
    const focusIndex = (ni) => {
      const j = Math.max(0, Math.min(cards.length-1, ni));
      const t = cards[j];
      if(!t) return;
      t.focus({ preventScroll: true });
      t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };

    // Enter/Space = rolar (modo atual)
    if(key === 'Enter' || key === ' '){
      e.preventDefault();
      const entry = {
        name: card.dataset.skillName,
        attr: card.dataset.skillAttr,
        total: Number(card.dataset.skillTotal || 0),
        magic: card.dataset.skillMagic === '1'
      };
      rollSkillCheck(entry, null, card);
      return;
    }

    // A = vantagem, D = desvantagem
    if(key === 'a' || key === 'A'){
      e.preventDefault();
      const entry = {
        name: card.dataset.skillName,
        attr: card.dataset.skillAttr,
        total: Number(card.dataset.skillTotal || 0),
        magic: card.dataset.skillMagic === '1'
      };
      rollSkillCheck(entry, 'adv', card);
      return;
    }
    if(key === 'd' || key === 'D'){
      e.preventDefault();
      const entry = {
        name: card.dataset.skillName,
        attr: card.dataset.skillAttr,
        total: Number(card.dataset.skillTotal || 0),
        magic: card.dataset.skillMagic === '1'
      };
      rollSkillCheck(entry, 'dis', card);
      return;
    }

    // Navegação por setas
    if(key === 'ArrowRight'){ e.preventDefault(); focusIndex(idx + 1); return; }
    if(key === 'ArrowLeft'){ e.preventDefault(); focusIndex(idx - 1); return; }
    if(key === 'ArrowDown'){ e.preventDefault(); focusIndex(idx + cols); return; }
    if(key === 'ArrowUp'){ e.preventDefault(); focusIndex(idx - cols); return; }
    if(key === 'Home'){ e.preventDefault(); focusIndex(0); return; }
    if(key === 'End'){ e.preventDefault(); focusIndex(cards.length-1); return; }
  });

  // Teclas globais (/, Esc) quando a aba Perícias estiver ativa
  if(!skillsHotkeysBound){
    skillsHotkeysBound = true;
    document.addEventListener('keydown', (e) => {
      const skillsPanel = document.getElementById('tab-skills');
      if(!skillsPanel || !skillsPanel.classList.contains('active')) return;

      const t = e.target;
      const isTyping = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

      if(e.key === '/' && !isTyping){
        e.preventDefault();
        const se = document.getElementById('skillSearch');
        if(se){ se.focus(); se.select?.(); }
        return;
      }

      if(e.key === 'Escape'){
        const se = document.getElementById('skillSearch');
        if(se && se.value){
          e.preventDefault();
          se.value = '';
          renderSkillsTab();
          return;
        }
      }
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

  // Ajuste importante:
  // - "total" vem da coluna Total da perícia (pode incluir bônus extras além do atributo/nível).
  // - Para permitir editar atributos e ainda assim respeitar esses bônus, calculo um "bonus_extra"
  //   (diferença entre Total e [nível + 1/8 do atributo] na ficha base).
  const getAttrObjByCodeLocal = (code) => {
    const name = ATTR_LABEL[String(code || "").toUpperCase()] || String(code || "");
    return (attributes?.[name] || attributes?.[name.toLowerCase()] || attributes?.[deaccent(name)] || null);
  };

  Object.values(allGroups).forEach(arr => {
    (arr || []).forEach(s => {
      const a = getAttrObjByCodeLocal(s.attribute);
      const baseEighth = Number(a?.eighth ?? (Number(a?.value) ? Math.floor(Number(a.value) / 8) : 0));
      const lvl = Number(s.level ?? 0);
      const hasTotal = (s.total !== undefined && s.total !== null && String(s.total).trim() !== "");
      const base = lvl + baseEighth;
      const total = hasTotal ? Number(s.total) : base;
      // bônus fixo que não depende do atributo (ex: passivas, equipamentos, etc.)
      s.bonus_extra = Number.isFinite(total) ? (total - base) : 0;
      if(!Number.isFinite(s.bonus_extra)) s.bonus_extra = 0;
      // normaliza total
      s.total = Number.isFinite(total) ? total : base;
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
// Atributos editáveis (override em runtime)
// - Guarda overrides em state.ui.attrOverrides
// - Recalcula 1/2, 1/4, 1/8 e atualiza perícias/rolagens automaticamente
// ------------------------------
function applyAttributeOverridesToCtx(){
  const ov = state?.ui?.attrOverrides;
  if(!ctx || !ctx.attributes || !ov || typeof ov !== 'object') return;

  Object.keys(ov).forEach(key => {
    const raw = ov[key];
    const v = Number(raw);
    if(!Number.isFinite(v)) return;

    // tenta localizar o atributo na tabela de aliases
    const a = ctx.attributes[key] || ctx.attributes[String(key).toLowerCase()] || ctx.attributes[deaccent(String(key))] || null;
    if(!a) return;

    const val = Math.max(0, Math.round(v));
    a.value = val;
    a.half = Math.floor(val / 2);
    a.quarter = Math.floor(val / 4);
    a.eighth = Math.floor(val / 8);
  });

  // Recalcula totais das perícias a partir do atributo editado:
  // Total = nível + (1/8 do atributo) + bonus_extra
  try{ recalcSkillTotalsFromAttributes(); }catch(_){ }
}

function recalcSkillTotalsFromAttributes(){
  if(!ctx || !ctx.skills) return;
  Object.keys(ctx.skills).forEach(attrCode => {
    const bucket = ctx.skills[attrCode];
    if(!bucket || typeof bucket !== 'object') return;
    const a = getAttrObjByCode(attrCode);
    const baseEighth = Number(a?.eighth ?? 0);
    Object.values(bucket).forEach(s => {
      if(!s || typeof s !== 'object') return;
      const lvl = Number(s.level ?? 0);
      const extra = Number(s.bonus_extra ?? 0);
      const total = lvl + baseEighth + (Number.isFinite(extra) ? extra : 0);
      s.total = Number.isFinite(total) ? total : (lvl + baseEighth);
    });
  });
}

function rebuildCtx(){
  ctx = buildContextFromCharacter(character);

  // Aplica defaults de essência do personagem (se existirem) na 1ª execução
  const dEss = character?.notes?.essence_levels_default;
  if(dEss && typeof dEss === 'object'){
    // só seta se o save não trouxe algo explícito
    if(!state.essence || typeof state.essence !== 'object') state.essence = {};
    state.essence.ev = clampInt(state.essence.ev ?? dEss.ev, 0, 5);
    state.essence.off = clampInt(state.essence.off ?? dEss.off, 0, 5);
    state.essence.def = clampInt(state.essence.def ?? dEss.def, 0, 5);
    state.essence.apt = clampInt(state.essence.apt ?? dEss.apt, 0, 5);
  }

  applyAttributeOverridesToCtx();
}

// PV extra por passiva de Essência (OF 2): +1 PV máximo
function syncPvFromEssence(){
  const e = getEssence();
  const extra = (e.off >= 2) ? 1 : 0;

  const baseTotal = (BASE_MAX.pvo || 0) + (BASE_MAX.pvd || 0);
  const total = Math.max(0, baseTotal + extra);

  // regra: divide por 2; a menor parte é ataque (PVO) e o resto é reação (PVD)
  const pvoMax = Math.floor(total / 2);
  const pvdMax = total - pvoMax;

  const prevPvo = MAX.pvo, prevPvd = MAX.pvd;

  MAX.pvo = pvoMax;
  MAX.pvd = pvdMax;

  // se estava "cheio" antes, promove para o novo teto automaticamente
  if(state.pvo === prevPvo && pvoMax > prevPvo) state.pvo = pvoMax;
  if(state.pvd === prevPvd && pvdMax > prevPvd) state.pvd = pvdMax;

  // clamp (se diminuiu por algum motivo)
  state.pvo = Math.min(state.pvo, MAX.pvo);
  state.pvd = Math.min(state.pvd, MAX.pvd);
}


// ------------------------------
// State + persistence
// ------------------------------
// Defaults (fallback). Os valores reais vêm do data/character.json (stats.tracks).
let BASE_MAX = { ps: 100, pvo: 3, pvd: 4, pf: 100 };
let MAX = { ps: 100, pvo: 3, pvd: 4, pf: 100 };

let state = {
  ps: 100,
  pvo: 3,
  pvd: 4,
  pf: 100,
  round: 1,
  // configurable (kept as 2 to match your current behavior)
  globalDamageBonusDice: 3,

  // Shadowheart — alvo infernal + arsenal
  infernalTarget: false,
  infernalExtraDamageDie: true,
  weapon: {
    currentId: "personificacao",
    pvPool: "pvo", // "pvo" (ataque) ou "pvd" (reação)
    modes: {}
  },

  // Etapa 10 — níveis de Essência (EV/Of/Def/Apt) e preferências
  // Defaults: Tatsumaki (EV3, OF2, DEF1, APT1)
  essence: {
    ev: 3,
    off: 2,
    def: 2,
    apt: 1,
    stackMode: "literal", // conservative | literal
    defPassiveRes: ""
  },

  effects: {
    sanguenta: null, // {target, rounds}
    plasma: null,    // {target, rounds, resNotified}
    aura: null       // {rounds, dice}
  },

  logLines: [],

  ui: {
    passivesAlwaysOn: true,
    skillMode: "normal",
    autoMagicAdv: true,
    // Etapa 16 — Biblioteca de habilidades
    abilitySearch: "",
    abilityTypeFilter: "all", // all | Ativa | Passiva
    abilityAutoSpend: true,
    abilityDamageTarget: "sword", // generic | melee | sword | heavy
    pvCostMap: {}, // { [abilityName]: 'PVO'|'PVD' }
    abilityRollOverrides: {}, // { [abilityName]: { [rollLabel]: expr } }
    // Etapa 9 — guarda últimos resultados (por perícia) e último destaque
    lastSkillRolls: {},
    lastSkillResult: null,
    lastFocusedSkillKey: null
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
      essence: state.essence,
      globalDamageBonusDice: state.globalDamageBonusDice,
      infernalTarget: state.infernalTarget,
      infernalExtraDamageDie: state.infernalExtraDamageDie,
      weapon: state.weapon,
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
    // garante chaves novas
    if(!state.effects || typeof state.effects !== 'object') state.effects = { sanguenta: null, plasma: null, aura: null };
    if(!('aura' in state.effects)) state.effects.aura = null;
    if(!('sanguenta' in state.effects)) state.effects.sanguenta = null;
    if(!('plasma' in state.effects)) state.effects.plasma = null;

    state.infernalTarget = s.infernalTarget ?? state.infernalTarget;
    state.infernalExtraDamageDie = s.infernalExtraDamageDie ?? state.infernalExtraDamageDie;
    state.weapon = s.weapon ?? state.weapon;
    if(!state.weapon || typeof state.weapon !== 'object') state.weapon = { currentId: 'personificacao', pvPool: 'pvo', modes: {} };
    if(!state.weapon.modes || typeof state.weapon.modes !== 'object') state.weapon.modes = {};

    if(s.essence && typeof s.essence === 'object'){
      state.essence = { ...state.essence, ...s.essence };
    }
    state.globalDamageBonusDice = (typeof s.globalDamageBonusDice === "number") ? s.globalDamageBonusDice : state.globalDamageBonusDice;
    state.logLines = Array.isArray(s.logLines) ? s.logLines : [];
    if(s.ui && typeof s.ui === 'object'){
      state.ui = { ...state.ui, ...s.ui };
      // garante forma
      if(!state.ui.lastSkillRolls || typeof state.ui.lastSkillRolls !== 'object') state.ui.lastSkillRolls = {};
      if(!state.ui.pvCostMap || typeof state.ui.pvCostMap !== 'object') state.ui.pvCostMap = {};
      if(!state.ui.abilityRollOverrides || typeof state.ui.abilityRollOverrides !== 'object') state.ui.abilityRollOverrides = {};
      if(!Array.isArray(state.ui.favorites)) state.ui.favorites = [];
      if(!state.ui.weaponBases || typeof state.ui.weaponBases !== 'object') state.ui.weaponBases = {};
      if(typeof state.ui._favSeeded !== 'boolean') state.ui._favSeeded = false;
    }
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

function fullRestoreTracks(){
  // Restaura recursos principais sem mexer em buffs/efeitos.
  state.ps = MAX.ps;
  state.pf = MAX.pf;
  state.pvo = MAX.pvo;
  state.pvd = MAX.pvd;
  log(`Full restore: PS ${state.ps}/${MAX.ps} | PF ${state.pf}/${MAX.pf} | PV ${state.pvo+state.pvd}/${MAX.pvo+MAX.pvd}`);
  try{ window.__sfx?.play?.('reset'); }catch(_){/* ignore */}
  render();
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
// Essência (Etapa 10)
// ------------------------------
function clampInt(n, min, max){
  const v = Number(n);
  if(!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function getEssence(){
  const e = state.essence || {};
  return {
    ev: clampInt(e.ev, 0, 5),
    off: clampInt(e.off, 0, 5),
    def: clampInt(e.def, 0, 5),
    apt: clampInt(e.apt, 0, 5),
    stackMode: (e.stackMode === 'conservative') ? 'conservative' : 'literal',
    defPassiveRes: String(e.defPassiveRes || '')
  };
}

function computeEssenceDamageDice(){
  const e = getEssence();

  // EV 3: +1 dado (todos os ataques)
  // EV 5: +1 dado (qualquer ataque físico ou mágico)
  const evDice = (e.ev >= 3 ? 1 : 0) + (e.ev >= 5 ? 1 : 0);

  // Ofensiva
  // OF 1: +1 dado (todos os ataques)
  // OF 2: +1 dado extra (todos os ataques)
  // OF 5: +2 dados extras (passivo)
  let offDice = 0;
  if(e.off >= 1) offDice += 1;
  if(e.off >= 2) offDice += 1;
  if(e.off >= 5) offDice += 2;

  const literal = evDice + offDice;
  const conservative = Math.max(evDice, offDice);
  const recommended = (e.stackMode === 'literal') ? literal : conservative;

  return { evDice, offDice, literal, conservative, recommended };
}


function syncPassiveEssenceRules(){
  // Regra: EV, Ofensiva e Aptidão são sempre passivas (sempre ativas).
  // Isso implica empilhar EV + Ofensiva no bônus global de dano.
  const e = getEssence();
  if(!state.essence) state.essence = {};
  // Mantém o seletor, mas por padrão empilha (literal).
  state.essence.stackMode = (state.ui?.passivesAlwaysOn === false) ? e.stackMode : "literal";

  // PV extra (OF 2): +1 PV máximo
  syncPvFromEssence();

  // Bônus de dados global (quando passivas sempre ativas): soma EV + Ofensiva
  if(state.ui?.passivesAlwaysOn !== false){
    const diceInfo = computeEssenceDamageDice();
    const passiveDice = diceInfo.literal;
    if(Number.isFinite(passiveDice)) state.globalDamageBonusDice = clampInt(passiveDice, 0, 10);
  }

  // Aptidão 1: vantagem automática em perícias mágicas
  if(!state.ui) state.ui = {};
  if(e.apt >= 1) state.ui.autoMagicAdv = true;
}

function applyRecommendedDamageDice(){
  const r = computeEssenceDamageDice();
  state.globalDamageBonusDice = clampInt(r.recommended, 0, 10);
  log(`Essência: bônus global de dano definido para ${state.globalDamageBonusDice} dado(s) (${getEssence().stackMode}).`);
  render();
}

function setAutoMagicAdv(v){
  state.ui.autoMagicAdv = !!v;
  const a = document.getElementById('autoMagicAdv');
  const b = document.getElementById('essenceAutoMagicAdv');
  if(a) a.checked = !!v;
  if(b) b.checked = !!v;
  saveState();
}

function essenceHintEV(ev){
  if(ev >= 3) return 'EV 3+: +1 dado em todos os ataques.';
  return 'EV 1–2: foco em treinamento/conexão (sem bônus automático de dano).';
}

function essenceHintOFF(off){
  if(off >= 5) return 'OF 5: +2 dados (passivo) + habilidade ofensiva suprema.';
  if(off >= 2) return 'OF 2: +1 PV e +1 dado extra em todos os ataques.';
  if(off >= 1) return 'OF 1: +1 dado em qualquer ataque.';
  return 'OF 0: sem bônus ofensivo automático.';
}

function essenceHintDEF(def){
  if(def >= 5) return 'DEF 5: nova habilidade defensiva +2 dados na Aura.';
  if(def >= 4) return 'DEF 4: Aura de Aço (ignora efeitos que ignoram armadura por 1d4 turnos).';
  if(def >= 3) return 'DEF 3: resistência passiva permanente (escolha um tipo).';
  if(def >= 2) return 'DEF 2: Aura +1 turno e +2 dados de defesa.';
  if(def >= 1) return 'DEF 1: Aura Defensiva (2d6 + 1/4 Arcano) por 1d4 turnos.';
  return 'DEF 0: sem Aura Defensiva.';
}

function essenceHintAPT(apt){
  if(apt >= 5) return 'APT 5: -2 PF em custos e +2 dados de dano em habilidades.';
  if(apt >= 3) return 'APT 3: +2 em acertos mágicos e pode ignorar reação 2x por combate (1x/dia).';
  if(apt >= 2) return 'APT 2: habilidades custam -1 PF.';
  if(apt >= 1) return 'APT 1: vantagem em perícias relacionadas à magia.';
  return 'APT 0: sem bônus mágico automático.';
}

function auraParams(){
  const e = getEssence();
  // Base: 2d6 + Arcano/4, duração 1d4
  // DEF 2: +2 dados e +1 turno
  // DEF 5: +2 dados adicionais na Aura (além do que já tiver)
  const dice = 2 + (e.def >= 2 ? 2 : 0) + (e.def >= 5 ? 2 : 0);
  const durExpr = (e.def >= 2) ? '1d4+1' : '1d4';
  return { dice, durExpr, defLevel: e.def };
}

function activateAura(){
  const e = getEssence();
  if(e.def < 1){
    log('Aura Defensiva indisponível (precisa DEF 1+).');
    return;
  }

  const costEl = document.getElementById('auraCostPF');
  const cost = clampInt(costEl ? costEl.value : 3, 0, 99);
  if(!spend('PF', cost)) return;

  const p = auraParams();
  const dur = evalExpr(p.durExpr, ctx).total;
  state.effects.aura = { rounds: dur, dice: p.dice };
  log(`Aura Defensiva ativada por ${dur} rodada(s).`);
  render();
}

function rollAuraDefense(){
  if(!state.effects.aura){
    log('Aura Defensiva não está ativa.');
    return;
  }
  const dice = clampInt(state.effects.aura.dice ?? 2, 0, 20);
  const expr = `${dice}d6 + @attributes.Arcano.quarter`;
  const res = evalExpr(expr, ctx);
  log(`Aura Defensiva: ${res.detail}`);
  render();
}

function endAura(){
  if(!state.effects.aura){
    log('Aura Defensiva não está ativa.');
    return;
  }
  state.effects.aura = null;
  log('Aura Defensiva encerrada.');
  render();
}


function renderEssencePassives(){
  const root = document.getElementById('essencePassivesList');
  if(!root) return;
  root.innerHTML = '';

  const list = character?.notes?.essence_passives;
  if(!Array.isArray(list) || !list.length){
    root.innerHTML = '<div class="muted">Nenhuma passiva de essência cadastrada no arquivo do personagem.</div>';
    return;
  }

  const e = getEssence();
  const diceInfo = computeEssenceDamageDice();
  const applied = [];
  if(e.ev >= 3) applied.push('EV 3: +1 dado (dano)');
  if(e.off >= 1) applied.push('OF 1+: +1 dado (dano)');
  if(e.off >= 2) applied.push('OF 2: +1 dado (dano) +1 PV máximo');
  if(e.def >= 1) applied.push('DEF 1+: Aura Defensiva disponível');
  if(e.def >= 2) applied.push('DEF 2: Aura +1 turno e +2 dados');
  if(e.apt >= 1 && state.ui?.autoMagicAdv) applied.push('APT 1: auto vantagem (magia)');

  const top = document.createElement('div');
  top.className = 'muted';
  top.textContent = applied.length ? ('Aplicando automaticamente agora: ' + applied.join(' • ')) : 'Sem bônus automáticos aplicáveis no nível atual.';
  root.appendChild(top);

  const box = document.createElement('div');
  box.className = 'essPassiveGrid';

  list.forEach(it => {
    const card = document.createElement('div');
    card.className = 'essPassiveCard';

    const title = document.createElement('div');
    title.className = 'essPassiveTitle';
    title.textContent = `${it?.name || 'Passiva'} ${it?.stage ? `(${it.stage})` : ''}`.trim();

    const meta = document.createElement('div');
    meta.className = 'muted small';
    meta.textContent = String(it?.type || '').trim();

    const ul = document.createElement('ul');
    ul.className = 'essPassiveList';
    const eff = Array.isArray(it?.effects) ? it.effects : [];
    if(!eff.length){
      const li = document.createElement('li'); li.textContent = '—'; ul.appendChild(li);
    }else{
      eff.forEach(t => { const li=document.createElement('li'); li.textContent = String(t); ul.appendChild(li); });
    }

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(ul);
    box.appendChild(card);
  });

  root.appendChild(box);

  const footer = document.createElement('div');
  footer.className = 'muted small';
  footer.textContent = `Bônus global de dano (passivo): ${diceInfo.literal} dado(s) [EV=${diceInfo.evDice} + OF=${diceInfo.offDice}]`;
  root.appendChild(footer);
}
function renderEssenceUi(){
  // PV máximo pode depender de Essência (OF 2)
  syncPvFromEssence();

  if(state.ui?.passivesAlwaysOn !== false){
    syncPassiveEssenceRules();
  }
  const e = getEssence();
  // inputs
  const evEl = document.getElementById('essEV');
  const offEl = document.getElementById('essOFF');
  const defEl = document.getElementById('essDEF');
  const aptEl = document.getElementById('essAPT');
  const dmgEl = document.getElementById('globalDamageDice');
  const modeEl = document.getElementById('essenceStackMode');
  const recEl = document.getElementById('essenceRecommendedDice');

  if(evEl) evEl.value = String(e.ev);
  if(offEl) offEl.value = String(e.off);
  if(defEl) defEl.value = String(e.def);
  if(aptEl) aptEl.value = String(e.apt);
  if(dmgEl) dmgEl.value = String(clampInt(state.globalDamageBonusDice, 0, 10));
  if(modeEl) modeEl.value = e.stackMode;

  // Se passivas sempre ativas, travo o modo e o bônus global (evita conta errada)
  const passivesLocked = state.ui?.passivesAlwaysOn !== false;
  if(modeEl) modeEl.disabled = passivesLocked;
  if(dmgEl) dmgEl.disabled = passivesLocked;
  document.querySelectorAll('[data-stepper][data-ess="dmg"]').forEach(b => b.disabled = passivesLocked);

  // hints
  const evH = document.getElementById('essEVHint');
  const offH = document.getElementById('essOFFHint');
  const defH = document.getElementById('essDEFHint');
  const aptH = document.getElementById('essAPTHint');
  if(evH) evH.textContent = essenceHintEV(e.ev);
  if(offH) offH.textContent = essenceHintOFF(e.off);
  if(defH) defH.textContent = essenceHintDEF(e.def);
  if(aptH) aptH.textContent = essenceHintAPT(e.apt);

  // recommended
  const r = computeEssenceDamageDice();
  if(recEl) recEl.textContent = String(r.recommended);

  // sync auto magic adv
  const autoEl = document.getElementById('essenceAutoMagicAdv');
  if(autoEl) autoEl.checked = !!state.ui.autoMagicAdv;

  // DEF passive
  const resEl = document.getElementById('defPassiveRes');
  if(resEl){
    resEl.value = String(state.essence?.defPassiveRes || '');
    resEl.disabled = e.def < 3;
  }

  // Aura status
  const statusEl = document.getElementById('auraStatus');
  if(statusEl){
    const p = auraParams();
    const active = state.effects.aura;
    const formula = `${p.dice}d6 + 1/4 Arcano`;
    if(!active){
      statusEl.textContent = `Fórmula: ${formula} | Duração: ${p.durExpr}`;
    }else{
      statusEl.textContent = `ATIVA: ${active.rounds} rodada(s) | Fórmula: ${active.dice}d6 + 1/4 Arcano`;
    }
  }
}

async function loadEssenceBook(){
  const el = document.getElementById('essenceBook');
  if(!el) return;
  try{
    const txt = await fetch('data/essence_book.txt').then(r => r.text());
    el.textContent = String(txt || '').trim();
  }catch(_){
    el.textContent = 'Não consegui carregar o texto (arquivo ausente).';
  }
}

function initEssenceUi(){
  // steppers
  document.querySelectorAll('[data-stepper][data-ess]').forEach(btn => {
    btn.addEventListener('click', () => {
      const dir = btn.getAttribute('data-stepper');
      const key = btn.getAttribute('data-ess');

      const bump = (v) => (dir === 'inc' ? (v + 1) : (v - 1));

      if(key === 'dmg'){
        state.globalDamageBonusDice = clampInt(bump(Number(state.globalDamageBonusDice || 0)), 0, 10);
        log(`Bônus global de dano: ${state.globalDamageBonusDice} dado(s).`);
        render();
        return;
      }

      const e = getEssence();
      if(key === 'ev') state.essence.ev = clampInt(bump(e.ev), 0, 5);
      if(key === 'off') state.essence.off = clampInt(bump(e.off), 0, 5);
      if(key === 'def') state.essence.def = clampInt(bump(e.def), 0, 5);
      if(key === 'apt') state.essence.apt = clampInt(bump(e.apt), 0, 5);
      saveState();
      renderEssenceUi();
    });
  });

  const evEl = document.getElementById('essEV');
  const offEl = document.getElementById('essOFF');
  const defEl = document.getElementById('essDEF');
  const aptEl = document.getElementById('essAPT');
  const dmgEl = document.getElementById('globalDamageDice');
  const modeEl = document.getElementById('essenceStackMode');

  if(evEl) evEl.addEventListener('input', () => { state.essence.ev = clampInt(evEl.value, 0, 5); saveState(); renderEssenceUi(); });
  if(offEl) offEl.addEventListener('input', () => { state.essence.off = clampInt(offEl.value, 0, 5); saveState(); renderEssenceUi(); });
  if(defEl) defEl.addEventListener('input', () => { state.essence.def = clampInt(defEl.value, 0, 5); saveState(); renderEssenceUi(); });
  if(aptEl) aptEl.addEventListener('input', () => { state.essence.apt = clampInt(aptEl.value, 0, 5); saveState(); renderEssenceUi(); });
  if(dmgEl) dmgEl.addEventListener('input', () => {
    state.globalDamageBonusDice = clampInt(dmgEl.value, 0, 10);
    saveState();
    renderEssenceUi();
  });
  if(modeEl) modeEl.addEventListener('change', () => {
    state.essence.stackMode = (modeEl.value === 'literal') ? 'literal' : 'conservative';
    saveState();
    renderEssenceUi();
  });

  const applyBtn = document.getElementById('essenceApplyRecommended');
  if(applyBtn) applyBtn.addEventListener('click', () => applyRecommendedDamageDice());

  const autoEl = document.getElementById('essenceAutoMagicAdv');
  if(autoEl) autoEl.addEventListener('change', () => { setAutoMagicAdv(autoEl.checked); });

  const defResEl = document.getElementById('defPassiveRes');
  if(defResEl) defResEl.addEventListener('input', () => {
    state.essence.defPassiveRes = String(defResEl.value || '');
    saveState();
  });

  const auraAct = document.getElementById('auraActivate');
  if(auraAct) auraAct.addEventListener('click', () => activateAura());
  const auraRoll = document.getElementById('auraRoll');
  if(auraRoll) auraRoll.addEventListener('click', () => rollAuraDefense());
  const auraEnd = document.getElementById('auraEnd');
  if(auraEnd) auraEnd.addEventListener('click', () => endAura());

  renderEssenceUi();
}

// ------------------------------
// Etapa 16 — Biblioteca de habilidades (Exclusivas) + Equipamentos
// - Busca/filtro
// - Rolagem por habilidade
// - (Opcional) gastar custos ao rolar
// - Modal para decidir PV -> PVO/PVD quando a habilidade não especifica
// ------------------------------

let __pvModalPending = null; // { abilityName, amount, resolve }

function normRes(k){
  return String(k || '').replace(/\./g,'').trim().toUpperCase();
}

function parseExtraCostsFromContext(contextStr){
  const s = String(contextStr || '').trim();
  if(!s) return [];
  const low = s.toLowerCase();
  // Só tenta automatizar casos simples, tipo "e 8 P.F".
  // Se tiver alternativa/variável, deixa apenas como texto.
  if(!/^e\s+\d+/.test(low)) return [];
  if(low.includes('ou') || low.includes('por') || low.includes('todos') || low.includes('quantidade') || low.includes('consider')) return [];
  const out = [];
  const pushAll = (rx, res) => {
    let m;
    while((m = rx.exec(s)) !== null){
      const n = Number(m[1]);
      if(Number.isFinite(n) && n > 0) out.push({ resource: res, amount: n });
    }
  };
  pushAll(/(\d+)\s*P\.?\s*S/gi, 'PS');
  pushAll(/(\d+)\s*P\.?\s*F/gi, 'PF');
  pushAll(/(\d+)\s*P\.?\s*V/gi, 'PV');
  return out;
}

function formatAbilityCost(ability){
  const parts = [];
  const add = (res, amt, ctx) => {
    if(!res || !amt) return;
    const base = `${res} ${amt}`;
    const extra = ctx ? ` (${String(ctx).trim()})` : '';
    parts.push(base + extra);
  };
  (ability?.cost || []).forEach(c => {
    add(normRes(c.resource), Number(c.amount||0), c.context);
    // extras fixos do contexto (ex: "e 8 P.F")
    parseExtraCostsFromContext(c.context).forEach(e => add(normRes(e.resource), Number(e.amount||0), null));
  });
  if(ability?.auto_cost && typeof ability.auto_cost === 'object'){
    Object.entries(ability.auto_cost).forEach(([k,v]) => {
      const amt = Number(v||0);
      if(amt>0) parts.push(`${normRes(k)} ${amt}`);
    });
  }
  // remove duplicados simples (mantém ordem)
  const seen = new Set();
  const uniq = [];
  for(const p of parts){
    if(seen.has(p)) continue;
    seen.add(p);
    uniq.push(p);
  }
  return uniq.join(' • ');
}

function openPvModal(abilityName, amount, resolve){
  const modal = document.getElementById('pvModal');
  if(!modal) return;
  const text = document.getElementById('pvModalText');
  const remember = document.getElementById('pvRememberChoice');
  if(text) text.textContent = `Habilidade: ${abilityName} — custo: ${amount} PV. Escolha PVO (ataque) ou PVD (defesa).`;
  if(remember) remember.checked = true;
  __pvModalPending = { abilityName, amount, resolve };
  modal.hidden = false;
  try{ document.getElementById('pvChoosePVO')?.focus?.(); }catch(_){ }
}

function closePvModal(){
  const modal = document.getElementById('pvModal');
  if(modal) modal.hidden = true;
  __pvModalPending = null;
}

function wirePvModal(){
  const modal = document.getElementById('pvModal');
  if(!modal) return;
  const bPVO = document.getElementById('pvChoosePVO');
  const bPVD = document.getElementById('pvChoosePVD');
  const bCancel = document.getElementById('pvCancel');
  const remember = document.getElementById('pvRememberChoice');

  const resolve = (choice) => {
    const pending = __pvModalPending;
    if(!pending) return;
    const wantRemember = !!(remember && remember.checked);
    if(wantRemember){
      state.ui.pvCostMap = state.ui.pvCostMap || {};
      state.ui.pvCostMap[pending.abilityName] = choice;
      saveState();
    }
    try{ pending.resolve(choice); }catch(_){ }
    closePvModal();
  };

  bPVO?.addEventListener('click', () => resolve('PVO'));
  bPVD?.addEventListener('click', () => resolve('PVD'));
  bCancel?.addEventListener('click', () => { closePvModal(); });
  modal.querySelector('.modalBackdrop')?.addEventListener('click', (e) => {
    if(e.target && e.target.getAttribute('data-close')) closePvModal();
  });

  // ESC fecha
  window.addEventListener('keydown', (e) => {
    if(e.key === 'Escape' && !modal.hidden) closePvModal();
  });
}

function spendAbilityCosts(ability, after){
  const name = String(ability?.name || 'Habilidade');
  let todo = [];
  const push = (res, amt, origin) => {
    const a = Number(amt||0);
    if(!res || !Number.isFinite(a) || a <= 0) return;
    todo.push({ res: normRes(res), amt: a, origin });
  };

  (ability?.cost || []).forEach(c => {
    push(c.resource, c.amount, 'cost');
    parseExtraCostsFromContext(c.context).forEach(e => push(e.resource, e.amount, 'context'));
  });
  if(ability?.auto_cost && typeof ability.auto_cost === 'object'){
    Object.entries(ability.auto_cost).forEach(([k,v]) => push(k, v, 'auto_cost'));
  }

  // Evita cobrança duplicada quando o JSON traz o mesmo custo em "cost" e "auto_cost".
  // Ex.: PF 16 aparece duas vezes no Getsuga.
  {
    const seen = new Set();
    todo = todo.filter(it => {
      const key = `${it.res}:${it.amt}`;
      if(seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const spentLog = [];
  const step = (i) => {
    if(i >= todo.length){
      if(spentLog.length) log(`Custos pagos (${name}): ${spentLog.join(' • ')}`);
      saveState();
      after?.(true);
      return;
    }

    const it = todo[i];
    if(it.res === 'PV'){
      const pref = state.ui.pvCostMap?.[name];
      if(pref === 'PVO' || pref === 'PVD'){
        if(!spend(pref, it.amt)){
          window.__sfx?.play?.('error');
          render();
          after?.(false);
          return;
        }
        spentLog.push(`${pref} -${it.amt}`);
        step(i+1);
        return;
      }

      openPvModal(name, it.amt, (choice) => {
        const picked = (choice === 'PVD') ? 'PVD' : 'PVO';
        if(!spend(picked, it.amt)){
          window.__sfx?.play?.('error');
          render();
          after?.(false);
          return;
        }
        spentLog.push(`${picked} -${it.amt}`);
        step(i+1);
      });
      return;
    }

    if(!spend(it.res, it.amt)){
      window.__sfx?.play?.('error');
      render();
      after?.(false);
      return;
    }
    spentLog.push(`${it.res} -${it.amt}`);
    step(i+1);
  };

  step(0);
}

function getAbilitySfx(ability){
  const n = String(ability?.name || '').toLowerCase();
  if(n.includes('sang')) return 'blood';
  if(n.includes('plasma')) return 'plasma';
  if(n.includes('aura')) return 'aura';
  return 'click';
}

// ------------------------------
// Etapa 17 — Favoritos (Ações + Habilidades)
// ------------------------------
function tokenForCombatAction(action){
  return `ac:${normKey(action?.name||'')}`;
}

function tokenForAbility(ab){
  return `ab:${normKey(ab?.name||'')}`;
}

function ensureFavoritesShape(){
  state.ui = state.ui || {};
  if(!Array.isArray(state.ui.favorites)) state.ui.favorites = [];
  if(!state.ui.weaponBases || typeof state.ui.weaponBases !== 'object') state.ui.weaponBases = {};
}



function seedDefaultFavoritesIfNeeded(){
  // Só semear uma vez e apenas se o usuário ainda não configurou favoritos.
  // Isso deixa o site "pronto pra uso" (já vem com ações básicas na Quickbar).
  ensureFavoritesShape();
  if(state.ui._favSeeded) return;
  if(state.ui.favorites.length){
    state.ui._favSeeded = true;
    saveState();
    return;
  }

  const actions = Array.isArray(character?.abilities?.combat_tree) ? character.abilities.combat_tree : [];
  const defaults = [];
  // Preferir "Corpo a corpo" para testar soco logo de cara.
  const prefer = ['Corpo a corpo', 'Espada', 'Arma Pesada'];
  for(const key of prefer){
    const a = actions.find(x => String(x?.name||'').toLowerCase().includes(key.toLowerCase()));
    if(a) defaults.push(tokenForCombatAction(a));
  }
  if(!defaults.length && actions.length) defaults.push(...actions.slice(0,3).map(tokenForCombatAction));

  state.ui.favorites = defaults.slice(0, 6);
  state.ui._favSeeded = true;
  saveState();
}

function isFavoriteToken(token){
  ensureFavoritesShape();
  return state.ui.favorites.includes(String(token));
}

function toggleFavoriteToken(token){
  ensureFavoritesShape();
  const t = String(token);
  const idx = state.ui.favorites.indexOf(t);
  if(idx >= 0){
    state.ui.favorites.splice(idx, 1);
    try{ window.__sfx?.play?.('click'); }catch(_){ }
    toastQuick('Removido dos favoritos', t.startsWith('ac:') ? 'Ação de combate' : 'Habilidade');
  }else{
    // limita soft (evita UI explodir)
    if(state.ui.favorites.length >= 12){
      toastQuick('Limite de favoritos', 'Máximo recomendado: 12');
    }
    state.ui.favorites.push(t);
    try{ window.__sfx?.play?.('click'); }catch(_){ }
    toastQuick('Adicionado aos favoritos', t.startsWith('ac:') ? 'Ação de combate' : 'Habilidade');
  }
  saveState();
  renderQuickbar();
  updateFavoriteButtons();
  renderFavoritesManagerList();
}

// Aliases de compatibilidade (algumas telas usam os nomes sem sufixo)
function isFavorite(token){
  return isFavoriteToken(token);
}

function toggleFavorite(token){
  return toggleFavoriteToken(token);
}

// Regras de custo para ações de combate:
// - Por padrão, o custo (PVO/PVD/PS/PF) é pago apenas na rolagem de "Teste" (ou 1ª rolagem se não houver rótulo).
// - Rolagens de "Dano" NÃO consomem PV novamente (evita pagar duas vezes para o mesmo ataque).
function shouldSpendCombatCost(action, rollLabel, rollIdx){
  const lbl = String(rollLabel || '').toLowerCase();
  if(lbl.includes('dano')) return false;
  if(lbl.includes('teste')) return true;
  // fallback: só a primeira rolagem paga
  return Number(rollIdx) === 0;
}

function updateFavoriteButtons(){
  document.querySelectorAll('.favBtn[data-fav-token]').forEach(btn => {
    const token = btn.getAttribute('data-fav-token');
    const on = isFavoriteToken(token);
    btn.textContent = on ? '★' : '☆';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('is-on', on);
    btn.title = on ? 'Remover dos favoritos (Quickbar)' : 'Fixar nos favoritos (Quickbar)';
  });
}

function findCombatActionByToken(token){
  const slug = String(token||'').replace(/^ac:/,'');
  const list = Array.isArray(character?.abilities?.combat_tree) ? character.abilities.combat_tree : [];
  return list.find(a => normKey(a?.name||'') === slug) || null;
}

function findAbilityByToken(token){
  const slug = String(token||'').replace(/^ab:/,'');
  const list = Array.isArray(character?.abilities?.exclusive?.abilities) ? character.abilities.exclusive.abilities : [];
  return list.find(a => normKey(a?.name||'') === slug) || null;
}

function favoriteDisplayName(token){
  if(String(token).startsWith('ac:')){
    const a = findCombatActionByToken(token);
    return a?.name || 'Ação (não encontrada)';
  }
  if(String(token).startsWith('ab:')){
    const ab = findAbilityByToken(token);
    return ab?.name || 'Habilidade (não encontrada)';
  }
  return 'Item';
}

function seedDefaultFavoritesIfEmpty(){
  ensureFavoritesShape();
  if(state.ui._favSeeded) return;
  if(state.ui.favorites.length) { state.ui._favSeeded = true; saveState(); return; }
  const list = Array.isArray(character?.abilities?.combat_tree) ? character.abilities.combat_tree : [];
  // Por padrão, fixa as 3 primeiras ações de combate (pra você já conseguir testar o soco).
  state.ui.favorites = list.slice(0,3).map(tokenForCombatAction).filter(t => t !== 'ac:');
  state.ui._favSeeded = true;
  saveState();
}

function renderQuickbar(){
  const box = document.getElementById('quickbarList');
  if(!box) return;
  ensureFavoritesShape();
  box.innerHTML = '';

  const favs = Array.isArray(state.ui.favorites) ? state.ui.favorites.slice() : [];
  if(!favs.length){
    const empty = document.createElement('div');
    empty.className = 'quickbarEmpty';
    empty.innerHTML = `<div><strong>Sem favoritos ainda.</strong></div><div class="muted">Use a estrela ☆ nas ações de combate ou nas habilidades para fixar aqui.</div>`;
    box.appendChild(empty);
    return;
  }

  favs.forEach((token, idx) => {
    const isCombat = String(token).startsWith('ac:');
    const isAbility = String(token).startsWith('ab:');

    const item = document.createElement('div');
    item.className = 'quickbarItem';
    item.setAttribute('data-fav-token', token);

    const head = document.createElement('div');
    head.className = 'quickbarHead';

    const title = document.createElement('div');
    title.className = 'quickbarName';

    // Hotkey label
    const hk = document.createElement('span');
    hk.className = 'quickbarHotkey';
    hk.textContent = (idx < 9) ? String(idx+1) : '—';

    // Unpin
    const unpin = document.createElement('button');
    unpin.className = 'btn btn-ghost btn-sm quickbarUnpin';
    unpin.textContent = '✕';
    unpin.title = 'Remover dos favoritos';
    unpin.addEventListener('click', () => toggleFavoriteToken(token));

    const nameText = document.createElement('span');
    nameText.textContent = favoriteDisplayName(token);
    title.appendChild(nameText);

    const right = document.createElement('div');
    right.className = 'quickbarHeadRight';
    right.appendChild(hk);
    right.appendChild(unpin);

    head.appendChild(title);
    head.appendChild(right);
    item.appendChild(head);

    const rollsBox = document.createElement('div');
    rollsBox.className = 'quickbarRolls';

    if(isCombat){
      const action = findCombatActionByToken(token);
      if(!action){
        const missing = document.createElement('div');
        missing.className = 'muted';
        missing.textContent = 'Ação não encontrada no personagem.';
        rollsBox.appendChild(missing);
      }else{
        // Input de dano base (quando existir) — opção 1: sempre mostrar aqui também
        const damageInputCfg = action?.ui?.weapon_damage_input;
        let dmgInput = null;
        if(damageInputCfg){
          dmgInput = document.createElement('input');
          dmgInput.type = 'text';
          dmgInput.placeholder = String(damageInputCfg.placeholder || 'Ex: 2d10');
          const saved = String(state.ui.weaponBases[token] || '').trim();
          dmgInput.value = saved || String(damageInputCfg.default || '').trim();
          dmgInput.addEventListener('change', () => {
            ensureFavoritesShape();
            state.ui.weaponBases[token] = String(dmgInput.value || '').trim();
            saveState();
            toastQuick('Dano base salvo', state.ui.weaponBases[token] || '');
          });
          rollsBox.appendChild(dmgInput);
        }

        (action.rolls || []).forEach((r, ridx) => {
          const b = document.createElement('button');
          b.className = 'btn btn-sm';
          b.textContent = r.label;
          b.addEventListener('click', () => {
            // custo
            const cost = action?.auto_cost && typeof action.auto_cost === 'object' ? action.auto_cost : null;
            if(cost && shouldSpendCombatCost(action, label, ridx)){
              for(const [k,v] of Object.entries(cost)) if(!spend(k, v)){ try{ window.__sfx?.play?.('error'); }catch(_){}; render(); return; }
              log(`Custo pago (${action.name}): ${Object.entries(cost).map(([k,v])=>`${k} -${v}`).join(' • ')}`);
            }

            const label = String(r.label||'');
            if(label.toLowerCase().includes('dano')){
              // se existir input especial e o dano padrão for o da arma, preferir o input
              const targetKey = normKey(action?.name || 'combat');
              // se o roll já tem expr, usa ele
              const out = damageFor(targetKey, r.expr);
              showCombatResultBanner({ name: action.name, label: r.label, total: out?.total, detail: out?.detail });
              try{ window.__sfx?.play?.('hit'); }catch(_){ }
              render();
              return;
            }

            const res = evalExpr(r.expr, ctx);
            log(`Ação ${action.name} — ${r.label}: ${res.detail}`);
            showCombatResultBanner({ name: action.name, label: r.label, total: res.total, detail: res.detail });
            try{ window.__sfx?.play?.('roll'); }catch(_){ }
            render();
          });
          rollsBox.appendChild(b);
        });

        // Dano por input (se existir) — botão extra
        if(action?.ui?.weapon_damage_input){
          const b = document.createElement('button');
          b.className = 'btn btn-sm';
          b.textContent = 'Dano (base arma)';
          b.addEventListener('click', () => {
            const cfg = action.ui.weapon_damage_input;
            const base = String(state.ui.weaponBases[token] || '').trim() || String(cfg.default||'').trim();
            const extra = base ? `${base} + @attributes.Força.quarter` : `@attributes.Força.quarter`;
            const targetKey = normKey(action?.name || 'combat');
            const out = damageFor(targetKey, extra);
            showCombatResultBanner({ name: action.name, label: 'Dano', total: out?.total, detail: out?.detail });
            try{ window.__sfx?.play?.('hit'); }catch(_){ }
            render();
          });
          rollsBox.appendChild(b);
        }
      }
    }else if(isAbility){
      const ab = findAbilityByToken(token);
      if(!ab){
        const missing = document.createElement('div');
        missing.className = 'muted';
        missing.textContent = 'Habilidade não encontrada no personagem.';
        rollsBox.appendChild(missing);
      }else{
        const rolls = Array.isArray(ab?.rolls) ? ab.rolls : [];
        if(!rolls.length){
          const m = document.createElement('div');
          m.className = 'muted';
          m.textContent = 'Sem rolagens cadastradas (habilidade passiva).';
          rollsBox.appendChild(m);
        }else{
          rolls.forEach(r => {
            const label = String(r?.label || 'Rolagem');
            let expr = String(r?.expr || '').trim();
            // permite override salvo
            const saved = state.ui.abilityRollOverrides?.[ab.name]?.[label];
            if(saved) expr = String(saved).trim();

            let exprInput = null;
            if(!expr){
              exprInput = document.createElement('input');
              exprInput.type = 'text';
              exprInput.placeholder = 'Ex: 1d20 + 8';
              exprInput.value = String(saved || '').trim();
              exprInput.addEventListener('change', () => {
                state.ui.abilityRollOverrides = state.ui.abilityRollOverrides || {};
                state.ui.abilityRollOverrides[ab.name] = state.ui.abilityRollOverrides[ab.name] || {};
                state.ui.abilityRollOverrides[ab.name][label] = String(exprInput.value || '').trim();
                saveState();
                toastQuick('Rolagem salva', `${ab.name} • ${label}`);
              });
              rollsBox.appendChild(exprInput);
            }

            const b = document.createElement('button');
            b.className = 'btn btn-sm';
            b.textContent = label;

            const doRoll = () => {
              // pega expressão (do input ou do cadastro/override)
              let e = expr;
              if(!e && exprInput) e = String(exprInput.value || '').trim();
              if(!e){
                toastQuick('Sem expressão', `Defina a rolagem de “${label}”.`);
                return;
              }

              const isDamage = label.toLowerCase().includes('dano');
              if(isDamage){
                const target = String(state.ui.abilityDamageTarget || 'generic');
                const out = damageFor(target, e);
                log(`Habilidade ${ab.name} — ${label}: ${out?.detail || ''}`);
                showCombatResultBanner({ name: ab.name, label, total: out?.total, detail: out?.detail });
                try{ window.__sfx?.play?.('hit'); }catch(_){ }
                render();
                return;
              }

              const res = evalExpr(e, ctx);
              log(`Habilidade ${ab.name} — ${label}: ${res.detail}`);
              showCombatResultBanner({ name: ab.name, label, total: res.total, detail: res.detail });
              try{ window.__sfx?.play?.(getAbilitySfx(ab)); }catch(_){ }
              render();
            };

            b.addEventListener('click', () => {
              const shouldSpend = !!state.ui.abilityAutoSpend && String(ab?.type) === 'Ativa' && (ab?.cost?.length || ab?.auto_cost);
              if(shouldSpend){
                spendAbilityCosts(ab, (ok) => { if(ok) doRoll(); });
                return;
              }
              doRoll();
            });

            rollsBox.appendChild(b);
          });
        }
      }
    }else{
      const bad = document.createElement('div');
      bad.className = 'muted';
      bad.textContent = 'Token inválido.';
      rollsBox.appendChild(bad);
    }

    item.appendChild(rollsBox);
    box.appendChild(item);
  });
}

function openFavoritesManager(){
  const modal = document.getElementById('favModal');
  if(!modal) return;
  renderFavoritesManagerList();
  modal.hidden = false;
  try{ document.getElementById('favClose')?.focus?.(); }catch(_){ }
}

function closeFavoritesManager(){
  const modal = document.getElementById('favModal');
  if(modal) modal.hidden = true;
}

function moveFavorite(fromIdx, toIdx){
  ensureFavoritesShape();
  const arr = state.ui.favorites;
  if(fromIdx < 0 || fromIdx >= arr.length) return;
  if(toIdx < 0 || toIdx >= arr.length) return;
  const [it] = arr.splice(fromIdx, 1);
  arr.splice(toIdx, 0, it);
  saveState();
  renderQuickbar();
  renderFavoritesManagerList();
}

function renderFavoritesManagerList(){
  const listEl = document.getElementById('favModalList');
  if(!listEl) return;
  ensureFavoritesShape();
  listEl.innerHTML = '';

  const favs = state.ui.favorites || [];
  if(!favs.length){
    listEl.innerHTML = `<div class="muted">Sem favoritos.</div>`;
    return;
  }

  favs.forEach((token, i) => {
    const row = document.createElement('div');
    row.className = 'favRow';

    const name = document.createElement('div');
    name.className = 'favRowName';
    name.textContent = favoriteDisplayName(token);

    const tools = document.createElement('div');
    tools.className = 'favRowTools';

    const up = document.createElement('button');
    up.className = 'btn btn-ghost btn-sm';
    up.textContent = '↑';
    up.disabled = i == 0;
    up.addEventListener('click', () => moveFavorite(i, i-1));

    const down = document.createElement('button');
    down.className = 'btn btn-ghost btn-sm';
    down.textContent = '↓';
    down.disabled = i == favs.length-1;
    down.addEventListener('click', () => moveFavorite(i, i+1));

    const rm = document.createElement('button');
    rm.className = 'btn btn-ghost btn-sm';
    rm.textContent = 'Remover';
    rm.addEventListener('click', () => toggleFavoriteToken(token));

    tools.appendChild(up);
    tools.appendChild(down);
    tools.appendChild(rm);

    row.appendChild(name);
    row.appendChild(tools);
    listEl.appendChild(row);
  });
}

function initFavoritesUi(){
  ensureFavoritesShape();

  // botão de gerenciar
  const openBtn = document.getElementById('openFavManager');
  if(openBtn){
    openBtn.addEventListener('click', () => openFavoritesManager());
  }

  // modal
  const modal = document.getElementById('favModal');
  if(modal){
    modal.querySelector('.modalBackdrop')?.addEventListener('click', (e) => {
      if(e.target && e.target.getAttribute('data-close')) closeFavoritesManager();
    });
  }
  document.getElementById('favClose')?.addEventListener('click', () => closeFavoritesManager());

  // ESC
  // Render inicial
  renderQuickbar();
  updateFavoriteButtons();

  window.addEventListener('keydown', (e) => {
    const m = document.getElementById('favModal');
    if(e.key === 'Escape' && m && !m.hidden) closeFavoritesManager();
  });

  // Hotkeys 1-9: roda o primeiro botão do favorito
  window.addEventListener('keydown', (e) => {
    // não rouba teclas quando digitando
    const tag = String(document.activeElement?.tagName || '').toLowerCase();
    if(tag === 'input' || tag === 'textarea' || tag === 'select') return;

    const k = e.key;
    if(!/^[1-9]$/.test(k)) return;

    const idx = Number(k) - 1;
    ensureFavoritesShape();
    const token = state.ui.favorites?.[idx];
    if(!token) return;

    const item = document.querySelector(`.quickbarItem[data-fav-token="${CSS.escape(token)}"]`);
    if(!item) return;

    // preferência: "Teste" para combate, senão 1º botão
    const buttons = Array.from(item.querySelectorAll('button.btn')).filter(b => !b.classList.contains('quickbarUnpin'));
    if(!buttons.length) return;
    let chosen = buttons[0];
    const testBtn = buttons.find(b => String(b.textContent||'').toLowerCase().includes('teste'));
    if(testBtn) chosen = testBtn;
    chosen.click();
  });
}


function renderEquipment(){
  const box = document.getElementById('equipmentBox');
  if(!box) return;
  box.innerHTML = '';
  const eq = character?.abilities?.exclusive?.equipment;
  const sections = Array.isArray(eq?.sections) ? eq.sections : [];
  if(!sections.length){
    box.innerHTML = `<div class="muted">Sem equipamentos cadastrados.</div>`;
    return;
  }

  sections.forEach(sec => {
    const el = document.createElement('div');
    el.className = 'equipSection';
    const title = document.createElement('div');
    title.className = 'equipTitle';
    title.textContent = String(sec?.title || 'Item');
    const text = document.createElement('div');
    text.className = 'muted';
    const raw = String(sec?.text || '').trim();
    text.textContent = raw || '—';
    el.appendChild(title);
    el.appendChild(text);
    box.appendChild(el);
  });
}

function renderAbilitiesLibrary(){
  const root = document.getElementById('abilitiesList');
  if(!root) return;
  root.innerHTML = '';

  const list = Array.isArray(character?.abilities?.exclusive?.abilities) ? character.abilities.exclusive.abilities : [];
  if(!list.length){
    root.innerHTML = `<div class="muted">Sem habilidades exclusivas cadastradas.</div>`;
    return;
  }

  const q = String(state.ui.abilitySearch || '').trim().toLowerCase();
  const typeFilter = String(state.ui.abilityTypeFilter || 'all');

  const filtered = list.filter(ab => {
    if(typeFilter !== 'all' && String(ab?.type||'') !== typeFilter) return false;
    if(!q) return true;
    const blob = `${ab?.name||''}\n${ab?.text||''}`.toLowerCase();
    return blob.includes(q);
  });

  if(!filtered.length){
    root.innerHTML = `<div class="muted">Nada encontrado com esse filtro.</div>`;
    return;
  }

  filtered.forEach(ab => {
    const card = document.createElement('div');
    card.className = 'abilityCard';

    const header = document.createElement('div');
    header.className = 'abilityHeader';

    const left = document.createElement('div');
    left.className = 'abilityTitleRow';

    const name = document.createElement('div');
    name.className = 'abilityName';
    name.textContent = String(ab?.name || 'Habilidade');
    left.appendChild(name);

    const tBadge = document.createElement('span');
    tBadge.className = 'abilityTypeBadge';
    tBadge.textContent = String(ab?.type || '—');
    left.appendChild(tBadge);

    const costStr = formatAbilityCost(ab);
    if(costStr){
      const cBadge = document.createElement('span');
      cBadge.className = 'abilityCostBadge';
      cBadge.title = costStr;
      cBadge.textContent = `Custo: ${costStr}`;
      left.appendChild(cBadge);
    }

    header.appendChild(left);

    const right = document.createElement('div');
    right.className = 'abilityHeaderRight';

    const favToken = tokenForAbility(ab);
    const favBtn = document.createElement('button');
    favBtn.className = 'favBtn';
    favBtn.setAttribute('data-fav-token', favToken);
    favBtn.title = 'Fixar nos Favoritos (atalhos 1-9)';
    const paintFav = () => {
      const on = isFavorite(favToken);
      favBtn.textContent = on ? '★' : '☆';
      favBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    };
    paintFav();
    favBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleFavorite(favToken);
      paintFav();
    });

    right.appendChild(favBtn);
    header.appendChild(right);
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'abilityBody';
    const text = String(ab?.text || '').trim();
    if(text){
      text.split(/\n+/).forEach(par => {
        const p = document.createElement('p');
        p.textContent = String(par).trim();
        if(p.textContent) body.appendChild(p);
      });
    }

    const kv = Array.isArray(ab?.kv) ? ab.kv : [];
    if(kv.length){
      const kvBox = document.createElement('div');
      kvBox.className = 'abilityKv';
      kv.forEach(row => {
        const r = document.createElement('div');
        r.className = 'abilityKvRow';
        const k = document.createElement('div');
        k.className = 'abilityKvKey';
        k.textContent = String(row?.k || '').trim();
        const v = document.createElement('div');
        v.className = 'abilityKvVal';
        v.textContent = String(row?.v || '').trim();
        r.appendChild(k);
        r.appendChild(v);
        kvBox.appendChild(r);
      });
      body.appendChild(kvBox);
    }

    card.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'abilityActions';

    if(String(ab?.type) === 'Ativa'){
      const use = document.createElement('button');
      use.className = 'btn btn-sm';
      use.textContent = 'Usar (gastar custo)';
      use.addEventListener('click', () => {
        window.__sfx?.play?.(getAbilitySfx(ab));
        spendAbilityCosts(ab, (ok) => {
          if(!ok) return;
          log(`Habilidade usada: ${ab.name}`);
          render();
        });
      });
      actions.appendChild(use);
    }

    const rolls = Array.isArray(ab?.rolls) ? ab.rolls : [];
    if(rolls.length){
      rolls.forEach(r => {
        const label = String(r?.label || 'Rolagem');
        const expr = String(r?.expr || '').trim();
        const row = document.createElement('div');
        row.className = 'rollMini';

        let exprInput = null;
        if(!expr){
          exprInput = document.createElement('input');
          exprInput.className = 'input input-sm';
          exprInput.placeholder = 'Expr (ex: 2d8 + @attributes.Arcano.quarter)';
          const saved = state.ui.abilityRollOverrides?.[ab.name]?.[label];
          if(saved) exprInput.value = String(saved);
          exprInput.addEventListener('change', () => {
            state.ui.abilityRollOverrides = state.ui.abilityRollOverrides || {};
            state.ui.abilityRollOverrides[ab.name] = state.ui.abilityRollOverrides[ab.name] || {};
            state.ui.abilityRollOverrides[ab.name][label] = String(exprInput.value || '').trim();
            saveState();
          });
          row.appendChild(exprInput);
        }

        const btn = document.createElement('button');
        btn.className = 'btn btn-ghost btn-sm';
        btn.textContent = `Rolar: ${label}`;
        btn.addEventListener('click', () => {
          const doRoll = () => {
            const effectiveExpr = expr || String(exprInput?.value || '').trim();
            if(!effectiveExpr){
              toastQuick('Sem expressão', `Defina uma expressão de rolagem para “${label}”.`);
              window.__sfx?.play?.('error');
              return;
            }

            window.__sfx?.play?.('roll');
            const isDamage = /dano/i.test(label);
            if(isDamage){
              const target = String(state.ui.abilityDamageTarget || 'generic');
              const out = damageFor(target, effectiveExpr);
              log(`Rolagem (${ab.name} / ${label}): ${out.text}`);
            }else{
              const out = evalExpr(effectiveExpr);
              log(`Rolagem (${ab.name} / ${label}): ${out.text}`);
            }
            render();
          };

          const shouldSpend = !!state.ui.abilityAutoSpend && String(ab?.type) === 'Ativa' && (ab?.cost?.length || ab?.auto_cost);
          if(shouldSpend){
            window.__sfx?.play?.(getAbilitySfx(ab));
            spendAbilityCosts(ab, (ok) => { if(ok) doRoll(); });
          }else{
            doRoll();
          }
        });
        row.appendChild(btn);
        actions.appendChild(row);
      });
    }

    card.appendChild(actions);
    root.appendChild(card);
  });
}

function initAbilitiesLibraryUi(){
  const search = document.getElementById('abilitySearch');
  const type = document.getElementById('abilityTypeFilter');
  const autoSpend = document.getElementById('abilityAutoSpend');
  const dmgTarget = document.getElementById('abilityDamageTarget');

  if(search){
    search.value = String(state.ui.abilitySearch || '');
    search.addEventListener('input', () => {
      state.ui.abilitySearch = String(search.value || '');
      saveState();
      renderAbilitiesLibrary();
    });
  }

  if(type){
    type.value = String(state.ui.abilityTypeFilter || 'all');
    type.addEventListener('change', () => {
      state.ui.abilityTypeFilter = String(type.value || 'all');
      saveState();
      renderAbilitiesLibrary();
    });
  }

  if(autoSpend){
    autoSpend.checked = !!state.ui.abilityAutoSpend;
    autoSpend.addEventListener('change', () => {
      state.ui.abilityAutoSpend = !!autoSpend.checked;
      saveState();
    });
  }

  if(dmgTarget){
    dmgTarget.value = String(state.ui.abilityDamageTarget || 'sword');
    dmgTarget.addEventListener('change', () => {
      state.ui.abilityDamageTarget = String(dmgTarget.value || 'generic');
      saveState();
    });
  }

  wirePvModal();
  renderAbilitiesLibrary();
  renderEquipment();
}

// ------------------------------
// Etapa 12 — Builds & Snapshots (presets + sessão)
// - Nome automático com timestamp
// - Confirmação visual (flash)
// - Builds (só configurações) separados de Snapshots (sessão inteira)
// ------------------------------

function toastQuick(title, detail){
  try{
    let host = document.getElementById('toastHost');
    if(!host){
      host = document.createElement('div');
      host.id = 'toastHost';
      host.className = 'toastHost';
      host.setAttribute('aria-live', 'polite');
      host.setAttribute('aria-atomic', 'true');
      document.body.appendChild(host);
    }

    const el = document.createElement('div');
    el.className = 'toast';
    const lower = String(title||'').toLowerCase();
    if(
      lower.includes('sobrescrito') ||
      lower.includes('falha') ||
      lower.includes('erro') ||
      lower.includes('inválido') ||
      lower.includes('invalido')
    ){
      el.className = 'toast warn';
    }


    const strong = document.createElement('div');
    strong.textContent = String(title || 'OK');
    el.appendChild(strong);

    if(detail){
      const small = document.createElement('small');
      small.textContent = String(detail);
      el.appendChild(small);
    }

    host.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      el.style.transition = 'opacity .18s ease, transform .18s ease';
      setTimeout(() => el.remove(), 220);
    }, 2200);
  }catch(_){/* ignore */}
}

function formatStampShort(isoOrDate){
  try{
    const d = (isoOrDate instanceof Date) ? isoOrDate : new Date(isoOrDate);
    if(!d || isNaN(d.getTime())) return '';
    return d.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }).replace(',', '');
  }catch(_){ return ''; }
}

function flashSlot(el){
  try{
    if(!el) return;
    el.classList.remove('slotFlash');
    // force reflow
    void el.offsetWidth;
    el.classList.add('slotFlash');
    setTimeout(() => el.classList.remove('slotFlash'), 650);
  }catch(_){/* ignore */}
}

function downloadJson(filename, obj){
  try{
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 0);
  }catch(_){/* ignore */}
}

function buildsKey(){
  const name = (character?.meta?.name || "character").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return `rpg_builds:${name}:v2`;
}

function sessionsKey(){
  const name = (character?.meta?.name || "character").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return `rpg_sessions:${name}:v1`;
}

let builds = [
  { title: "Build 1", preset: null, savedAt: null, userNamed: false },
  { title: "Build 2", preset: null, savedAt: null, userNamed: false },
  { title: "Build 3", preset: null, savedAt: null, userNamed: false }
];

let sessions = [
  { title: "Sessão 1", snap: null, savedAt: null, userNamed: false },
  { title: "Sessão 2", snap: null, savedAt: null, userNamed: false },
  { title: "Sessão 3", snap: null, savedAt: null, userNamed: false }
];

function loadBuilds(){
  // compatível com v1 (Etapa 11) e v2 (Etapa 12)
  try{
    const rawV2 = localStorage.getItem(buildsKey());
    if(rawV2){
      const j = JSON.parse(rawV2);
      if(j && j.v === 2 && Array.isArray(j.slots)){
        builds = builds.map((b, i) => {
          const s = j.slots[i];
          if(!s) return b;
          return {
            title: String(s.title || b.title || `Build ${i+1}`),
            preset: (s.preset && typeof s.preset === 'object') ? s.preset : null,
            savedAt: s.savedAt || (s.preset?.captured_at || null),
            userNamed: !!s.userNamed
          };
        });
        return;
      }
    }
  }catch(_){/* ignore */}

  // v1 legacy
  try{
    const name = (character?.meta?.name || "character").toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const legacyKey = `rpg_builds:${name}:v1`;
    const raw = localStorage.getItem(legacyKey);
    if(!raw) return;
    const j = JSON.parse(raw);
    if(!j || j.v !== 1 || !Array.isArray(j.slots)) return;

    builds = builds.map((b, i) => {
      const s = j.slots[i];
      if(!s) return b;
      return {
        title: String(s.title || b.title || `Build ${i+1}`),
        preset: (s.preset && typeof s.preset === 'object') ? s.preset : null,
        savedAt: s.preset?.captured_at || null,
        userNamed: false
      };
    });
    saveBuilds();
  }catch(_){/* ignore */}
}

function saveBuilds(){
  try{
    localStorage.setItem(buildsKey(), JSON.stringify({
      v: 2,
      slots: builds,
      saved_at: new Date().toISOString()
    }));
  }catch(_){/* ignore */}
}

function loadSessions(){
  try{
    const raw = localStorage.getItem(sessionsKey());
    if(!raw) return;
    const j = JSON.parse(raw);
    if(!j || j.v !== 1 || !Array.isArray(j.slots)) return;

    sessions = sessions.map((s0, i) => {
      const s = j.slots[i];
      if(!s) return s0;
      return {
        title: String(s.title || s0.title || `Sessão ${i+1}`),
        snap: (s.snap && typeof s.snap === 'object') ? s.snap : null,
        savedAt: s.savedAt || (s.snap?.captured_at || null),
        userNamed: !!s.userNamed
      };
    });
  }catch(_){/* ignore */}
}

function saveSessions(){
  try{
    localStorage.setItem(sessionsKey(), JSON.stringify({
      v: 1,
      slots: sessions,
      saved_at: new Date().toISOString()
    }));
  }catch(_){/* ignore */}
}

function readSfxSettings(){
  // prefer live API (sfx.js) when available
  try{
    if(window.__sfx){
      return {
        enabled: !!window.__sfx.enabled,
        volume: Number(window.__sfx.volume ?? 0.35),
        pack: String(window.__sfx.pack || 'shadowheart'),
        ambient: !!window.__sfx.ambient
      };
    }
  }catch(_){/* ignore */}

  // fallback: localStorage (tats_sfx:v2 / v1)
  try{
    const raw2 = localStorage.getItem('tats_sfx:v2');
    if(raw2){
      const j = JSON.parse(raw2);
      return {
        enabled: (j.enabled !== false),
        volume: Number(j.volume ?? 0.35),
        pack: String(j.pack || 'shadowheart'),
        ambient: !!j.ambient
      };
    }
    const raw1 = localStorage.getItem('tats_sfx:v1');
    if(raw1){
      const j = JSON.parse(raw1);
      return {
        enabled: (j.enabled !== false),
        volume: Number(j.volume ?? 0.35),
        pack: 'shadowheart',
        ambient: false
      };
    }
  }catch(_){/* ignore */}

  return { enabled: true, volume: 0.35, pack: 'shadowheart', ambient: false };
}

function applySfxSettings(s){
  if(!s || typeof s !== 'object') return;
  if(!window.__sfx) return;
  try{
    if('enabled' in s) window.__sfx.setEnabled(!!s.enabled);
    if('volume' in s) window.__sfx.setVolume(Math.max(0, Math.min(1, Number(s.volume))));
    if('pack' in s) window.__sfx.setPack(String(s.pack || 'shadowheart'));
    if('ambient' in s) window.__sfx.setAmbient(!!s.ambient);
  }catch(_){/* ignore */}
}

function capturePreset(){
  const e = getEssence();
  const luckMode = String(document.getElementById('luckMode')?.value || 'normal');
  return {
    v: 1,
    captured_at: new Date().toISOString(),
    essence: { ...e },
    globalDamageBonusDice: clampInt(state.globalDamageBonusDice, 0, 10),
    ui: {
      skillMode: String(state.ui.skillMode || 'normal'),
      autoMagicAdv: !!state.ui.autoMagicAdv
    },
    luckMode,
    sfx: readSfxSettings()
  };
}

function applyPreset(p){
  if(!p || typeof p !== 'object') return;

  if(p.essence && typeof p.essence === 'object'){
    state.essence = { ...state.essence, ...p.essence };
  }
  if(typeof p.globalDamageBonusDice === 'number'){
    state.globalDamageBonusDice = clampInt(p.globalDamageBonusDice, 0, 10);
  }
  if(p.ui && typeof p.ui === 'object'){
    if('skillMode' in p.ui) state.ui.skillMode = String(p.ui.skillMode || 'normal');
    if('autoMagicAdv' in p.ui) state.ui.autoMagicAdv = !!p.ui.autoMagicAdv;
  }
  if(p.luckMode){
    const el = document.getElementById('luckMode');
    if(el) el.value = String(p.luckMode);
  }

  if(p.sfx) applySfxSettings(p.sfx);

  // mantém consistência do toggle de auto-vantagem (perícias/magia)
  try{
    if(typeof setAutoMagicAdv === 'function') setAutoMagicAdv(!!state.ui.autoMagicAdv);
  }catch(_){/* ignore */}

  saveState();
  renderEssenceUi();
  render();
}

function captureSessionSnapshot(){
  return {
    v: 1,
    kind: 'session_snapshot',
    captured_at: new Date().toISOString(),
    character: character?.meta?.name || 'character',
    state: {
      round: state.round,
      tracks: { ps: state.ps, pf: state.pf, pvo: state.pvo, pvd: state.pvd },
      effects: state.effects,
      essence: state.essence,
      globalDamageBonusDice: state.globalDamageBonusDice,
      logLines: state.logLines,
      ui: state.ui
    },
    sfx: readSfxSettings()
  };
}

function applySessionSnapshot(j){
  if(!j || typeof j !== 'object') return;
  const s = (j.state && typeof j.state === 'object') ? j.state : j;

  if(s.round != null) state.round = clampInt(s.round, 1, 9999);

  const tr = s.tracks || {};
  if(tr.ps != null) state.ps = Number(tr.ps);
  if(tr.pf != null) state.pf = Number(tr.pf);
  if(tr.pvo != null) state.pvo = Number(tr.pvo);
  if(tr.pvd != null) state.pvd = Number(tr.pvd);

  if(s.effects && typeof s.effects === 'object'){
    state.effects = { sanguenta: null, plasma: null, aura: null, ...s.effects };
  }
  if(s.essence && typeof s.essence === 'object'){
    state.essence = { ...state.essence, ...s.essence };
  }
  if(typeof s.globalDamageBonusDice === 'number'){
    state.globalDamageBonusDice = clampInt(s.globalDamageBonusDice, 0, 10);
  }
  if(Array.isArray(s.logLines)){
    state.logLines = s.logLines.slice(0, 200);
  }
  if(s.ui && typeof s.ui === 'object'){
    state.ui = { ...state.ui, ...s.ui };
    if(!state.ui.lastSkillRolls || typeof state.ui.lastSkillRolls !== 'object') state.ui.lastSkillRolls = {};
    if(!Array.isArray(state.ui.favorites)) state.ui.favorites = [];
    if(!state.ui.weaponBases || typeof state.ui.weaponBases !== 'object') state.ui.weaponBases = {};
    if(typeof state.ui._favSeeded !== 'boolean') state.ui._favSeeded = false;
  }

  if(j.sfx) applySfxSettings(j.sfx);

  // sincroniza toggles
  try{
    if(typeof setAutoMagicAdv === 'function') setAutoMagicAdv(!!state.ui.autoMagicAdv);
  }catch(_){/* ignore */}

  saveState();
  renderEssenceUi();
  render();
  renderLog();
}

function presetSummary(p){
  if(!p || typeof p !== 'object') return '—';
  const e = p.essence || {};
  const mode = (e.stackMode === 'literal') ? 'Literal' : 'Conservador';
  const dmg = (typeof p.globalDamageBonusDice === 'number') ? p.globalDamageBonusDice : '—';
  const ama = p.ui?.autoMagicAdv ? 'ON' : 'OFF';
  const sm = p.ui?.skillMode ? String(p.ui.skillMode) : 'normal';
  const sfx = p.sfx ? `${p.sfx.enabled ? 'Som ON' : 'Som OFF'} • ${String(p.sfx.pack || 'shadowheart')}` : 'Som —';
  const res = (e.defPassiveRes && String(e.defPassiveRes).trim()) ? `\nResist.: ${String(e.defPassiveRes).trim()}` : '';
  const when = p.captured_at ? `\nSalva: ${formatStampShort(p.captured_at)}` : '';
  return `EV${e.ev ?? 0} / OF${e.off ?? 0} / DEF${e.def ?? 0} / APT${e.apt ?? 0} • ${mode}\nBônus dano: ${dmg} dado(s) • Auto magia: ${ama} • Perícias: ${sm}\n${sfx}${res}${when}`;
}

function sessionSummary(sn){
  if(!sn || typeof sn !== 'object') return '—';
  const st = sn.state || {};
  const tr = st.tracks || {};
  const when = sn.captured_at ? formatStampShort(sn.captured_at) : '';
  const fx = st.effects || {};
  const fxOn = [fx.sanguenta ? 'Sanguenta' : null, fx.plasma ? 'Plasma' : null, fx.aura ? 'Aura' : null].filter(Boolean);
  const fxTxt = fxOn.length ? fxOn.join(', ') : '—';
  return `Rodada: ${st.round ?? '—'} • PS ${tr.ps ?? '—'} / PF ${tr.pf ?? '—'} • PVO ${tr.pvo ?? '—'} / PVD ${tr.pvd ?? '—'}\nEfeitos: ${fxTxt}${when ? `\nSalva: ${when}` : ''}`;
}

function renderBuildsUi(){
  for(let i=0;i<3;i++){
    const titleEl = document.getElementById(`buildTitle${i}`);
    const badgeEl = document.getElementById(`buildBadge${i}`);
    const sumEl = document.getElementById(`buildSummary${i}`);
    const loadBtn = document.getElementById(`buildLoad${i}`);
    const clearBtn = document.getElementById(`buildClear${i}`);

    const slotEl = document.querySelector(`.buildSlot[data-slot=\"${i}\"]`);
    const slot = builds[i] || { title: `Build ${i+1}`, preset: null, savedAt: null };
    const has = !!slot.preset;

    const editEl = document.getElementById(`buildTitleEdit${i}`);
    const editing = !!(editEl && !editEl.hidden);
    if(titleEl && !editing) titleEl.textContent = slot.title || `Build ${i+1}`;
    if(badgeEl){
      if(has){
        const t = formatStampShort(slot.savedAt || slot.preset?.captured_at);
        badgeEl.textContent = t ? `Salva • ${t}` : 'Salva';
        badgeEl.classList.add('on');
        badgeEl.title = slot.savedAt || slot.preset?.captured_at || '';
      }else{
        badgeEl.textContent = 'Vazio';
        badgeEl.classList.remove('on');
        badgeEl.title = '';
      }
    }
    if(sumEl) sumEl.textContent = has ? presetSummary(slot.preset) : '—';
    if(loadBtn) loadBtn.disabled = !has;
    if(clearBtn) clearBtn.disabled = !has;

    const dupSel = document.getElementById(`buildDupTo${i}`);
    const dupBtn = document.getElementById(`buildDup${i}`);
    if(dupSel){
      renderDupSelect(dupSel, builds.map((b, idx) => (idx===i? "": (b?.title || `Build ${idx+1}`))), i);
      dupSel.disabled = !has;
    }
    if(dupBtn) dupBtn.disabled = !has;

    if(slotEl) slotEl.classList.toggle('hasData', has);
  }
}

function renderSessionsUi(){
  for(let i=0;i<3;i++){
    const titleEl = document.getElementById(`sessionTitle${i}`);
    const badgeEl = document.getElementById(`sessionBadge${i}`);
    const sumEl = document.getElementById(`sessionSummary${i}`);
    const loadBtn = document.getElementById(`sessionLoad${i}`);
    const clearBtn = document.getElementById(`sessionClear${i}`);

    const slotEl = document.querySelector(`.sessionSlot[data-sslot=\"${i}\"]`);
    const slot = sessions[i] || { title: `Sessão ${i+1}`, snap: null, savedAt: null };
    const has = !!slot.snap;

    const editEl = document.getElementById(`sessionTitleEdit${i}`);
    const editing = !!(editEl && !editEl.hidden);
    if(titleEl && !editing) titleEl.textContent = slot.title || `Sessão ${i+1}`;
    if(badgeEl){
      if(has){
        const t = formatStampShort(slot.savedAt || slot.snap?.captured_at);
        badgeEl.textContent = t ? `Salva • ${t}` : 'Salva';
        badgeEl.classList.add('on');
        badgeEl.title = slot.savedAt || slot.snap?.captured_at || '';
      }else{
        badgeEl.textContent = 'Vazio';
        badgeEl.classList.remove('on');
        badgeEl.title = '';
      }
    }
    if(sumEl) sumEl.textContent = has ? sessionSummary(slot.snap) : '—';
    if(loadBtn) loadBtn.disabled = !has;
    if(clearBtn) clearBtn.disabled = !has;

    const dupSel = document.getElementById(`sessionDupTo${i}`);
    const dupBtn = document.getElementById(`sessionDup${i}`);
    if(dupSel){
      renderDupSelect(dupSel, sessions.map((s, idx) => (idx===i? "": (s?.title || `Sessão ${idx+1}`))), i);
      dupSel.disabled = !has;
    }
    if(dupBtn) dupBtn.disabled = !has;

    if(slotEl) slotEl.classList.toggle('hasData', has);
  }
}

function ensureAutoTitle(slot, base){
  try{
    if(!slot) return;
    if(slot.userNamed) return;
    if(String(slot.title || '').trim() !== base) return;
    slot.title = `${base} — ${formatStampShort(new Date())}`;
  }catch(_){/* ignore */}
}


function deepClone(obj){
  try{ return JSON.parse(JSON.stringify(obj)); }catch(_){ return null; }
}

function beginInlineRename(kind, i){
  const isBuild = (kind === 'build');
  const arr = isBuild ? builds : sessions;
  const base = isBuild ? `Build ${i+1}` : `Sessão ${i+1}`;
  const titleId = isBuild ? `buildTitle${i}` : `sessionTitle${i}`;
  const inputId = isBuild ? `buildTitleEdit${i}` : `sessionTitleEdit${i}`;

  const titleEl = document.getElementById(titleId);
  let inputEl = document.getElementById(inputId);
  if(!titleEl) return;

  if(!inputEl){
    inputEl = document.createElement('input');
    inputEl.id = inputId;
    inputEl.className = 'input input-sm titleEdit';
    inputEl.type = 'text';
    inputEl.maxLength = 40;
    inputEl.hidden = true;
    titleEl.insertAdjacentElement('afterend', inputEl);
  }

  // já está editando?
  if(!inputEl.hidden) return;

  const cur = String((arr[i]?.title) || titleEl.textContent || base);
  inputEl.value = cur;

  titleEl.style.display = 'none';
  inputEl.hidden = false;

  // bind (uma vez)
  if(!inputEl.dataset.bound){
    inputEl.dataset.bound = '1';
    inputEl.addEventListener('keydown', (e) => {
      if(e.key === 'Enter'){
        e.preventDefault();
        commitInlineRename(kind, i);
      }else if(e.key === 'Escape'){
        e.preventDefault();
        cancelInlineRename(kind, i);
      }
    });
    inputEl.addEventListener('blur', () => {
      // se foi cancelado via ESC, ignora
      if(inputEl.dataset.cancelled === '1'){
        inputEl.dataset.cancelled = '0';
        return;
      }
      commitInlineRename(kind, i);
    });
  }

  setTimeout(() => {
    try{ inputEl.focus(); inputEl.select(); }catch(_){}
  }, 0);
}

function commitInlineRename(kind, i){
  const isBuild = (kind === 'build');
  const arr = isBuild ? builds : sessions;
  const base = isBuild ? `Build ${i+1}` : `Sessão ${i+1}`;
  const titleEl = document.getElementById(isBuild ? `buildTitle${i}` : `sessionTitle${i}`);
  const inputEl = document.getElementById(isBuild ? `buildTitleEdit${i}` : `sessionTitleEdit${i}`);
  const saveFn = isBuild ? saveBuilds : saveSessions;
  const renderFn = isBuild ? renderBuildsUi : renderSessionsUi;

  if(!titleEl || !inputEl) return;

  const trimmed = String(inputEl.value || '').trim().slice(0, 40);
  if(trimmed){
    if(isBuild){
      arr[i] = arr[i] || { title: base, preset: null, savedAt: null, userNamed: false };
    }else{
      arr[i] = arr[i] || { title: base, snap: null, savedAt: null, userNamed: false };
    }
    arr[i].title = trimmed;
    arr[i].userNamed = true;
    saveFn();
    renderFn();
    toastQuick('Nome atualizado.', trimmed);
  }

  inputEl.hidden = true;
  titleEl.style.display = '';
}

function cancelInlineRename(kind, i){
  const isBuild = (kind === 'build');
  const titleEl = document.getElementById(isBuild ? `buildTitle${i}` : `sessionTitle${i}`);
  const inputEl = document.getElementById(isBuild ? `buildTitleEdit${i}` : `sessionTitleEdit${i}`);
  if(!titleEl || !inputEl) return;

  inputEl.dataset.cancelled = '1';
  inputEl.hidden = true;
  titleEl.style.display = '';
}


function makeCopyTitle(srcTitle){
  try{
    const t = String(srcTitle || '').trim() || 'Cópia';
    // If it already looks like a copy, add a small index
    if(/cópia\s*\d*\s*$/i.test(t)){
      return t.replace(/\s*$/,'') + ' 2';
    }
    return t + ' — cópia';
  }catch(_){
    return 'Cópia';
  }
}

function duplicateBuildSlot(src, dst){
  try{
    if(src === dst) return;
    const srcObj = builds[src] || { title: `Build ${src+1}`, preset: null, savedAt: null, userNamed: false };
    const sp = srcObj?.preset;
    if(!sp) return;

    const dstHad = Boolean(builds[dst]?.preset);
    builds[dst] = builds[dst] || { title: `Build ${dst+1}`, preset: null, savedAt: null, userNamed: false };
    ensureAutoTitle(builds[dst], `Build ${dst+1}`);

    const cloned = deepClone(sp);
    builds[dst].preset = cloned || sp;
    builds[dst].savedAt = new Date().toISOString();

    // Auto-name the destination as a copy of the source (only if the user didn't manually name it)
    if(!builds[dst].userNamed){
      const baseTitle = String(srcObj.title || `Build ${src+1}`).trim() || `Build ${src+1}`;
      builds[dst].title = makeCopyTitle(baseTitle);
    }

    saveBuilds();
    renderBuildsUi();

    const dstEl = document.querySelector(`.buildSlot[data-slot="${dst}"]`);
    flashSlot(dstEl);

    if(dstHad){
      toastQuick('Destino sobrescrito', `Build ${src+1} → ${dst+1}`);
      log(`Build duplicado: slot ${src+1} → ${dst+1} (sobrescrito).`);
    }else{
      toastQuick('Duplicado', `Build ${src+1} → ${dst+1}`);
      log(`Build duplicado: slot ${src+1} → ${dst+1}.`);
    }
  }catch(_ ){/* ignore */}
}

function duplicateSessionSlot(src, dst){
  try{
    if(src === dst) return;
    const srcObj = sessions[src] || { title: `Sessão ${src+1}`, snap: null, savedAt: null, userNamed: false };
    const sp = srcObj?.snap;
    if(!sp) return;

    const dstHad = Boolean(sessions[dst]?.snap);
    sessions[dst] = sessions[dst] || { title: `Sessão ${dst+1}`, snap: null, savedAt: null, userNamed: false };
    ensureAutoTitle(sessions[dst], `Sessão ${dst+1}`);

    const cloned = deepClone(sp);
    sessions[dst].snap = cloned || sp;
    sessions[dst].savedAt = new Date().toISOString();

    // Auto-name the destination as a copy of the source (only if the user didn't manually name it)
    if(!sessions[dst].userNamed){
      const baseTitle = String(srcObj.title || `Sessão ${src+1}`).trim() || `Sessão ${src+1}`;
      sessions[dst].title = makeCopyTitle(baseTitle);
    }

    saveSessions();
    renderSessionsUi();

    const dstEl = document.querySelector(`.sessionSlot[data-sslot="${dst}"]`);
    flashSlot(dstEl);

    if(dstHad){
      toastQuick('Destino sobrescrito', `Sessão ${src+1} → ${dst+1}`);
      log(`Snapshot duplicado: slot ${src+1} → ${dst+1} (sobrescrito).`);
    }else{
      toastQuick('Duplicado', `Sessão ${src+1} → ${dst+1}`);
      log(`Snapshot duplicado: slot ${src+1} → ${dst+1}.`);
    }
  }catch(_ ){/* ignore */}
}

function renderDupSelect(sel, titles, selfIndex){
  try{
    if(!sel) return;
    const prev = sel.value;
    sel.innerHTML = '';
    for(let j=0;j<3;j++){
      if(j === selfIndex) continue;
      const opt = document.createElement('option');
      opt.value = String(j);
      opt.textContent = String(titles[j] || (j+1));
      sel.appendChild(opt);
    }
    if(prev && Array.from(sel.options).some(o => o.value === prev)){
      sel.value = prev;
    }
  }catch(_){/* ignore */}
}

// ------------------------------
// Etapa 15 — Export/Import com versão + validação + migração
// - Arquivos exportados ganham schema_version
// - Import valida e migra formatos antigos (v1/v2)
// ------------------------------

const FILE_SCHEMAS = {
  builds: 3,
  session: 2
};

function isPlainObject(v){
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function safeText(v, fallback = ''){
  const s = String(v ?? fallback);
  // remove controles estranhos
  return s.replace(/[\u0000-\u001F\u007F]/g, '').trim();
}

function safeTitle(v, fallback){
  const s = safeText(v, fallback);
  const t = s.length ? s : String(fallback || '');
  return t.slice(0, 80);
}

function isIsoDate(s){
  if(!s) return false;
  const d = new Date(s);
  return !!d && !isNaN(d.getTime());
}

function pickSchemaVersion(j){
  const raw = (j && (j.schema_version ?? j.schemaVersion ?? j.v ?? j.version)) ?? 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function normalizePreset(p){
  if(!isPlainObject(p)) return null;

  // clonesafe
  const out = JSON.parse(JSON.stringify(p));

  // aliases
  if(!out.captured_at && out.capturedAt) out.captured_at = out.capturedAt;
  if(!out.v) out.v = 1;

  // migra ui antiga (se existia fora de ui)
  if(!out.ui || !isPlainObject(out.ui)) out.ui = out.ui && isPlainObject(out.ui) ? out.ui : {};
  if('autoMagicAdv' in out && !('autoMagicAdv' in out.ui)) out.ui.autoMagicAdv = !!out.autoMagicAdv;
  if('skillMode' in out && !('skillMode' in out.ui)) out.ui.skillMode = String(out.skillMode || 'normal');

  // migra nomes possíveis da essência
  if(out.essence && isPlainObject(out.essence)){
    const e = out.essence;
    if(e.of != null && e.off == null) e.off = e.of;
    if(e.defense != null && e.def == null) e.def = e.defense;
    if(e.magic != null && e.apt == null) e.apt = e.magic;
    if(e.true != null && e.ev == null) e.ev = e.true;
  }

  return out;
}

function normalizeBuildSlot(s, i){
  const fallbackTitle = `Build ${i+1}`;
  if(!isPlainObject(s)) return { title: fallbackTitle, preset: null, savedAt: null, userNamed: false };

  const title = safeTitle(s.title, fallbackTitle);
  const userNamed = !!(s.userNamed ?? s.user_named);
  const preset = normalizePreset(s.preset ?? s.data ?? null);

  // savedAt pode vir como ISO, timestamp numérico ou ausente
  let savedAt = s.savedAt ?? s.saved_at ?? s.saved ?? null;
  if(!savedAt && preset?.captured_at) savedAt = preset.captured_at;
  if(typeof savedAt === 'number') savedAt = new Date(savedAt).toISOString();
  savedAt = safeText(savedAt, '');
  if(!isIsoDate(savedAt)) savedAt = null;

  return { title, preset, savedAt, userNamed };
}

function normalizeBuildsImport(j){
  if(!isPlainObject(j)) return { ok: false, error: 'JSON inválido.' };

  const ver = pickSchemaVersion(j);
  const kind = safeText(j.kind ?? j.type ?? '').toLowerCase();

  // slots
  let slots = null;
  if(Array.isArray(j.slots)) slots = j.slots;
  else if(Array.isArray(j.builds)) slots = j.builds;
  else if(Array.isArray(j.presets)) slots = j.presets;

  if(!slots) return { ok: false, error: 'Arquivo não parece ser de builds (slots ausentes).' };

  if(kind && kind !== 'builds' && kind !== 'presets'){
    // ainda pode funcionar, mas avisa de forma clara
    // (não bloqueia se slots estão presentes)
  }

  if(ver && ver > FILE_SCHEMAS.builds){
    return { ok: false, error: `Versão de builds (${ver}) é mais nova que o site (${FILE_SCHEMAS.builds}).` };
  }

  const outSlots = [];
  for(let i=0;i<3;i++) outSlots.push(normalizeBuildSlot(slots[i], i));

  return {
    ok: true,
    data: {
      schema_version: FILE_SCHEMAS.builds,
      v: FILE_SCHEMAS.builds,
      kind: 'builds',
      character: safeText(j.character ?? j.char ?? (character?.meta?.name || 'character')),
      imported_at: new Date().toISOString(),
      slots: outSlots
    }
  };
}

function normalizeSessionImport(j){
  if(!isPlainObject(j)) return { ok: false, error: 'JSON inválido.' };

  const ver = pickSchemaVersion(j);
  const kind = safeText(j.kind ?? j.type ?? '').toLowerCase();

  if(ver && ver > FILE_SCHEMAS.session){
    return { ok: false, error: `Versão de sessão (${ver}) é mais nova que o site (${FILE_SCHEMAS.session}).` };
  }

  // aceita session / session_snapshot / snapshot
  if(kind && !['session','session_snapshot','snapshot','sessao','sessão'].includes(kind)){
    // não bloqueia se conseguimos achar estado
  }

  // estado pode estar em j.state ou ser um formato antigo “achatado”
  let st = null;
  if(isPlainObject(j.state)){
    st = j.state;
  }else{
    // tentativa de compatibilidade com export antigo “flat”
    st = {
      round: j.round ?? j.rodada ?? 1,
      tracks: j.tracks ?? {
        ps: j.ps,
        pf: j.pf,
        pvo: j.pvo,
        pvd: j.pvd
      },
      effects: j.effects,
      essence: j.essence,
      globalDamageBonusDice: j.globalDamageBonusDice,
      logLines: j.logLines,
      ui: j.ui
    };
  }

  if(!isPlainObject(st)) return { ok: false, error: 'Arquivo não parece conter estado de sessão.' };

  // sanitiza o mínimo (sem “corrigir demais”)
  const tracks = isPlainObject(st.tracks) ? st.tracks : {};
  const out = {
    schema_version: FILE_SCHEMAS.session,
    v: FILE_SCHEMAS.session,
    kind: 'session',
    imported_at: new Date().toISOString(),
    captured_at: safeText(j.captured_at ?? st.captured_at ?? j.capturedAt ?? ''),
    character: safeText(j.character ?? j.char ?? (character?.meta?.name || 'character')),
    state: {
      round: clampInt(st.round ?? 1, 1, 9999),
      tracks: {
        ps: Number(tracks.ps ?? tracks.PS ?? tracks.hp ?? st.ps ?? st.PS ?? state.ps),
        pf: Number(tracks.pf ?? tracks.PF ?? st.pf ?? st.PF ?? state.pf),
        pvo: Number(tracks.pvo ?? tracks.PVO ?? st.pvo ?? st.PVO ?? state.pvo),
        pvd: Number(tracks.pvd ?? tracks.PVD ?? st.pvd ?? st.PVD ?? state.pvd)
      },
      effects: isPlainObject(st.effects) ? st.effects : st.effects || {},
      essence: isPlainObject(st.essence) ? st.essence : st.essence || {},
      globalDamageBonusDice: (typeof st.globalDamageBonusDice === 'number') ? st.globalDamageBonusDice : state.globalDamageBonusDice,
      logLines: Array.isArray(st.logLines) ? st.logLines.slice(0, 200) : state.logLines,
      ui: isPlainObject(st.ui) ? st.ui : st.ui || {}
    },
    sfx: isPlainObject(j.sfx) ? j.sfx : (isPlainObject(st.sfx) ? st.sfx : null)
  };

  // se não veio captured_at, tenta puxar de exported_at
  if(!out.captured_at){
    const maybe = safeText(j.exported_at ?? j.saved_at ?? '');
    if(isIsoDate(maybe)) out.captured_at = maybe;
  }

  return { ok: true, data: out };
}


function initBuildsUi(){
  loadBuilds();
  loadSessions();
  renderBuildsUi();
  renderSessionsUi();

  for(let i=0;i<3;i++){
    const saveBtn = document.getElementById(`buildSave${i}`);
    const loadBtn = document.getElementById(`buildLoad${i}`);
    const renBtn = document.getElementById(`buildRename${i}`);
    const clrBtn = document.getElementById(`buildClear${i}`);

    const slotEl = document.querySelector(`.buildSlot[data-slot=\"${i}\"]`);

    if(saveBtn) saveBtn.addEventListener('click', () => {
      builds[i] = builds[i] || { title: `Build ${i+1}`, preset: null, savedAt: null, userNamed: false };
      ensureAutoTitle(builds[i], `Build ${i+1}`);
      builds[i].preset = capturePreset();
      builds[i].savedAt = new Date().toISOString();
      saveBuilds();
      renderBuildsUi();
      flashSlot(slotEl);
      toastQuick(`Build salva`, builds[i].title);
      log(`Build salva no slot ${i+1}.`);
    });

    if(loadBtn) loadBtn.addEventListener('click', () => {
      const p = builds[i]?.preset;
      if(!p) return;
      applyPreset(p);
      renderBuildsUi();
      flashSlot(slotEl);
      toastQuick(`Build carregada`, builds[i]?.title || `Build ${i+1}`);
      log(`Build carregada do slot ${i+1}.`);
    });

    const titleEl = document.getElementById(`buildTitle${i}`);
const dupSel = document.getElementById(`buildDupTo${i}`);
const dupBtn = document.getElementById(`buildDup${i}`);

if(renBtn) renBtn.addEventListener('click', () => beginInlineRename('build', i));
if(titleEl){
  titleEl.addEventListener('dblclick', () => beginInlineRename('build', i));
  titleEl.addEventListener('keydown', (e) => {
    if(e.key === 'Enter'){
      e.preventDefault();
      beginInlineRename('build', i);
    }
  });
}

if(dupBtn && dupSel){
  dupBtn.addEventListener('click', () => {
    const dst = Number(dupSel.value);
    if(Number.isFinite(dst)) duplicateBuildSlot(i, dst);
  });
}

    if(clrBtn) clrBtn.addEventListener('click', () => {
      builds[i] = builds[i] || { title: `Build ${i+1}`, preset: null, savedAt: null, userNamed: false };
      builds[i].preset = null;
      builds[i].savedAt = null;
      saveBuilds();
      renderBuildsUi();
      flashSlot(slotEl);
      toastQuick('Build limpa.', builds[i].title);
      log(`Build limpa no slot ${i+1}.`);
    });
  }

  // Export/Import Builds
  const exportBuildsBtn = document.getElementById('exportBuilds');
  if(exportBuildsBtn) exportBuildsBtn.addEventListener('click', () => {
    const payload = {
      schema_version: FILE_SCHEMAS.builds,
      v: FILE_SCHEMAS.builds,
      kind: 'builds',
      character: character?.meta?.name || 'character',
      exported_at: new Date().toISOString(),
      app: { name: 'Tatsumaki-Ficha', stage: 15 },
      slots: builds
    };
    downloadJson('builds_tatsumaki.json', payload);
    toastQuick('Builds exportadas.');
  });

  const importBtn = document.getElementById('importBuildsBtn');
  const importFile = document.getElementById('importBuildsFile');
  if(importBtn && importFile){
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', async () => {
      const file = importFile.files?.[0];
      importFile.value = '';
      if(!file) return;
      try{
        const j = JSON.parse(await file.text());

        const norm = normalizeBuildsImport(j);
        if(!norm.ok) throw new Error(norm.error || 'inválido');
        const jj = norm.data;

        builds = builds.map((b, i) => {
          const s = jj.slots[i];
          if(!s) return b;
          return {
            title: String(s.title || b.title || `Build ${i+1}`),
            preset: (s.preset && typeof s.preset === 'object') ? s.preset : null,
            savedAt: s.savedAt || (s.preset?.captured_at || null),
            userNamed: !!s.userNamed
          };
        });

        saveBuilds();
        renderBuildsUi();
        toastQuick('Builds importadas.', `v${jj.schema_version || jj.v || '?'}`);
        log(`Builds importadas (JSON) — v${jj.schema_version || jj.v || '?'}.`);
      }catch(_){
        const msg = (String(_?.message || '').trim()) || 'JSON inválido.';
        toastQuick('Falha ao importar.', msg);
      }
    });
  }

  // Snapshots de Sessão (slots)
  for(let i=0;i<3;i++){
    const saveBtn = document.getElementById(`sessionSave${i}`);
    const loadBtn = document.getElementById(`sessionLoad${i}`);
    const renBtn = document.getElementById(`sessionRename${i}`);
    const clrBtn = document.getElementById(`sessionClear${i}`);

    const slotEl = document.querySelector(`.sessionSlot[data-sslot=\"${i}\"]`);

    if(saveBtn) saveBtn.addEventListener('click', () => {
      sessions[i] = sessions[i] || { title: `Sessão ${i+1}`, snap: null, savedAt: null, userNamed: false };
      ensureAutoTitle(sessions[i], `Sessão ${i+1}`);
      sessions[i].snap = captureSessionSnapshot();
      sessions[i].savedAt = new Date().toISOString();
      saveSessions();
      renderSessionsUi();
      flashSlot(slotEl);
      toastQuick('Sessão salva', sessions[i].title);
      log(`Snapshot de sessão salvo no slot ${i+1}.`);
    });

    if(loadBtn) loadBtn.addEventListener('click', () => {
      const sn = sessions[i]?.snap;
      if(!sn) return;
      applySessionSnapshot(sn);
      renderBuildsUi();
      renderSessionsUi();
      flashSlot(slotEl);
      toastQuick('Sessão carregada', sessions[i]?.title || `Sessão ${i+1}`);
      log(`Snapshot de sessão carregado do slot ${i+1}.`);
    });

    const titleEl = document.getElementById(`sessionTitle${i}`);
const dupSel = document.getElementById(`sessionDupTo${i}`);
const dupBtn = document.getElementById(`sessionDup${i}`);

if(renBtn) renBtn.addEventListener('click', () => beginInlineRename('session', i));
if(titleEl){
  titleEl.addEventListener('dblclick', () => beginInlineRename('session', i));
  titleEl.addEventListener('keydown', (e) => {
    if(e.key === 'Enter'){
      e.preventDefault();
      beginInlineRename('session', i);
    }
  });
}

if(dupBtn && dupSel){
  dupBtn.addEventListener('click', () => {
    const dst = Number(dupSel.value);
    if(Number.isFinite(dst)) duplicateSessionSlot(i, dst);
  });
}

    if(clrBtn) clrBtn.addEventListener('click', () => {
      sessions[i] = sessions[i] || { title: `Sessão ${i+1}`, snap: null, savedAt: null, userNamed: false };
      sessions[i].snap = null;
      sessions[i].savedAt = null;
      saveSessions();
      renderSessionsUi();
      flashSlot(slotEl);
      toastQuick('Sessão limpa.', sessions[i].title);
      log(`Snapshot de sessão limpo no slot ${i+1}.`);
    });
  }

  // Export/Import Sessão (arquivo)
  const exportSessionBtn = document.getElementById('exportSession');
  if(exportSessionBtn) exportSessionBtn.addEventListener('click', () => {
    const payload = captureSessionSnapshot();
    payload.kind = 'session';
    payload.schema_version = FILE_SCHEMAS.session;
    payload.v = FILE_SCHEMAS.session;
    payload.exported_at = new Date().toISOString();
    payload.app = { name: 'Tatsumaki-Ficha', stage: 15 };
    downloadJson('sessao_tatsumaki.json', payload);
    toastQuick('Sessão exportada.');
  });

  const importSessionBtn = document.getElementById('importSessionBtn');
  const importSessionFile = document.getElementById('importSessionFile');
  if(importSessionBtn && importSessionFile){
    importSessionBtn.addEventListener('click', () => importSessionFile.click());
    importSessionFile.addEventListener('change', async () => {
      const file = importSessionFile.files?.[0];
      importSessionFile.value = '';
      if(!file) return;
      try{
        const j = JSON.parse(await file.text());
        const norm = normalizeSessionImport(j);
        if(!norm.ok) throw new Error(norm.error || 'Arquivo inválido.');
        const jj = norm.data;
        applySessionSnapshot(jj);
        renderBuildsUi();
        renderSessionsUi();
        toastQuick('Sessão importada.', `v${jj.schema_version || jj.v || '?'}`);
        log(`Sessão importada (JSON) — v${jj.schema_version || jj.v || '?'}.`);
      }catch(_){
        const msg = (String(_?.message || '').trim()) || 'Arquivo inválido.';
        toastQuick('Falha ao importar.', msg);
      }
    });
  }
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
  syncPlasmaControls();
}

function togglePlasma(target){
  // Se já está ativo nesse alvo, encerra.
  if(state.effects.plasma && state.effects.plasma.target === target){
    state.effects.plasma = null;
    log(`Plasma encerrado em ${target}.`);
    renderEffects();
    return;
  }

  // Custo prático (do texto): PF 8. JSON também marca PVO 1 como auto_cost.
  if(!spend("PF", 8)) return;
  if(!spend("PVO", 1)) return;

  const dur = evalExpr("1d4+1", ctx).total;
  state.effects.plasma = { target, rounds: dur, resNotified: false };

  // regra: substitui sanguenta no mesmo alvo
  if(state.effects.sanguenta && state.effects.sanguenta.target === target){
    state.effects.sanguenta = null;
  }

  log(`Plasma ativado em ${target} por ${dur} rodadas (+1d12). Lembrete: escolha 1 resistência para ignorar.`);
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
  }if(state.effects.plasma){
  state.effects.plasma.rounds--;
  if(state.effects.plasma.rounds <= 0){
    log("Plasma expirou.");
    state.effects.plasma = null;
  }
}



  if(state.effects.aura){
    state.effects.aura.rounds--;
    if(state.effects.aura.rounds <= 0){
      log("Aura Defensiva expirou.");
      state.effects.aura = null;
    }
  }
  render();
  log("Nova rodada: PVO/PVD restaurados.");
}

function startTurn(){
  // Sem aumentar rodada: só restaura ações (útil quando você quer usar "rodada" como contador global)
  state.pvo = MAX.pvo;
  state.pvd = MAX.pvd;

  // Shadowheart: manutenção de efeitos por turno
  if(state.weapon?.currentId === "serravento" && state.weapon?.modes?.serravento_on){
    const t = Number(state.weapon.modes.serravento_turns || 0);
    if(t > 0){
      const self = evalExpr("1d6", ctx);
      state.ps = Math.max(0, Number(state.ps||0) - Number(self.total||0));
      state.weapon.modes.serravento_turns = t - 1;
      log(`Serravento: desgaste ${self.detail} → -${fmtNumber(self.total)} PS (restam ${state.weapon.modes.serravento_turns} turno(s)).`);
      if(state.weapon.modes.serravento_turns <= 0){
        state.weapon.modes.serravento_on = false;
        log("Serravento: efeito encerrado (motosserra desligada).");
      }
    }
  }

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


// ------------------------------
// Shadowheart Arsenal (armas invocadas) + alvo infernal toggle
// ------------------------------
const SHADOWHEART_WEAPONS = {
  personificacao: {
    id: "personificacao",
    name: "Personificação (Espada Longa)",
    // Categoria de perícia varia pelo estilo do usuário (ver controles extras no painel)
    skill: "Armas Avançadas",
    critMin: 20,
    // Dano base atualizado pelo mestre: 3d10 + 1/4 Destreza
    damageExpr: "3d10 + @attributes.Destreza.quarter",
    notes: [
      "Espada lendária dos ShadowHeart, ligada ao sangue da família.",
      "A lâmina reage à presença de energia em ambientes corrompidos.",
      "O potencial verdadeiro é desconhecido e pode se revelar com o tempo.",
      "A arma parece crescer junto ao portador, adaptando-se ao estilo."
    ]
  },

  lamento: {
    id: "lamento",
    name: "Lamento da Última Aurora (Foice)",
    skill: "Armas Avançadas",
    critMin: 20,
    damageExpr: "2d12 + @attributes.Arcano.quarter",
    activation: { pv: 1, pf: 5, label: "Ceifar essência" },
    notes: ["Dano verdadeiro à essência.", "Ao alvo chegar em 50% vida: desvantagem em ataques (Exaustão Infernal)."]
  },

  gemeas: {
    id: "gemeas",
    name: "Gêmeas do Eclipse (Pistolas Duplas)",
    skill: "Pontaria",
    critMin: 20,
    damageExpr: "1d8 + @attributes.Destreza.quarter",
    modes: { adapted: false },
    adaptedCost: { pv: 1, pf: 3 }, // por disparo adaptado (além do disparo normal)
    notes: ["Após acertar as duas 1x no mesmo alvo, pode ativar 'Adaptado' manualmente."]
  },

  hekaton: {
    id: "hekaton",
    name: "Fúria de Hekatôn (Machado Gigante)",
    skill: "Armas Pesadas",
    critMin: 16,
    damageExpr: "3d12 + @attributes.Forca.quarter",
    activation: { pv: 1, pf: 6, label: "Golpe brutal" },
    notes: ["Ignora resistência de infernais.", "Crítico 16–20 (efeitos narrativos: desmembrar em crítico)."]
  },

  serpente: {
    id: "serpente",
    name: "Serpente de Ferro (Adaga/Corrente)",
    skill: "Armas Leves",
    critMin: 20,
    modes: { range: "curta" }, // curta | longa
    damageExprShort: "1d12 + @attributes.Destreza.quarter",
    damageExprLong: "1d6 + @attributes.Destreza.quarter",
    flame: { pv: 1, pf: 3, extraExpr: "1d4 + @attributes.Arcano.quarter", label: "Chamas Carmesins" },
    notes: ["Longa distância até 9m.", "Queimadura contínua (1 turno para apagar, narrativo)."]
  },

  voto: {
    id: "voto",
    name: "Voto de Andrakar (Escudo/Lança)",
    skill: "Armas Avançadas",
    critMin: 20,
    modes: { form: "escudo" }, // escudo | lanca
    transform: { pv: 1, pf: 0, label: "Transformar" },
    shield: {
      tempHp: 20,
      regen: "1d4/turno (se danificado)",
      blockExpr: "2d6 + @attributes.Arcano.quarter",
      maintenance: { pv: 2, pf: 5, label: "Manutenção defensiva" }
    },
    spear: {
      damageExpr: "2d12 + @attributes.Destreza.quarter",
      shotExtraExpr: "1d6",
      shotCost: { pv: 0, pf: 3, label: "Disparo de energia" }
    },
    notes: ["Modo Escudo: vida temporária 20 (regenera em 1d4/turno se danificada).", "Modo Lança: pode disparar energia (1d6 extra, custo PF)."]
  },

  garras: {
    id: "garras",
    name: "Garras do Vazio (Manopla)",
    skill: "Armas Avançadas",
    critMin: 20,
    damageExpr: "2d6 + @attributes.Destreza.quarter",
    activation: { pv: 1, pf: 8, label: "Ativar lâminas (3 turnos)" },
    notes: ["Dilacerar: 25% (d20 15–20) aplica 1 nível de sangramento (narrativo).",
            "Contra infernais: regenera o dano total como vida (vampirismo).",
            "Agilidade Predatória: +2 Destreza por 2 turnos seguidos (acumula até +6, rastrear manual)."]
  },

  serravento: {
    id: "serravento",
    name: "Serravento Carmesim (Espada Motosserra)",
    skill: "Armas Pesadas",
    critMin: 20,
    modes: { on: false, turns: 0 },
    damageExprOff: "2d10 + @attributes.Forca.quarter",
    damageExprOn: "3d10 + @attributes.Forca.quarter",
    activation: { pv: 2, pf: 5, label: "Ativar (2 turnos)" },
    upkeepSelfDmg: "1d6",
    notes: ["Ligada: sangramento por golpe (narrativo).", "Frenesi infernal: vantagem vs alvo atingido (narrativo).", "Enquanto ligada: 1d6 dano em você por turno."]
  },

  ruina: {
    id: "ruina",
    name: "Ruína dos Jurados (Martelo 2M)",
    skill: "Armas Pesadas",
    critMin: 17,
    damageExpr: "3d8 + @attributes.Forca.quarter",
    activation: { pv: 2, pf: 6, label: "Golpe devastador" },
    notes: ["Ignora resistência física e bloqueios/defesas ativas de infernais.", "Crítico 17–20 (crítico pode fraturar membro, teste Fort CD 15 + Força, narrativo)."]
  },

  sentenca: {
    id: "sentenca",
    name: "Sentença dos Caídos (Espada Colossal)",
    skill: "Armas Pesadas",
    critMin: 20,
    damageExpr: "2d12 + @attributes.Forca.quarter",
    activation: { pv: 1, pf: 4, label: "Ataque" },
    notes: ["Infernais: teste Sabedoria CD 15 ou amedrontado 1 turno; em crítico dura 1d4 (narrativo)."]
  },

  noctaris: {
    id: "noctaris",
    name: "Luz de Noctaris (Espada curta)",
    skill: "Armas Avançadas",
    critMin: 20,
    damageExpr: "1d10 + @attributes.Destreza.quarter",
    activation: { pv: 1, pf: 2, label: "Ataque" },
    notes: ["A cada acerto vs mesmo tipo: +1d4 (rastreamento manual). Após 3 acertos: explosão 2d6 (manual)."]
  }
};

function currentWeapon(){
  return SHADOWHEART_WEAPONS[state.weapon?.currentId] || SHADOWHEART_WEAPONS.personificacao;
}

function weaponAttackSkillName(w){
  if(!w) return "—";
  if(w.id === "personificacao"){
    const style = String(state.weapon?.modes?.personificacao_style || "avancadas");
    return (style === "pesadas") ? "Armas Pesadas" : "Armas Avançadas";
  }
  return w.skill;
}

function spendPV(amount){
  if(!amount) return true;
  const pool = (state.weapon?.pvPool === "pvd") ? "pvd" : "pvo";
  if(state[pool] < amount){
    toastQuick("Sem PV", `Falta PV (${pool.toUpperCase()})`);
    return false;
  }
  state[pool] -= amount;
  return true;
}
function spendPF(amount){
  if(!amount) return true;
  if(state.pf < amount){
    toastQuick("Sem PF", "Falta PF");
    return false;
  }
  state.pf -= amount;
  return true;
}
function spendCosts(cost){
  if(!cost) return true;
  const pv = Number(cost.pv||0);
  const pf = Number(cost.pf||0);
  if(!spendPV(pv)) return false;
  if(!spendPF(pf)){ // rollback PV if PF fails
    const pool = (state.weapon?.pvPool === "pvd") ? "pvd" : "pvo";
    state[pool] += pv;
    return false;
  }
  return true;
}

function weaponDamageExpr(w){
  // retorna a expressão base de dano do modo atual
  if(w.id === "serpente"){
    const range = state.weapon?.modes?.serpente_range || "curta";
    return (range === "longa") ? w.damageExprLong : w.damageExprShort;
  }
  if(w.id === "voto"){
    const form = state.weapon?.modes?.voto_form || "escudo";
    if(form === "lanca") return w.spear.damageExpr;
    // modo escudo não tem dano padrão
    return "";
  }
  if(w.id === "serravento"){
    const on = !!state.weapon?.modes?.serravento_on;
    return on ? w.damageExprOn : w.damageExprOff;
  }
  return String(w.damageExpr || "");
}

function rollWeaponAttack(){
  const w = currentWeapon();
  const atkSkillName = weaponAttackSkillName(w);
  const skill = lookupSkill(atkSkillName);
  const mod = Number(skill?.total ?? 0);

  // modo de rolagem escolhido na UI
  const uiMode = String(document.getElementById("weaponMode")?.value || "normal");
  let mode = uiMode;

  // vantagem automática contra infernal (se não estiver forçando desvantagem)
  if(state.infernalTarget && uiMode === "normal"){
    mode = "adv";
  }

  const res = rollD20WithMode(mod, mode);
  const d20 = res?.chosen ?? null;
  const critMin = Number(w.critMin || 20);
  const critTxt = (d20 !== null && d20 >= critMin) ? " — **CRÍTICO!**" : "";
  const modeTxt = (mode === "adv") ? " (vantagem)" : (mode === "dis") ? " (desvantagem)" : "";

  log(`Acerto (${w.name}) — ${w.skill}${modeTxt}\n${res.detail} + ${fmtNumber(mod)} = ${fmtNumber(res.total)}${critTxt}`);
  showCombatResultBanner({
    name: w.name,
    label: `Acerto${mode !== 'normal' ? ` (${modeLabel(mode)})` : ''}`,
    total: res.total,
    detail: `${w.skill}${modeTxt}\n${res.detail} + ${fmtNumber(mod)} = ${fmtNumber(res.total)}${critTxt.replaceAll('**','')}`
  });
  return res;
}

function rollWeaponDamage(opts = {}){
  const w = currentWeapon();

  let base = weaponDamageExpr(w);
  if(!base){
    toastQuick("Sem dano", "Esta forma não possui dano base.");
    return null;
  }

  // custos por ataque (quando existirem)
  if(opts.cost && !spendCosts(opts.cost)) return null;

  // modos especiais
  const notes = [];
  if(w.id === "gemeas" && !!state.weapon?.modes?.gemeas_adapted){
    notes.push("Adaptado (fraqueza)");
  }
  if(w.id === "serravento" && !!state.weapon?.modes?.serravento_on){
    notes.push("Motosserra ligada");
  }
  if(w.id === "serpente"){
    const range = state.weapon?.modes?.serpente_range || "curta";
    notes.push(`Alcance: ${range}`);
  }
  if(w.id === "voto"){
    const form = state.weapon?.modes?.voto_form || "escudo";
    notes.push(`Forma: ${form}`);
  }

  const target = state.infernalTarget ? "infernal" : (state.target || "alvo");
  const out = damageFor(target, base);

  if(opts.extraExpr){
    // dano adicional (ex: queimadura / disparo de energia)
    const extra = damageFor(target, opts.extraExpr);
    log(`Extra (${w.name}): ${extra.detail}`);
    out.total += extra.total;
  }

  if(notes.length){
    log(`Notas (${w.name}): ${notes.join(", ")}`);
  }

  showCombatResultBanner({
    name: w.name,
    label: 'Dano',
    total: out.total,
    detail: out.detail
  });
  render();
  return out;
}


function damageFor(target, baseExpr){
  let totalExpr = baseExpr;
  const notes = [];

  // ==============================
  // PASSIVA — Bônus fixo de dano
  // "Adiciona ¼ de um atributo à sua escolha em todas as jogadas de dano"
  // Escolha do personagem neste site: Destreza.
  // Importante: se a fórmula do dano JÁ tiver +¼ Destreza (ex.: armas do arsenal),
  // não somar de novo para não duplicar o bônus.
  const passiveQuarterAttrToken = "@attributes.Destreza.quarter";
  const passiveQuarterAttrExpr = `+${passiveQuarterAttrToken}`;
  const alreadyHasQuarter = String(totalExpr).includes(passiveQuarterAttrToken);
  if(!alreadyHasQuarter){
    totalExpr += passiveQuarterAttrExpr;
    notes.push("Passiva: +¼ Destreza");
  }else{
    notes.push("Passiva: +¼ Destreza (já incluído)");
  }

  // PASSIVAS — Caça Infernal (Shadowheart)
  if(state.infernalTarget){
    // vantagem é aplicada nos acertos (rolagens de ataque) no painel de arma.
    // aqui aplico o bônus de dano extra contra alvo infernal.
    if(state.infernalExtraDamageDie){
      totalExpr = addDiceToFirstDiceTerm(totalExpr, 1);
      notes.push('Infernal: +1 dado');
    }
  }


  // bônus global de dano (mantive como 2 para não mudar o que você já estava usando)
  totalExpr = addDiceToFirstDiceTerm(totalExpr, state.globalDamageBonusDice);
  if(state.globalDamageBonusDice) notes.push(`Essência +${state.globalDamageBonusDice} dado(s)`);

  if(state.effects.sanguenta && state.effects.sanguenta.target === target){
    totalExpr += "+1d8";
    notes.push("Sanguenta");
  }
  if(state.effects.plasma && state.effects.plasma.target === target){
    totalExpr += "+1d12";
    const flag = state.effects.plasma.resNotified ? "✓ resistência avisada" : "⚠ definir resistência";
    notes.push(`Plasma (+1d12, ignora 1 resistência) — ${flag}`);
  }

  const res = evalExpr(totalExpr, ctx);
  const line = `${res.detail}${notes.length ? " | " + notes.join(", ") : ""}`;
  log(line);
  return { expr: totalExpr, total: res.total, detail: line, notes };
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
  if(!ul) return;
  ul.innerHTML = "";

  const add = (txt, actions = []) => {
    const li = document.createElement("li");
    li.className = "effectItem";

    const main = document.createElement("div");
    main.className = "effectMain";
    main.textContent = txt;
    li.appendChild(main);

    if(actions.length){
      const row = document.createElement("div");
      row.className = "effectActions";
      actions.forEach(a => {
        const btn = document.createElement("button");
        btn.className = "btn btn-ghost btn-xs";
        btn.textContent = a.label;
        if(a.title) btn.title = a.title;
        btn.onclick = a.onClick;
        row.appendChild(btn);
      });
      li.appendChild(row);
    }

    ul.appendChild(li);
  };

  let any = false;

  if(state.effects.aura){
    any = true;
    add(`Aura Defensiva (${state.effects.aura.rounds} rodadas)`, [
      { label: "Defesa", title: "Rolar defesa da aura", onClick: () => rollAuraDefense() },
      { label: "Encerrar", title: "Encerrar aura", onClick: () => endAura() }
    ]);
  }

  if(state.effects.sanguenta){
    any = true;
    add(`Sanguenta em ${state.effects.sanguenta.target} (${state.effects.sanguenta.rounds} rodadas)`, [
      { label: "Encerrar", title: "Remover efeito", onClick: () => { state.effects.sanguenta = null; log("Arma Sanguenta encerrada."); render(); } }
    ]);
  }
  if(state.effects.plasma){
    any = true;
    const flag = state.effects.plasma.resNotified ? "✓ resistência avisada" : "⚠ resistência não avisada";
    add(`Plasma em ${state.effects.plasma.target} (${state.effects.plasma.rounds} rodadas) — ${flag}`, [
      { label: "Encerrar", title: "Remover efeito", onClick: () => { state.effects.plasma = null; log("Plasma encerrado."); render(); } },
      { label: state.effects.plasma.resNotified ? "Aviso: ON" : "Aviso: OFF", title: "Lembrete: já avisou ao mestre qual resistência será ignorada?", onClick: () => {
          state.effects.plasma.resNotified = !state.effects.plasma.resNotified;
          log(state.effects.plasma.resNotified ? "Plasma: resistência escolhida foi avisada ao mestre." : "Plasma: lembrete reiniciado (resistência ainda não avisada).");
          render();
        } }
    ]);
  }

  if(!any){
    add("—");
  }

function syncPlasmaControls(){
  const btn = document.getElementById("toggle_plasma");
  const rem = document.getElementById("plasma_res_notified");

  if(btn){
    if(state.effects.plasma){
      btn.textContent = `Plasma ativo (${state.effects.plasma.rounds}r) — Encerrar`;
    }else{
      btn.textContent = "Arma de Plasma (Ativar 1d4+1)";
    }
  }

  if(rem){
    const active = !!state.effects.plasma;
    rem.disabled = !active;
    const flag = (active && state.effects.plasma.resNotified) ? "ON" : "OFF";
    rem.textContent = `Aviso resistência: ${flag}`;
  }
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

  // Shadowheart Arsenal panel (arma atual + alvo infernal)
  const arsenal = document.createElement("div");
  arsenal.className = "action arsenalPanel";

  const w = currentWeapon();
  const weaponOptions = Object.values(SHADOWHEART_WEAPONS)
    .map(x => `<option value="${x.id}">${x.name}</option>`).join("");

  arsenal.innerHTML = `
    <div class="titleRow">
      <div class="title">
        <span class="emoji">🗡️</span>
        <span>Arsenal Shadowheart</span>
      </div>
      <div class="tools">
        <label class="chip">
          <span class="chipLabel">Alvo infernal</span>
          <input id="infernalToggle" type="checkbox" ${state.infernalTarget ? "checked" : ""} />
        </label>
      </div>
    </div>

    <div class="arsenalGrid">
      <div class="field">
        <label class="muted">Arma atual</label>
        <select id="weaponSelect" class="input">
          ${weaponOptions}
        </select>
      </div>

      <div class="field">
        <label class="muted">Modo d20</label>
        <select id="weaponMode" class="input">
          <option value="normal">Normal</option>
          <option value="adv">Vantagem</option>
          <option value="dis">Desvantagem</option>
        </select>
      </div>

      <div class="field">
        <label class="muted">PV gasto (ações)</label>
        <select id="pvPoolSelect" class="input">
          <option value="pvo">PVO (ataque)</option>
          <option value="pvd">PVD (reação)</option>
        </select>
      </div>

      <div class="field">
        <label class="muted">Regras rápidas</label>
        <div class="miniNotes">
          <div>• Vantagem vs infernais (auto no acerto quando modo=Normal)</div>
          <div>• +1 dado de dano vs infernais (toggle)</div>
          <div>• +¼ Destreza em todo dano (passiva global)</div>
        </div>
      </div>
    </div>

    <div class="row gap">
      <button id="weaponAttackBtn" class="btn btn-primary">Acerto (${w.skill})</button>
      <button id="weaponDamageBtn" class="btn">Dano</button>
      <button id="weaponActivationBtn" class="btn btn-ghost" ${w.activation ? "" : "disabled"}>${w.activation ? `Ativar: ${w.activation.label} (-${w.activation.pv} PV, -${w.activation.pf} PF)` : "Sem ativação"}</button>
    </div>

    <div id="weaponExtraControls" class="weaponExtraControls"></div>
    <div class="muted weaponNotes" id="weaponNotes"></div>
  `;
  root.appendChild(arsenal);

  // set selects to state
  const weaponSelect = arsenal.querySelector("#weaponSelect");
  const weaponMode = arsenal.querySelector("#weaponMode");
  const pvPoolSelect = arsenal.querySelector("#pvPoolSelect");

  weaponSelect.value = state.weapon?.currentId || "personificacao";
  weaponMode.value = String(state.weapon?.d20Mode || "normal");
  pvPoolSelect.value = String(state.weapon?.pvPool || "pvo");

  function renderWeaponExtras(){
    const w = currentWeapon();
    const extra = arsenal.querySelector("#weaponExtraControls");
    const notes = arsenal.querySelector("#weaponNotes");

    // update main buttons labels
    const atkSkillName = weaponAttackSkillName(w);
    arsenal.querySelector("#weaponAttackBtn").textContent = `Acerto (${atkSkillName}${(state.infernalTarget ? " • infernal" : "")})`;

    // damage button label can show mode info
    const dmgExpr = weaponDamageExpr(w);
    arsenal.querySelector("#weaponDamageBtn").textContent = dmgExpr ? `Dano (${dmgExpr})` : "Dano (—)";

    const actBtn = arsenal.querySelector("#weaponActivationBtn");
    if(w.activation){
      actBtn.disabled = false;
      actBtn.textContent = `Ativar: ${w.activation.label} (-${w.activation.pv} PV, -${w.activation.pf} PF)`;
    }else{
      actBtn.disabled = true;
      actBtn.textContent = "Sem ativação";
    }

    // notes
    const lines = (w.notes || []).map(s => `• ${s}`).join("<br/>");
    notes.innerHTML = lines || "";

    // extra controls by weapon
    let html = "";

    if(w.id === "personificacao"){
      const style = String(state.weapon?.modes?.personificacao_style || "avancadas");
      html += `
        <div class="row gap">
          <div class="field" style="min-width:240px">
            <label class="muted">Estilo de combate (Personificação)</label>
            <select id="personificacaoStyle" class="input">
              <option value="avancadas">Armas Avançadas (Destreza)</option>
              <option value="pesadas">Armas Pesadas (Força)</option>
            </select>
          </div>
        </div>
      `;
      // keep UI in sync after injection
      setTimeout(()=>{ const el = extra.querySelector("#personificacaoStyle"); if(el) el.value = style; }, 0);
    }

    if(w.id === "gemeas"){
      const adapted = !!state.weapon?.modes?.gemeas_adapted;
      html += `
        <div class="row gap">
          <label class="chip">
            <span class="chipLabel">Disparo adaptado</span>
            <input id="gemeasAdapted" type="checkbox" ${adapted ? "checked" : ""}/>
          </label>
          <button id="gemeasShotBtn" class="btn">Disparo (dano)</button>
        </div>
        <div class="muted">Quando "adaptado" estiver ligado: cada disparo adaptado custa +${w.adaptedCost.pv} PV e +${w.adaptedCost.pf} PF.</div>
      `;
    }
    if(w.id === "serpente"){
      const range = state.weapon?.modes?.serpente_range || "curta";
      html += `
        <div class="row gap">
          <label class="muted">Alcance:</label>
          <select id="serpenteRange" class="input">
            <option value="curta">Curta (1d12)</option>
            <option value="longa">Longa 9m (1d6)</option>
          </select>
          <button id="serpenteHitBtn" class="btn">Ataque (dano)</button>
          <button id="serpenteFlameBtn" class="btn btn-ghost">Ataque flamejante (-${w.flame.pv} PV, -${w.flame.pf} PF)</button>
        </div>
      `;
    }
    if(w.id === "voto"){
      const form = state.weapon?.modes?.voto_form || "escudo";
      html += `
        <div class="row gap">
          <label class="muted">Forma:</label>
          <select id="votoForm" class="input">
            <option value="escudo">Escudo</option>
            <option value="lanca">Lança</option>
          </select>
          <button id="votoTransformBtn" class="btn btn-ghost">Transformar (-${w.transform.pv} PV)</button>
        </div>
      `;
      if(form === "escudo"){
        html += `
          <div class="row gap">
            <button id="votoBlockBtn" class="btn">Bloquear (rolar ${w.shield.blockExpr})</button>
            <button id="votoMaintBtn" class="btn btn-ghost">Manutenção (-${w.shield.maintenance.pv} PV, -${w.shield.maintenance.pf} PF)</button>
          </div>
          <div class="muted">Vida temporária: ${w.shield.tempHp} (regen: ${w.shield.regen}).</div>
        `;
      }else{
        html += `
          <div class="row gap">
            <button id="votoSpearHitBtn" class="btn">Ataque (dano)</button>
            <button id="votoShotBtn" class="btn btn-ghost">Disparo (+${w.spear.shotExtraExpr} extra, -${w.spear.shotCost.pf} PF)</button>
          </div>
        `;
      }
    }
    if(w.id === "serravento"){
      const on = !!state.weapon?.modes?.serravento_on;
      const turns = Number(state.weapon?.modes?.serravento_turns || 0);
      html += `
        <div class="row gap">
          <label class="chip">
            <span class="chipLabel">Ligada</span>
            <input id="serraventoOn" type="checkbox" ${on ? "checked" : ""}/>
          </label>
          <button id="serraventoHitBtn" class="btn">Ataque (dano)</button>
          <button id="serraventoActBtn" class="btn btn-ghost">Ativar 2 turnos (-${w.activation.pv} PV, -${w.activation.pf} PF)</button>
          <span class="muted">Turnos restantes: ${turns}</span>
        </div>
        <div class="muted">Enquanto ligada: você toma ${w.upkeepSelfDmg} por turno (aplico ao clicar em "Iniciar Turno").</div>
      `;
    }
    extra.innerHTML = html;

    // bind extra listeners

    if(w.id === "personificacao"){
      extra.querySelector("#personificacaoStyle")?.addEventListener("change", (e)=>{
        state.weapon = state.weapon || {};
        state.weapon.modes = state.weapon.modes || {};
        state.weapon.modes.personificacao_style = String(e.target.value || "avancadas");
        saveState();
        renderCombatActions();
      });
    }
    if(w.id === "gemeas"){
      extra.querySelector("#gemeasAdapted")?.addEventListener("change", (e)=>{
        state.weapon.modes.gemeas_adapted = !!e.target.checked;
        saveState(); renderWeaponExtras();
      });
      extra.querySelector("#gemeasShotBtn")?.addEventListener("click", ()=>{
        const cost = state.weapon?.modes?.gemeas_adapted ? w.adaptedCost : null;
        rollWeaponDamage({ cost });
        saveState(); render();
      });
    }
    if(w.id === "serpente"){
      const sel = extra.querySelector("#serpenteRange");
      if(sel){
        sel.value = range;
        sel.addEventListener("change",(e)=>{
          state.weapon.modes.serpente_range = e.target.value;
          saveState(); renderWeaponExtras();
        });
      }
      extra.querySelector("#serpenteHitBtn")?.addEventListener("click", ()=>{ rollWeaponDamage(); saveState(); render(); });
      extra.querySelector("#serpenteFlameBtn")?.addEventListener("click", ()=>{
        rollWeaponDamage({ cost: w.flame, extraExpr: w.flame.extraExpr });
        saveState(); render();
      });
    }
    if(w.id === "voto"){
      const formSel = extra.querySelector("#votoForm");
      if(formSel){
        formSel.value = form;
        formSel.addEventListener("change",(e)=>{
          state.weapon.modes.voto_form = e.target.value;
          saveState(); renderWeaponExtras();
        });
      }
      extra.querySelector("#votoTransformBtn")?.addEventListener("click", ()=>{
        if(spendCosts(w.transform)){
          const cur = state.weapon.modes.voto_form || "escudo";
          state.weapon.modes.voto_form = (cur === "escudo") ? "lanca" : "escudo";
          log(`Voto de Andrakar: forma → ${state.weapon.modes.voto_form}`);
          saveState(); renderWeaponExtras(); render();
        }
      });
      extra.querySelector("#votoBlockBtn")?.addEventListener("click", ()=>{
        const target = state.infernalTarget ? "infernal" : (state.target || "alvo");
        const out = damageFor(target, w.shield.blockExpr); // reuse damageFor for rolagem de redução
        log(`Bloqueio (${w.name}): ${out.detail}`);
        showCombatResultBanner({
          name: w.name,
          label: 'Bloqueio',
          total: out.total,
          detail: out.detail
        });
      });
      extra.querySelector("#votoMaintBtn")?.addEventListener("click", ()=>{
        if(spendCosts(w.shield.maintenance)){
          log(`Manutenção defensiva (${w.name}) aplicada.`);
          saveState(); render();
        }
      });
      extra.querySelector("#votoSpearHitBtn")?.addEventListener("click", ()=>{ rollWeaponDamage(); saveState(); render(); });
      extra.querySelector("#votoShotBtn")?.addEventListener("click", ()=>{
        rollWeaponDamage({ cost: w.spear.shotCost, extraExpr: w.spear.shotExtraExpr });
        saveState(); render();
      });
    }
    if(w.id === "serravento"){
      extra.querySelector("#serraventoOn")?.addEventListener("change",(e)=>{
        state.weapon.modes.serravento_on = !!e.target.checked;
        saveState(); renderWeaponExtras();
      });
      extra.querySelector("#serraventoHitBtn")?.addEventListener("click", ()=>{ rollWeaponDamage(); saveState(); render(); });
      extra.querySelector("#serraventoActBtn")?.addEventListener("click", ()=>{
        if(spendCosts(w.activation)){
          state.weapon.modes.serravento_on = true;
          state.weapon.modes.serravento_turns = 2;
          log(`Serravento Carmesim ativada por 2 turnos.`);
          saveState(); renderWeaponExtras(); render();
        }
      });
    }
  }

  renderWeaponExtras();

  arsenal.querySelector("#infernalToggle")?.addEventListener("change", (e)=>{
    state.infernalTarget = !!e.target.checked;
    saveState(); renderCombatActions(); render();
  });

  weaponSelect.addEventListener("change", (e)=>{
    state.weapon.currentId = e.target.value;
    // init mode defaults
    state.weapon.modes = state.weapon.modes || {};
    saveState();
    renderCombatActions();
  });

  weaponMode.addEventListener("change", (e)=>{
    state.weapon.d20Mode = e.target.value;
    saveState();
  });

  pvPoolSelect.addEventListener("change", (e)=>{
    state.weapon.pvPool = e.target.value;
    saveState();
  });

  arsenal.querySelector("#weaponAttackBtn")?.addEventListener("click", ()=>{
    rollWeaponAttack();
    saveState();
    render();
  });

  arsenal.querySelector("#weaponDamageBtn")?.addEventListener("click", ()=>{
    rollWeaponDamage();
    saveState();
    render();
  });

  arsenal.querySelector("#weaponActivationBtn")?.addEventListener("click", ()=>{
    const w = currentWeapon();
    if(!w.activation) return;
    if(spendCosts(w.activation)){
      log(`Ativação (${w.name}): ${w.activation.label} (-${w.activation.pv} PV, -${w.activation.pf} PF)`);
      // efeitos persistentes simples
      if(w.id === "serravento"){
        state.weapon.modes.serravento_on = true;
        state.weapon.modes.serravento_turns = 2;
      }
      saveState(); renderCombatActions(); render();
    }
  });


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

    // Favoritos (Etapa 17)
    const favToken = tokenForCombatAction(action);
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    title.appendChild(spacer);

    const favBtn = document.createElement('button');
    favBtn.className = 'favBtn';
    favBtn.setAttribute('data-fav-token', favToken);
    favBtn.title = 'Fixar nos Favoritos (atalhos 1-9)';
    const paintFav = () => {
      const on = isFavorite(favToken);
      favBtn.textContent = on ? '★' : '☆';
      favBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    };
    paintFav();
    favBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleFavorite(favToken);
      paintFav();
    });
    title.appendChild(favBtn);

    wrap.appendChild(title);

    const rollsRow = document.createElement("div");
    rollsRow.className = "rolls";

    // Optional weapon base damage input
    let weaponInput = null;
    if(action.ui && action.ui.weapon_damage_input){
      weaponInput = document.createElement("input");
      weaponInput.type = "text";
      const defBase = String(action.ui.weapon_damage_default || action.ui.weapon_damage_input?.default || "2d6");
      const saved = String(state.ui.weaponBases?.[favToken] || '').trim();
      weaponInput.value = saved || defBase;
      weaponInput.placeholder = defBase;
      weaponInput.title = "Dano base da arma (ex: 2d6)";
      weaponInput.addEventListener('change', () => {
        const v = String(weaponInput.value || '').trim();
        state.ui.weaponBases = state.ui.weaponBases || {};
        state.ui.weaponBases[favToken] = v;
        saveState();
      });
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
            if(!spend(k, v)) { window.__sfx?.play?.('error'); render(); return; }
          }
        }

        const label = String(r.label || 'Rolar');

        // For damage, apply modifiers
        if(label.toLowerCase().includes("dano")){
          const out = damageFor(targetKey, r.expr);
          showCombatResultBanner({ name: action.name, label, total: out?.total, detail: out?.detail });
          try{ window.__sfx?.play?.('hit'); }catch(_){ }
        } else {
          const res = evalExpr(r.expr, ctx);
          log(`${action.name} — ${label}: ${res.detail}`);
          showCombatResultBanner({ name: action.name, label, total: res.total, detail: res.detail });
          try{ window.__sfx?.play?.('roll'); }catch(_){ }
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
        const out = damageFor(targetKey, expr);
        showCombatResultBanner({ name: action.name, label: 'Dano', total: out?.total, detail: out?.detail });
        try{ window.__sfx?.play?.('hit'); }catch(_){ }
        render();
      };
      rollsRow.appendChild(dmgBtn);
    }

    wrap.appendChild(rollsRow);
    root.appendChild(wrap);
  });
}

function renderAttrEditor(){
  const root = document.getElementById('attrEditor');
  if(!root) return;
  root.innerHTML = '';

  const list = Array.isArray(character?.attributes) ? character.attributes : [];
  if(!list.length){
    root.innerHTML = '<div class="muted">Sem atributos cadastrados.</div>';
    return;
  }

  if(!state.ui) state.ui = {};
  if(!state.ui.attrOverrides || typeof state.ui.attrOverrides !== 'object') state.ui.attrOverrides = {};

  list.forEach(a0 => {
    const name = String(a0?.name || '').trim();
    if(!name) return;

    const a = (ctx?.attributes?.[name] || ctx?.attributes?.[name.toLowerCase()] || ctx?.attributes?.[deaccent(name)] || a0);
    const row = document.createElement('div');
    row.className = 'attrRow';

    const left = document.createElement('div');
    left.className = 'attrLeft';
    left.innerHTML = `<div class="attrName">${name}</div><div class="muted small">½=${fmtNumber(Number(a?.half))} • ¼=${fmtNumber(Number(a?.quarter))} • 1/8=${fmtNumber(Number(a?.eighth))}</div>`;

    const input = document.createElement('input');
    input.className = 'input input-sm attrInput';
    input.type = 'number';
    input.min = '0';
    input.step = '1';
    input.value = String(Number(a?.value ?? 0));

    input.addEventListener('input', () => {
      state.ui.attrOverrides[name] = clampInt(input.value, 0, 9999);
      rebuildCtx();
      // Atualiza tudo que depende de atributo
      renderSkillsTab();
      renderEssenceUi();
      renderCombatActions(); // textos de alguns botões
      saveState();
      renderAttrEditor();
    });

    row.appendChild(left);
    row.appendChild(input);
    root.appendChild(row);
  });
}

function resetAttrOverrides(){
  if(!state.ui) state.ui = {};
  state.ui.attrOverrides = {};
  rebuildCtx();
  render();
  renderAttrEditor();
  log('Atributos: overrides resetados.');
}

function render(){
  // garante ctx atualizado (caso algo tenha mexido em overrides)
  if(!ctx) rebuildCtx();
  renderTracks();
  renderEffects();
  renderEssenceUi();
  renderEssencePassives();
  renderSkillsTab();
  renderAttrEditor();
  saveState();
}

// ------------------------------
// Init
// ------------------------------
async function init(){
  character = await fetch("data/character.json").then(r => r.json());
  ctx = buildContextFromCharacter(character);

  // Aplica defaults de essência do personagem (se existirem) na 1ª execução
  const dEss = character?.notes?.essence_levels_default;
  if(dEss && typeof dEss === 'object'){
    // só seta se o save não trouxe algo explícito
    if(!state.essence || typeof state.essence !== 'object') state.essence = {};
    state.essence.ev = clampInt(state.essence.ev ?? dEss.ev, 0, 5);
    state.essence.off = clampInt(state.essence.off ?? dEss.off, 0, 5);
    state.essence.def = clampInt(state.essence.def ?? dEss.def, 0, 5);
    state.essence.apt = clampInt(state.essence.apt ?? dEss.apt, 0, 5);
  }


  // Etapa 8 — Perícias
  await loadSkillsCatalog();
  skillIndex = buildSkillIndexFromCharacter(character);

  // Set name + luck
  document.getElementById("charName").textContent = character?.meta?.name || "Personagem";
  document.title = character?.meta?.name || document.title;
  document.getElementById("luck").textContent = character?.stats?.luck ?? "—";

  // Load MAX from character tracks
  const tracks = character?.stats?.tracks || {};
  BASE_MAX = {
    ps: tracks.PS?.max ?? 100,
    pf: tracks.PF?.max ?? 100,
    pvo: tracks.PVO?.max ?? 3,
    pvd: tracks.PVD?.max ?? 4
  };
  MAX = { ...BASE_MAX };

  // Default current from character
  state.ps = tracks.PS?.current ?? MAX.ps;
  state.pf = tracks.PF?.current ?? MAX.pf;
  state.pvo = tracks.PVO?.current ?? MAX.pvo;
  state.pvd = tracks.PVD?.current ?? MAX.pvd;

  // Restore save if exists
  loadState();

  // Rebuild ctx (aplica overrides)
  rebuildCtx();


  // Compat: se veio de um save antigo (PVO=2 / PVD=3 cheios), promove para o novo teto.
  // (Se o jogador já gastou PV e está abaixo disso, mantém.)
  if(state.pvo === 2 && MAX.pvo === 3) state.pvo = MAX.pvo;
  if(state.pvd === 3 && MAX.pvd === 4) state.pvd = MAX.pvd;

  // Etapa 17 — Favoritos
  seedDefaultFavoritesIfNeeded();

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
    state.effects = { sanguenta: null, plasma: null, aura: null };
    log("Novo combate.");
    render();
  };
  document.getElementById("resetAll").onclick = () => {
    resetTracks();
    state.round = 1;
    state.effects = { sanguenta: null, plasma: null, aura: null };
    state.logLines = [];
    log("Reset total.");
    render();
  };

  // Full restore (vida/energia/PV)
  const fullRestoreEl = document.getElementById("fullRestore");
  if(fullRestoreEl){
    fullRestoreEl.onclick = () => { fullRestoreTracks(); };
  }

  // Sorte
  document.getElementById("roll_luck").onclick = () => {
    const mod = Number(character?.stats?.luck ?? 0);
    const mode = (document.getElementById("luckMode")?.value || "normal");
    const res = rollD20WithMode(mod, mode);
    log(`Sorte: ${res.detail}`);
    showResultOverlay({ title: "Sorte", meta: `d20 + ${mod} (${modeLabel(mode)})`, big: `Total: ${res.total}`, detail: res.detail });
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
const plasmaResBtn = document.getElementById("plasma_res_notified");
if(plasmaResBtn){
  plasmaResBtn.onclick = () => {
    if(!state.effects.plasma){
      log("Plasma não está ativo.");
      return;
    }
    state.effects.plasma.resNotified = !state.effects.plasma.resNotified;
    log(state.effects.plasma.resNotified ? "Plasma: resistência escolhida foi avisada ao mestre." : "Plasma: lembrete reiniciado (resistência ainda não avisada).");
    render();
  };
}


  // Atributos (editor)
  const attrReset = document.getElementById('attrReset');
  if(attrReset) attrReset.onclick = () => resetAttrOverrides();

  // Etapa 8 — UI de Perícias
  initSkillsUi();

  // Etapa 10 — Essência
  initEssenceUi();
  loadEssenceBook();

  // Etapa 11 — Builds & Presets
  initBuildsUi();

  // Etapa 16 — Habilidades exclusivas + Equipamentos
  initAbilitiesLibraryUi();

  // Etapa 17 — Favoritos (Quickbar + Hotkeys)
  initFavoritesUi();

  renderCombatActions();
  render();
  renderLog();

  // Expose minimal hooks for UX layer (ui enhancements without mixing with game logic)
  window.__tats = { state, MAX, character, saveState, renderLog, render, log };
  document.dispatchEvent(new CustomEvent("tats-ready"));

}

init();
