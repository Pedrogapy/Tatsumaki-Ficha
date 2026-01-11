/* Tatsumaki — Ficha Interativa (GitHub Pages)
   - Carrega data/character.json
   - Rola dados (NdM + macros @path)
   - Log com copiar e limpar
   - Tracks editáveis salvos no navegador (localStorage)
*/

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

const STATE_KEY = "tatsumaki_sheet_state_v1";

function safeNow(){
  const d = new Date();
  const pad = (n) => String(n).padStart(2,"0");
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function deepClone(obj){
  return JSON.parse(JSON.stringify(obj));
}

function getByPath(obj, path){
  // path: "skills.physical.Lutar.total"
  const parts = path.split(".").filter(Boolean);
  let cur = obj;
  for(const p of parts){
    if(cur == null) return undefined;
    if(Array.isArray(cur)){
      // allow lookup in arrays by "name": e.g. skills.physical.Lutar.total
      const found = cur.find(x => (x?.name || "").toLowerCase() === p.toLowerCase());
      cur = found;
    }else{
      cur = cur[p];
      if(cur === undefined){
        // allow attributes lookup by name in array
        if(p && typeof cur === "undefined" && Array.isArray(obj?.attributes) && parts[0]==="attributes"){
          // not used
        }
      }
    }
  }
  return cur;
}

function normalizeContext(character){
  // Build a context object friendly to macros:
  // - attributes.<Nome> -> {value, quarter, eighth}
  // - skills.physical.<Nome> -> {total, ...}
  const ctx = deepClone(character);

  ctx.attributes = {};
  for(const a of character.attributes || []){
    ctx.attributes[a.name] = a;
  }

  ctx.skills = {
    physical: [],
    intellectual: []
  };

  // Keep the arrays as-is, but also provide dict-like access via getByPath (array-name lookup)
  ctx.skills.physical = character.skills?.physical || [];
  ctx.skills.intellectual = character.skills?.intellectual || [];

  return ctx;
}

function parseDiceExpression(expr, ctx){
  // Replace macros: @something.something
  let expanded = expr;

  const macroRe = /@([A-Za-zÀ-ÿ0-9_\.\-]+(?:\.[A-Za-zÀ-ÿ0-9_\.\-]+)*)/g;
  expanded = expanded.replace(macroRe, (_, path) => {
    const value = getByPath(ctx, path);
    if(typeof value === "number") return String(value);
    if(typeof value === "boolean") return value ? "1" : "0";
    if(value == null) return "0";
    // try parse numeric string
    const num = Number(value);
    if(!Number.isNaN(num)) return String(num);
    return "0";
  });

  // Evaluate dice terms and keep a breakdown
  const diceRe = /(?<!\w)(\d*)d(\d+)(?!\w)/gi;

  let breakdown = [];
  expanded = expanded.replace(diceRe, (_, a, b) => {
    const n = a ? parseInt(a, 10) : 1;
    const sides = parseInt(b, 10);
    const rolls = [];
    for(let i=0;i<n;i++){
      rolls.push(1 + Math.floor(Math.random()*sides));
    }
    const sum = rolls.reduce((acc,x)=>acc+x,0);
    breakdown.push({ n, sides, rolls, sum });
    return String(sum);
  });

  // Safety: allow only math chars
  const safe = expanded.replace(/\s+/g,"");
  if(!/^[0-9+\-*/().]*$/.test(safe)){
    throw new Error("Expressão inválida (caracteres não permitidos).");
  }

  // Compute
  // eslint-disable-next-line no-new-func
  const total = Function(`"use strict"; return (${safe || "0"});`)();

  return { total, expanded, breakdown };
}

function formatBreakdown(result){
  const parts = [];
  for(const d of result.breakdown || []){
    parts.push(`${d.n}d${d.sides}=[${d.rolls.join(",")}]→${d.sum}`);
  }
  const b = parts.length ? ` | ${parts.join(" ; ")}` : "";
  return `= ${result.total} ( ${result.expanded} )${b}`;
}

function appendLog(line){
  const log = $("#log");
  const prev = log.textContent.trim();
  log.textContent = (prev ? prev + "\n" : "") + line;
  log.scrollTop = log.scrollHeight;
}

function setActiveTab(tabId){
  $$(".tab").forEach(b => {
    const is = b.dataset.tab === tabId;
    b.classList.toggle("active", is);
    b.setAttribute("aria-selected", is ? "true" : "false");
  });
  $$(".panel").forEach(p => p.classList.remove("active"));
  $(`#tab-${tabId}`)?.classList.add("active");
}

function loadState(){
  try{
    const raw = localStorage.getItem(STATE_KEY);
    if(!raw) return {};
    return JSON.parse(raw);
  }catch{
    return {};
  }
}

function saveState(state){
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

function renderTracks(character, state){
  const el = $("#tracks");
  const tracks = character.stats?.tracks || {};
  const keys = Object.keys(tracks);

  el.innerHTML = "";
  if(!keys.length){
    el.innerHTML = `<div class="muted">Sem tracks detectadas no JSON.</div>`;
    return;
  }

  for(const k of keys){
    const base = tracks[k] || {};
    const curKey = `track.${k}.current`;

    const cur = (state?.track?.[k]?.current ?? base.current ?? 0);
    const max = (state?.track?.[k]?.max ?? base.max);
    const temp = (state?.track?.[k]?.temp ?? base.temp ?? 0);

    const row = document.createElement("div");
    row.className = "track";
    row.innerHTML = `
      <div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <div style="font-weight:700">${k}</div>
          ${max != null ? `<span class="badge">máx: <b style="color:var(--text)">${max}</b></span>` : ""}
          <span class="badge">temp: <b style="color:var(--text)">${temp}</b></span>
        </div>
        <div class="small muted">Atual: ${cur}</div>
      </div>
      <div class="trackControls">
        <button class="secondary" data-dec="${k}">-</button>
        <input type="number" inputmode="numeric" value="${cur}" data-input="${k}" />
        <button class="secondary" data-inc="${k}">+</button>
      </div>
    `;

    el.appendChild(row);
  }

  // events
  $$("button[data-inc]", el).forEach(btn => btn.addEventListener("click", () => {
    const k = btn.getAttribute("data-inc");
    state.track ??= {};
    state.track[k] ??= {};
    state.track[k].current = Number(state.track[k].current ?? tracks[k].current ?? 0) + 1;
    saveState(state);
    renderTracks(character, state);
  }));

  $$("button[data-dec]", el).forEach(btn => btn.addEventListener("click", () => {
    const k = btn.getAttribute("data-dec");
    state.track ??= {};
    state.track[k] ??= {};
    state.track[k].current = Number(state.track[k].current ?? tracks[k].current ?? 0) - 1;
    saveState(state);
    renderTracks(character, state);
  }));

  $$("input[data-input]", el).forEach(inp => inp.addEventListener("change", () => {
    const k = inp.getAttribute("data-input");
    const v = Number(inp.value);
    state.track ??= {};
    state.track[k] ??= {};
    state.track[k].current = Number.isFinite(v) ? v : 0;
    saveState(state);
    renderTracks(character, state);
  }));
}

function renderDefenses(character){
  const el = $("#defenses");
  const ac = character.stats?.armor_class?.total;
  const acParts = character.stats?.armor_class?.components || {};
  const perception = character.stats?.perception;
  const luck = character.stats?.luck;

  const rows = [];
  if(ac != null) rows.push({k:"Classe de Armadura", v:String(ac)});
  if(perception != null) rows.push({k:"Percepção", v:String(perception)});
  if(luck != null) rows.push({k:"Sorte", v:String(luck)});

  let html = rows.map(r => `<div class="kv"><div class="k">${r.k}</div><div class="v">${r.v}</div></div>`).join("");

  const partKeys = Object.keys(acParts);
  if(partKeys.length){
    html += `<div style="margin-top:10px" class="small muted">Componentes (CA)</div>`;
    html += `<div style="margin-top:6px">` + partKeys.map(k => {
      return `<span class="badge">${k}: <b style="color:var(--text)">${acParts[k]}</b></span>`;
    }).join(" ") + `</div>`;
  }

  el.innerHTML = html || `<div class="muted">Sem dados.</div>`;
}

function renderAttributes(character){
  const el = $("#attributes");
  const attrs = character.attributes || [];
  if(!attrs.length){
    el.innerHTML = `<div class="muted">Sem atributos.</div>`;
    return;
  }

  const rows = attrs.map(a => `
    <tr>
      <td><b>${escapeHtml(a.name)}</b></td>
      <td>${a.value ?? ""}</td>
      <td>${a.quarter ?? ""}</td>
      <td>${a.eighth ?? ""}</td>
    </tr>
  `).join("");

  el.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>Atributo</th>
          <th>Valor</th>
          <th>Quarto</th>
          <th>Oitavo</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function renderSkills(character, ctx){
  const el = $("#skills");
  const searchEl = $("#skillSearch");
  const groupEl = $("#skillGroup");

  function buildList(){
    const q = (searchEl.value || "").trim().toLowerCase();
    const group = groupEl.value;

    const blocks = [];
    const groups = [
      {key:"physical", label:"Físicas"},
      {key:"intellectual", label:"Intelectuais"},
    ].filter(g => group==="all" ? true : g.key===group);

    for(const g of groups){
      const list = (character.skills?.[g.key] || []).filter(s => {
        if(!q) return true;
        return (s.name || "").toLowerCase().includes(q);
      });

      const rows = list.map(s => `
        <tr>
          <td><b>${escapeHtml(s.name)}</b> ${s.proficient ? `<span class="badge">prof</span>` : ""}</td>
          <td>${escapeHtml(s.attribute ?? "")}</td>
          <td>${s.level ?? ""}</td>
          <td><b>${s.total ?? ""}</b></td>
          <td><button class="secondary" data-roll-skill="${g.key}:${escapeHtml(s.name)}">Rolar</button></td>
        </tr>
      `).join("");

      blocks.push(`
        <div style="margin-top:12px">
          <div class="small muted" style="margin:10px 0 6px">${g.label}</div>
          <table class="table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Atributo</th>
                <th>Nível</th>
                <th>Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${rows || `<tr><td colspan="5" class="muted">Nenhuma perícia encontrada.</td></tr>`}</tbody>
          </table>
        </div>
      `);
    }

    el.innerHTML = blocks.join("");

    $$("button[data-roll-skill]", el).forEach(btn => btn.addEventListener("click", () => {
      const raw = btn.getAttribute("data-roll-skill");
      const [groupKey, skillName] = raw.split(":");
      const expr = `1d20 + @skills.${groupKey}.${skillName}.total`;
      try{
        const res = parseDiceExpression(expr, ctx);
        const line = `[${safeNow()}] ${skillName}: ${expr} ${formatBreakdown(res)}`;
        appendLog(line);
        setActiveTab("visao");
      }catch(err){
        appendLog(`[${safeNow()}] ERRO: ${err.message}`);
      }
    }));
  }

  searchEl.addEventListener("input", buildList);
  groupEl.addEventListener("change", buildList);

  buildList();
}

function renderActions(character, ctx){
  const el = $("#quickActions");
  const actions = character.actions || [];
  el.innerHTML = "";

  if(!actions.length){
    el.innerHTML = `<div class="muted">Sem ações rápidas definidas.</div>`;
    return;
  }

  for(const a of actions){
    const btn = document.createElement("button");
    btn.className = "secondary";
    btn.textContent = a.name;
    btn.addEventListener("click", () => {
      try{
        const res = parseDiceExpression(a.roll, ctx);
        const line = `[${safeNow()}] ${a.name}: ${a.roll} ${formatBreakdown(res)}`;
        appendLog(line);
      }catch(err){
        appendLog(`[${safeNow()}] ERRO: ${err.message}`);
      }
    });
    el.appendChild(btn);
  }
}

function renderCombatAbilities(character, ctx){
  const el = $("#combatAbilities");
  const abilities = character.abilities?.combat_tree || [];
  if(!abilities.length){
    el.innerHTML = `<div class="muted">Sem habilidades detectadas.</div>`;
    return;
  }

  const items = abilities.map(a => {
    const title = `${a.icon_prefix ? a.icon_prefix + " " : ""}Nível ${a.level} — ${a.name}${a.type ? " ("+a.type+")" : ""}`;
    return `
      <div style="border:1px solid var(--border);border-radius:16px;padding:12px;margin:10px 0;background:rgba(0,0,0,.12)">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div style="font-weight:800">${escapeHtml(title)}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="secondary" data-roll-tohit="${escapeHtml(a.name)}">Rolar ataque</button>
          </div>
        </div>
        <div class="small muted" style="margin-top:8px">${escapeHtml(a.text || "")}</div>
      </div>
    `;
  }).join("");

  el.innerHTML = items;

  $$("button[data-roll-tohit]", el).forEach(btn => btn.addEventListener("click", () => {
    const name = btn.getAttribute("data-roll-tohit");
    const expr = `1d20 + @skills.physical.Lutar.total`;
    try{
      const res = parseDiceExpression(expr, ctx);
      const line = `[${safeNow()}] ${name} — Ataque: ${expr} ${formatBreakdown(res)}`;
      appendLog(line);
      setActiveTab("visao");
    }catch(err){
      appendLog(`[${safeNow()}] ERRO: ${err.message}`);
    }
  }));
}

function renderNotes(character){
  $("#craftTree").textContent = character.abilities?.craft_tree_raw || "";
  $("#exclusive").textContent = character.abilities?.exclusive_raw || "";

  const stages = character.notes?.essence_stages || [];
  $("#essence").innerHTML = stages.length
    ? `<div>${stages.map(s => `<div class="kv"><div class="k">•</div><div class="v">${escapeHtml(s)}</div></div>`).join("")}</div>`
    : `<div class="muted">Sem dados.</div>`;

  const kp = character.notes?.karma_positive;
  $("#karma").innerHTML = (kp != null)
    ? `<div class="kv"><div class="k">Karma positivo</div><div class="v">${kp}</div></div>`
    : `<div class="muted">Sem dados.</div>`;
}

function initTabs(){
  $$(".tab").forEach(btn => btn.addEventListener("click", () => {
    setActiveTab(btn.dataset.tab);
  }));
}

function initRoller(ctx){
  $("#rollBtn").addEventListener("click", () => {
    const expr = $("#exprInput").value;
    if(!expr.trim()) return;
    try{
      const res = parseDiceExpression(expr, ctx);
      const line = `[${safeNow()}] Rolador: ${expr} ${formatBreakdown(res)}`;
      appendLog(line);
      setActiveTab("visao");
    }catch(err){
      appendLog(`[${safeNow()}] ERRO: ${err.message}`);
    }
  });

  $("#exprInput").addEventListener("keydown", (e) => {
    if(e.key === "Enter"){
      $("#rollBtn").click();
    }
  });
}

function initLogButtons(){
  $("#clearLogBtn").addEventListener("click", () => {
    $("#log").textContent = "";
  });
  $("#copyLogBtn").addEventListener("click", async () => {
    const text = $("#log").textContent;
    try{
      await navigator.clipboard.writeText(text);
      appendLog(`[${safeNow()}] Log copiado para a área de transferência.`);
    }catch{
      appendLog(`[${safeNow()}] Não consegui copiar automaticamente. Selecione o texto e copie manualmente.`);
    }
  });
}

async function main(){
  initTabs();

  const res = await fetch("data/character.json", { cache: "no-store" });
  const character = await res.json();
  const ctx = normalizeContext(character);
  const state = loadState();

  // Header
  $("#charName").textContent = character.meta?.name || "Ficha";
  const metaBits = [];
  const race = character.meta?.race?.name ? `${character.meta.race.name}${character.meta.race.level != null ? " " + character.meta.race.level : ""}` : null;
  const cls = character.meta?.class?.name ? `${character.meta.class.name}${character.meta.class.level != null ? " " + character.meta.class.level : ""}` : null;
  if(race) metaBits.push(`Raça: ${race}`);
  if(cls) metaBits.push(`Classe: ${cls}`);
  if(character.meta?.professions?.length){
    metaBits.push(`Profissões: ${character.meta.professions.map(p => p.level != null ? `${p.name} ${p.level}` : p.name).join(", ")}`);
  }
  if(character.meta?.experience_raw){
    metaBits.push(`XP: ${character.meta.experience_raw}`);
  }
  $("#charMeta").textContent = metaBits.join(" • ");

  renderTracks(character, state);
  renderDefenses(character);
  renderAttributes(character);
  renderSkills(character, ctx);
  renderActions(character, ctx);
  renderCombatAbilities(character, ctx);
  renderNotes(character);

  initRoller(ctx);
  initLogButtons();
}

main().catch(err => {
  console.error(err);
  const log = $("#log");
  if(log){
    log.textContent = "Erro ao carregar o site.\n\n" + String(err?.message || err);
  }
});
