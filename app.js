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

// Etapa 17 — lista normalizada de habilidades (para Quickbar/Favoritos)
let abilities = [];

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

// Etapa 9 — helpers de UI (resultado destacado + animação + atalhos)
let skillResultTimer = null;
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
  const el = document.getElementById('skillResult');
  if(!el) return;

  const name = payload?.name || 'Perícia';
  const attr = String(payload?.attr || '').toUpperCase();
  const total = payload?.total;
  const mode = payload?.mode || 'normal';
  const detail = payload?.detail || '';

  el.hidden = false;
  el.classList.remove('show');

  // Conteúdo
  el.innerHTML = `
    <div class="srTitle">
      <div class="srName">${name} <span class="muted">[${attr}]</span></div>
      <div class="srMode">${modeLabel(mode)}</div>
    </div>
    <div class="srValue">Resultado: ${fmtNumber(Number(total))}</div>
    <div class="srDetail">${detail}</div>
  `;

  // animação
  requestAnimationFrame(() => el.classList.add('show'));

  // auto-hide
  if(skillResultTimer) clearTimeout(skillResultTimer);
  skillResultTimer = setTimeout(() => {
    el.classList.remove('show');
    el.hidden = true;
  }, 9000);
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

  // Etapa 10 — níveis de Essência (EV/Of/Def/Apt) e preferências
  // Defaults: Tatsumaki (EV3, OF2, DEF1, APT1)
  essence: {
    ev: 3,
    off: 2,
    def: 1,
    apt: 1,
    stackMode: "conservative", // conservative | literal
    defPassiveRes: ""
  },

  effects: {
    sanguenta: null, // {target, rounds}
    plasma: null,    // {target}
    aura: null       // {rounds, dice}
  },

  logLines: [],

  ui: {
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
    stackMode: (e.stackMode === 'literal') ? 'literal' : 'conservative',
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

function renderEssenceUi(){
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
  const todo = [];
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


// Etapa 17 — helpers de habilidades (ids estáveis + favoritos)
function abilityStableId(ab){
  // prefere id fornecido no JSON
  const raw = (ab && (ab.id || ab.key || ab.slug)) ? String(ab.id || ab.key || ab.slug) : String(ab?.name || 'ability');
  return normKey(raw);
}
function getAbilitiesFromCharacter(ch){
  const raw = Array.isArray(ch?.abilities?.exclusive?.abilities) ? ch.abilities.exclusive.abilities : [];
  // Garante id estável em cada habilidade, sem mutar o objeto original (evita efeitos colaterais)
  return raw.map(a => ({ ...a, id: abilityStableId(a) }));
}
function isAbilityFav(abilityId){
  state.ui = state.ui || {};
  state.ui.favAbilities = state.ui.favAbilities || [];
  return state.ui.favAbilities.includes(abilityId);
}
function toggleAbilityFav(abilityId){
  state.ui = state.ui || {};
  state.ui.favAbilities = state.ui.favAbilities || [];
  if(state.ui.favAbilities.includes(abilityId)){
    state.ui.favAbilities = state.ui.favAbilities.filter(x => x !== abilityId);
  }else{
    state.ui.favAbilities.push(abilityId);
  }
  saveState();
}

function renderAbilitiesLibrary(){
  const root = document.getElementById('abilitiesList');
  if(!root) return;
  root.innerHTML = '';

  abilities = getAbilitiesFromCharacter(character);
  const list = abilities;
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

    // ⭐ Favorito (Etapa 17) — aparece na Quickbar do Combate
    const right = document.createElement('div');
    right.className = 'abilityHeaderRight';

    const favBtn = document.createElement('button');
    favBtn.className = 'btn btn-ghost btn-sm favBtn';
    favBtn.title = 'Fixar na barra rápida (Combate)';
    favBtn.textContent = isAbilityFav(ab.id) ? '⭐' : '☆';
    favBtn.onclick = () => {
      toggleAbilityFav(ab.id);
      // Atualiza visuais
      favBtn.textContent = isAbilityFav(ab.id) ? '⭐' : '☆';
      renderQuickbar();
    };

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
    add(`Plasma em ${state.effects.plasma.target} (∞)`, [
      { label: "Encerrar", title: "Desligar plasma", onClick: () => { state.effects.plasma = null; log("Plasma desligado."); render(); } }
    ]);
  }

  if(!any){
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
  renderEssenceUi();
  saveState();
}

// ------------------------------
// Init
// ------------------------------
async function init(){
  character = await fetch("data/character.json").then(r => r.json());
  ctx = buildContextFromCharacter(character);

  // Etapa 17 — cache de habilidades (Quickbar/Favoritos)
  abilities = getAbilitiesFromCharacter(character);

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

  // Etapa 10 — Essência
  initEssenceUi();
  loadEssenceBook();

  // Etapa 11 — Builds & Presets
  initBuildsUi();

  // Etapa 16 — Habilidades exclusivas + Equipamentos
  initAbilitiesLibraryUi();

  renderCombatActions();
  render();
  renderLog();

  // Expose minimal hooks for UX layer (ui enhancements without mixing with game logic)
  window.__tats = { state, MAX, character, saveState, renderLog, render, log };
  document.dispatchEvent(new CustomEvent("tats-ready"));

}

// ===== ETAPA 17 — QUICKBAR =====
state.ui = state.ui || {};
state.ui.favAbilities = state.ui.favAbilities || [];

const quickbarList = document.getElementById("quickbarList");
const combatResult = document.getElementById("combatResult");

function renderQuickbar() {
  if(!quickbarList) return;
  quickbarList.innerHTML = "";
  if (!state.ui.favAbilities.length) {
    quickbarList.innerHTML = "<span class='muted'>Nenhuma habilidade fixada ⭐</span>";
    return;
  }

  state.ui.favAbilities.forEach(id => {
    const ab = abilities.find(a => a.id === id);
    if (!ab) return;

    const card = document.createElement("div");
    card.className = "qcard";

    const title = document.createElement("div");
    title.className = "qcard-title";
    title.textContent = ab.name;
    card.appendChild(title);

    const rolls = document.createElement("div");
    rolls.className = "qcard-rolls";

    (ab.rolls || []).forEach(r => {
      const b = document.createElement("button");
      b.className = "btn btn-sm";
      b.textContent = r.label || "Rolar";
      b.onclick = () => {
        const res = rollExpression(r.expr);
        showCombatResult(ab.name, r.label, res);
      };
      rolls.appendChild(b);
    });

    card.appendChild(rolls);
    quickbarList.appendChild(card);
  });

  saveState();
}

function showCombatResult(title, label, result) {
  if(!combatResult) return;
  combatResult.querySelector(".cr-title").textContent = `${title} — ${label}`;
  combatResult.querySelector(".cr-total").textContent = result.total;
  combatResult.querySelector(".cr-detail").textContent = result.detail;
  combatResult.classList.remove("hidden");
  setTimeout(() => combatResult.classList.add("hidden"), 4000);
}

// Atalhos 1–9
document.addEventListener("keydown", e => {
  if (document.activeElement.tagName === "INPUT") return;
  if (currentTab !== "combat") return;
  const idx = parseInt(e.key) - 1;
  if (idx >= 0 && idx < state.ui.favAbilities.length) {
    const ab = abilities.find(a => a.id === state.ui.favAbilities[idx]);
    if (!ab || !ab.rolls?.length) return;
    const r = ab.rolls[0];
    const res = rollExpression(r.expr);
    showCombatResult(ab.name, r.label, res);
  }
});

renderQuickbar();


init();
