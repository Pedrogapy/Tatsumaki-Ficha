// =========
// Tatsumaki RPG Sheet — app.js
// Data-driven (character.json) + local save (localStorage)
// =========

// ------------------------------
// Dice + expression evaluator
// Supports: "1d20 + 2d8 + 6" and references like "@attributes.Força.quarter"
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

function evalExpr(expr, ctx){
  const resolved = resolveRefs(expr, ctx).replace(/\s+/g, "");
  if(!resolved) return { total: 0, detail: "(sem rolagem)" };

  // Split by +/-, keeping sign with term
  const terms = resolved.match(/[+-]?[^+-]+/g) || [];
  let total = 0;
  let pieces = [];

  for(const raw of terms){
    const sign = raw.startsWith("-") ? -1 : 1;
    const term = raw.replace(/^[+-]/, "");
    if(!term) continue;

    // Dice term: NdM
    const dm = term.match(/^(\d+)d(\d+)$/i);
    if(dm){
      const n = Number(dm[1]);
      const s = Number(dm[2]);
      const r = rollDice(n, s);
      total += sign * r.sum;
      pieces.push(`${sign<0? "-": "+"}${n}d${s}=[${r.rolls.join(",")}]→${r.sum}`);
      continue;
    }

    // Number
    const num = Number(term);
    if(!Number.isNaN(num)){
      total += sign * num;
      pieces.push(`${sign<0? "-": "+"}${num}`);
      continue;
    }

    // Unknown garbage -> ignore but show
    pieces.push(`${sign<0? "-": "+"}${term}(?)`);
  }

  const detail = `${expr} => ${pieces.join(" ")} = ${total}`;
  return { total, detail };
}

// Advantage/Disadvantage for d20 checks (used for "Sorte" and future skill checks)
function rollD20WithMode(mod = 0, mode = "normal"){ // mode: normal|adv|dis
  const a = 1 + Math.floor(Math.random()*20);
  const b = 1 + Math.floor(Math.random()*20);
  let chosen = a;
  let extra = "";
  if(mode === "adv"){
    chosen = Math.max(a,b);
    extra = ` (vantagem: ${a},${b} -> ${chosen})`;
  } else if(mode === "dis"){
    chosen = Math.min(a,b);
    extra = ` (desvantagem: ${a},${b} -> ${chosen})`;
  }
  const total = chosen + mod;
  return { total, detail: `1d20${mod? (mod>0?"+":"")+mod:""} => ${chosen}${extra}${mod? ` ${(mod>0?"+":"")}${mod}`:""} = ${total}` };
}

// ------------------------------
// Character + context
// ------------------------------
let character = null;
let ctx = null;

function buildContextFromCharacter(c){
  // Attributes: by display name
  const attributes = {};
  (c.attributes || []).forEach(a => { attributes[a.name] = a; });

  // Skills: by attribute code and skill name key (spaces -> _)
  const skills = {};
  const allGroups = c.skills || {};
  Object.values(allGroups).forEach(arr => {
    (arr || []).forEach(s => {
      const attr = s.attribute;
      if(!skills[attr]) skills[attr] = {};
      const key = (s.name || "").replace(/\s+/g, "_");
      skills[attr][key] = s;
      // also store original name (rarely needed)
      skills[attr][s.name] = s;
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

  logLines: []
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
      logLines: state.logLines
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
    const res = rollD20WithMode(mod, "normal");
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

  renderCombatActions();
  render();
  renderLog();

  // Expose minimal hooks for UX layer (ui enhancements without mixing with game logic)
  window.__tats = { state, MAX, character, saveState, renderLog, render, log };
  document.dispatchEvent(new CustomEvent("tats-ready"));

}

init();
