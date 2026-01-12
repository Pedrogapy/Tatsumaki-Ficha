/* =========================
   Tatsumaki — Ficha Web (v8)
   - Funciona no GitHub Pages e abrindo index.html local (sem servidor)
   - Sem dependências externas
   - Rolagens com macros @attributes / @skills / @tracks
   ========================= */

(() => {
  // --------------------------
  // DOM helpers
  // --------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const pad2 = (n) => String(n).padStart(2, "0");
  const stamp = () => {
    const d = new Date();
    return `[${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}]`;
  };

  // Chave “segura” (pra usar em @skills.<GROUP>.<KEY>.total)
  const keyOf = (s) => String(s ?? "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-zÀ-ÿ0-9_\-]/g, "");

  // --------------------------
  // Audio (WebAudio, sem assets)
  // --------------------------
  const AudioFX = (() => {
    let ctx = null;
    let enabled = true;

    function ensure() {
      if (!enabled) return null;
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      // Em alguns browsers, o contexto pode iniciar suspenso
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      return ctx;
    }

    function tone(freq, dur = 0.06, type = "sine", gain = 0.06) {
      const c = ensure();
      if (!c) return;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.value = gain;
      o.connect(g);
      g.connect(c.destination);
      o.start();
      o.stop(c.currentTime + dur);
    }

    function noise(dur = 0.12, gain = 0.02) {
      const c = ensure();
      if (!c) return;
      const bufferSize = Math.floor(c.sampleRate * dur);
      const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.8;
      const src = c.createBufferSource();
      const g = c.createGain();
      src.buffer = buffer;
      g.gain.value = gain;
      src.connect(g);
      g.connect(c.destination);
      src.start();
    }

    return {
      setEnabled(v) { enabled = !!v; },
      click() { tone(420, 0.04, "triangle", 0.03); },
      roll() { noise(0.14, 0.03); tone(240, 0.06, "sine", 0.02); },
      success() { tone(660, 0.05, "sine", 0.05); setTimeout(() => tone(880, 0.06, "sine", 0.04), 65); },
      error() { tone(160, 0.08, "sawtooth", 0.03); },
    };
  })();

  // --------------------------
  // Toast UI
  // --------------------------
  const toastHost = $("#toastHost");
  function toast(title, total, detail, diceFaces = [], opts = {}) {
    const { lifeMs = 4200, reducedMotion = false } = opts;
    const el = document.createElement("div");
    el.className = "toast is-in";

    el.innerHTML = `
      <div class="toast__row">
        <div class="toast__title"></div>
        <div class="toast__total"></div>
      </div>
      <div class="toast__detail"></div>
      <div class="toast__dice"></div>
    `;

    $(".toast__title", el).textContent = title;
    $(".toast__total", el).textContent = Number.isFinite(total) ? String(total) : "—";
    $(".toast__detail", el).textContent = detail || "";

    const diceBox = $(".toast__dice", el);
    (diceFaces || []).slice(0, 10).forEach((n) => {
      const die = document.createElement("div");
      die.className = "die";
      die.textContent = String(n);
      if (!reducedMotion) die.classList.add("is-rolling");
      diceBox.appendChild(die);
    });

    toastHost.appendChild(el);

    const kill = () => {
      el.classList.add("is-out");
      setTimeout(() => el.remove(), reducedMotion ? 0 : 220);
    };

    setTimeout(kill, lifeMs);
    el.addEventListener("click", kill);
  }

  // --------------------------
  // Storage
  // --------------------------
  const STORAGE_KEY = "tatsumaki_sheet_state_v8";
  const loadState = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };
  const saveState = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(runtime.state)); } catch {}
  };

  // --------------------------
  // Runtime
  // --------------------------
  const runtime = {
    character: null,
    state: null,
  };

  function buildDefaultState(character) {
    // Tracks sempre em máximo na inicialização (pedido do Pedro)
    const tracks = {};
    for (const [k, t] of Object.entries(character.stats.tracks || {})) {
      tracks[k] = t.max ?? t.current ?? 0;
    }

    return {
      tracks,
      settings: {
        sound: true,
        reducedMotion: false,
      },
      combat: { used: {} }, // limites 1/combate
      log: [],
      ui: {
        weaponDamage: {}, // inputs por nome de habilidade
      }
    };
  }

  // Ao abrir o site: SEMPRE iniciar recursos no máximo e resetar limites por combate
  function forceStartAtMax(character) {
    for (const [k, t] of Object.entries(character.stats.tracks || {})) {
      runtime.state.tracks[k] = t.max ?? runtime.state.tracks[k] ?? 0;
    }
    runtime.state.combat = { used: {} };
  }

  function logLine(text) {
    runtime.state.log.push(`${stamp()} ${text}`);
    if (runtime.state.log.length > 2000) runtime.state.log.shift();
    renderLog();
    saveState();
  }

  function renderLog() {
    $("#log").textContent = runtime.state.log.join("\n");
  }

  // --------------------------
  // Context for macros
  // --------------------------
  function buildContext(character, state) {
    const attributes = {};
    for (const a of character.attributes || []) {
      attributes[a.name] = a;
      // alias por nome sem acento / keyOf
      attributes[keyOf(a.name)] = a;
    }

    // Skills: por grupo e por keyOf
    const groups = { physical: {}, intellectual: {}, FOR: {}, DES: {}, FORT: {}, ARC: {}, INT: {}, SAB: {} };

    const put = (g, s) => {
      g[s.name] = s;
      g[keyOf(s.name)] = s;
    };

    for (const s of character.skills?.physical || []) {
      put(groups.physical, s);
      const code = String(s.attribute || "").toUpperCase();
      if (Object.prototype.hasOwnProperty.call(groups, code)) put(groups[code], s);
    }
    for (const s of character.skills?.intellectual || []) {
      put(groups.intellectual, s);
      const code = String(s.attribute || "").toUpperCase();
      if (Object.prototype.hasOwnProperty.call(groups, code)) put(groups[code], s);
    }

    return {
      meta: character.meta,
      attributes,
      skills: groups,
      tracks: state.tracks,
    };
  }

  function safeGet(obj, path) {
    const parts = path.split(".");
    let cur = obj;
    for (const p of parts) {
      if (cur == null) return undefined;
      if (Object.prototype.hasOwnProperty.call(cur, p)) cur = cur[p];
      else return undefined;
    }
    return cur;
  }

  function replaceMacros(expr, ctx) {
    return expr.replace(/@([A-Za-zÀ-ÿ0-9_\.\-]+)/g, (_, path) => {
      const v = safeGet(ctx, path);
      if (typeof v === "number") return String(v);
      if (v && typeof v.total === "number") return String(v.total);
      if (v && typeof v.value === "number") return String(v.value);
      if (v && typeof v.current === "number") return String(v.current);
      return "0";
    });
  }

  function rollDice(exprRaw, ctx, mode = "normal") {
    let expr = String(exprRaw || "").trim();
    if (!expr) throw new Error("Expressão vazia.");

    // Vantagem/Desvantagem: só modifica 1d20 inicial
    if (mode !== "normal") {
      const normalized = expr.replace(/\s+/g, "");
      if (normalized.startsWith("1d20")) expr = expr.replace(/1\s*d\s*20/, "2d20");
    }

    const withMacros = replaceMacros(expr, ctx);

    const diceRegex = /(\d*)d(\d+)/gi;
    const diceRolls = [];
    const replaced = withMacros.replace(diceRegex, (m, nStr, sidesStr) => {
      const n = nStr ? parseInt(nStr, 10) : 1;
      const sides = parseInt(sidesStr, 10);
      if (!Number.isFinite(n) || !Number.isFinite(sides) || n <= 0 || sides <= 0) return "0";

      const rolls = [];
      for (let i = 0; i < n; i++) rolls.push(1 + Math.floor(Math.random() * sides));
      diceRolls.push({ n, sides, rolls });

      // se for 2d20 e modo adv/dis: escolhe um valor só
      if (mode !== "normal" && sides === 20 && n === 2) {
        const [a, b] = rolls;
        const chosen = mode === "adv" ? Math.max(a, b) : Math.min(a, b);
        return String(chosen);
      }

      return String(rolls.reduce((a, b) => a + b, 0));
    });

    // Validação leve: só garantir que é “matemática”
    if (!/^[0-9+\-*/().\s]+$/.test(replaced)) {
      throw new Error("Expressão inválida (use apenas dados, números e + - * / ( ) ).");
    }

    // eslint-disable-next-line no-new-func
    const total = Function(`"use strict"; return (${replaced});`)();

    const detail = [
      `Expr: ${expr}`,
      withMacros !== expr ? `Macros → ${withMacros}` : null,
      replaced !== withMacros ? `Dados → ${replaced}` : null,
      diceRolls.length ? diceRolls.map(d => `${d.n}d${d.sides}: [${d.rolls.join(", ")}]`).join("\n") : null,
    ].filter(Boolean).join("\n");

    return {
      total: Number(total),
      detail,
      diceFaces: diceRolls.flatMap(d => d.rolls.slice(0, 12)),
    };
  }

  function doRoll(expr, title, mode = "normal") {
    try {
      AudioFX.roll();
      const ctx = buildContext(runtime.character, runtime.state);
      const r = rollDice(expr, ctx, mode);
      logLine(`${title}: ${expr} = ${r.total}`);
      toast(title, r.total, r.detail, r.diceFaces, { reducedMotion: runtime.state.settings.reducedMotion });
      AudioFX.success();
    } catch (e) {
      AudioFX.error();
      toast("Erro", "—", String(e?.message || e), [], { reducedMotion: runtime.state.settings.reducedMotion });
      logLine(`ERRO: ${String(e?.message || e)}`);
    }
  }

  // --------------------------
  // Tracks (Recursos)
  // --------------------------
  function trackOrder(character) {
    const keys = Object.keys(character.stats.tracks || {});
    const preferred = ["PS", "PVO", "PVD", "PV", "PF"];
    const ordered = preferred.filter(k => keys.includes(k)).concat(keys.filter(k => !preferred.includes(k)));
    // remove duplicados
    return [...new Set(ordered)];
  }

  function formatCost(costObj) {
    const parts = [];
    for (const k of trackOrder(runtime.character)) {
      const v = Number(costObj?.[k] ?? 0);
      if (v > 0) parts.push(`${v} ${k}`);
    }
    return parts.length ? parts.join(" + ") : "0";
  }

  function adjustTrack(key, delta) {
    const t = runtime.character.stats.tracks?.[key];
    if (!t) return;
    const max = t.max ?? 999999;
    const cur = runtime.state.tracks?.[key] ?? 0;
    runtime.state.tracks[key] = clamp(cur + delta, 0, max);
    saveState();
    renderTracks();
  }

  function spend(costObj, reason = "") {
    for (const [k, v] of Object.entries(costObj || {})) {
      const t = runtime.character.stats.tracks?.[k];
      if (!t) continue;
      const max = t.max ?? 999999;
      const cur = runtime.state.tracks?.[k] ?? 0;
      const cost = Number(v ?? 0);
      if (!Number.isFinite(cost) || cost <= 0) continue;
      runtime.state.tracks[k] = clamp(cur - cost, 0, max);
    }
    saveState();
    renderTracks();
    if (reason) logLine(`- Custo aplicado: ${formatCost(costObj)} (${reason})`);
  }

  function renderTracks() {
    const box = $("#tracks");
    box.innerHTML = "";
    const tracks = runtime.character.stats.tracks || {};

    for (const key of trackOrder(runtime.character)) {
      const t = tracks[key];
      const cur = runtime.state.tracks?.[key] ?? 0;
      const max = t.max ?? 0;
      const pct = max > 0 ? clamp((cur / max) * 100, 0, 100) : 0;

      const el = document.createElement("div");
      el.className = "track";
      el.innerHTML = `
        <div class="track__top">
          <div class="track__label">
            <div class="track__name">${escapeHtml(key)}</div>
            <div class="track__desc">${escapeHtml(t.label || "")}</div>
          </div>
          <div class="track__value">${escapeHtml(cur)} / ${escapeHtml(max)}</div>
        </div>
        <div class="track__bar"><div style="width:${pct}%"></div></div>
        <div class="track__controls">
          <button class="btn btn--ghost" data-track="${escapeAttr(key)}" data-delta="-10">-10</button>
          <button class="btn btn--ghost" data-track="${escapeAttr(key)}" data-delta="-1">-1</button>
          <button class="btn btn--ghost" data-track="${escapeAttr(key)}" data-delta="1">+1</button>
          <button class="btn btn--ghost" data-track="${escapeAttr(key)}" data-delta="10">+10</button>
        </div>
      `;
      box.appendChild(el);
    }

    $$(".track .btn", box).forEach((b) => {
      b.addEventListener("click", () => {
        AudioFX.click();
        adjustTrack(b.dataset.track, parseInt(b.dataset.delta, 10));
      });
    });
  }

  // --------------------------
  // Tabs
  // --------------------------
  function activateTab(tab) {
    $$(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === tab));
    $$(".tabpane").forEach((p) => p.classList.toggle("is-active", p.id === `tab-${tab}`));
  }

  // --------------------------
  // Render: Overview
  // --------------------------
  function renderOverview() {
    const c = runtime.character;
    const el = $("#tab-overview");

    const metaLines = [];
    if (c.meta?.race?.name) metaLines.push(`Raça: ${c.meta.race.name}${c.meta.race.level ? ` ${c.meta.race.level}` : ""}`);
    if (c.meta?.class?.name) metaLines.push(`Classe: ${c.meta.class.name}${c.meta.class.level ? ` ${c.meta.class.level}` : ""}`);
    if (c.meta?.experience_raw) metaLines.push(`Experiência: ${c.meta.experience_raw}`);

    // Atalhos principais (com as regras novas)
    const quick = [
      { label: "Teste (Lutar)", expr: "1d20 + @skills.FOR.Lutar.total" },
      { label: "Dano (Corpo a corpo)", expr: "2d8 + @attributes.Força.quarter" },
      { label: "Teste (Armas Pesadas)", expr: "1d20 + @skills.FOR.Armas_Pesadas.total" },
      { label: "Teste (Armas Avançadas)", expr: "1d20 + @skills.DES.Armas_Avançadas.total" },
      { label: "Dano (Espada Especial)", expr: "3d8 + @attributes.Destreza.quarter" },
    ];

    el.innerHTML = `
      <div class="grid">
        <div class="card">
          <div class="card__head">
            <div>
              <div class="card__title">Resumo</div>
              <div class="card__meta">${escapeHtml(metaLines.join(" • ") || "—")}</div>
            </div>
            <div class="badges">
              <span class="badge badge--warn">PS/PVO/PVD/PF</span>
            </div>
          </div>
          <div class="card__text">
Regras rápidas:
- PVO: 2 ações ofensivas por rodada.
- PVD: 3 ações defensivas/reações por rodada.
- Absorver Sangue cura 25% da vida máxima (1x por combate) e custa 1 PVD.
          </div>

          <div class="hr"></div>
          <div class="card__title">Atalhos</div>
          <div class="card__actions" id="overviewQuick"></div>
        </div>

        <div class="card">
          <div class="card__head">
            <div>
              <div class="card__title">Combate base</div>
              <div class="card__meta">Os cards completos ficam na aba “Combate”.</div>
            </div>
            <div class="badges">
              <span class="badge">${(c.abilities?.combat_tree || []).length} ações</span>
            </div>
          </div>
          <div class="card__text">
Corpo a corpo: teste Lutar e dano 2d8 + 1/4 Força.
Arma pesada: teste Armas Pesadas e dano configurável + 1/4 Força.
Espada especial: teste Armas Avançadas e dano 3d8 + 1/4 Destreza.
          </div>
          <div class="card__actions">
            <button class="btn" data-goto="combat">Ir para Combate</button>
          </div>
        </div>
      </div>
    `;

    const quickBox = $("#overviewQuick");
    quick.forEach((q) => {
      const b = document.createElement("button");
      b.className = "btn btn--ghost";
      b.textContent = q.label;
      b.addEventListener("click", () => {
        AudioFX.click();
        doRoll(q.expr, q.label);
      });
      quickBox.appendChild(b);
    });

    $("[data-goto='combat']", el).addEventListener("click", () => {
      AudioFX.click();
      activateTab("combat");
    });
  }

  // --------------------------
  // Render: Attributes
  // --------------------------
  function renderAttributes() {
    const c = runtime.character;
    const el = $("#tab-attributes");

    el.innerHTML = `<div class="grid" id="attrGrid"></div>`;
    const grid = $("#attrGrid", el);

    for (const a of c.attributes || []) {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card__head">
          <div>
            <div class="card__title">${escapeHtml(a.name)}</div>
            <div class="card__meta">Valor ${a.value} • 1/2 ${a.half} • 1/4 ${a.quarter} • 1/8 ${a.eighth}</div>
          </div>
          <div class="badges"><span class="badge badge--good">${a.value}</span></div>
        </div>
        <div class="card__actions">
          <button class="btn btn--ghost" data-roll="1d20 + @attributes.${escapeAttr(a.name)}.half">Teste (1/2)</button>
          <button class="btn btn--ghost" data-roll="1d20 + @attributes.${escapeAttr(a.name)}.quarter">Teste (1/4)</button>
          <button class="btn btn--ghost" data-roll="1d20 + @attributes.${escapeAttr(a.name)}.eighth">Teste (1/8)</button>
        </div>
      `;
      grid.appendChild(card);
    }

    $$("[data-roll]", el).forEach((btn) => {
      btn.addEventListener("click", () => {
        AudioFX.click();
        doRoll(btn.dataset.roll, "Teste de atributo");
      });
    });
  }

  // --------------------------
  // Render: Skills
  // --------------------------
  function renderSkills() {
    const c = runtime.character;
    const el = $("#tab-skills");

    const ATTR_LABEL = { FOR: "Força", DES: "Destreza", FORT: "Fortitude", ARC: "Arcano", INT: "Inteligência", SAB: "Sabedoria" };
    const ATTR_ORDER = ["FOR", "DES", "FORT", "ARC", "INT", "SAB"];

    const all = [...(c.skills?.physical || []), ...(c.skills?.intellectual || [])];
    const groups = {};
    for (const s of all) {
      const code = String(s.attribute || "").toUpperCase();
      if (!groups[code]) groups[code] = [];
      groups[code].push(s);
    }

    el.innerHTML = `<div class="grid" id="skillGrid"></div>`;
    const grid = $("#skillGrid", el);

    const makeGroup = (code, list) => {
      const title = ATTR_LABEL[code] ? `${ATTR_LABEL[code]} (${code})` : code;
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card__head">
          <div>
            <div class="card__title">${escapeHtml(title)}</div>
            <div class="card__meta">Rolar: 1d20 + Total</div>
          </div>
          <div class="badges"><span class="badge">${list.length} perícias</span></div>
        </div>
        <div class="hr"></div>
        <div class="kv"></div>
      `;

      const kv = $(".kv", card);
      const sorted = [...list].sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));
      for (const s of sorted) {
        const key = keyOf(s.name);
        const row = document.createElement("div");
        row.style.display = "contents";
        row.innerHTML = `
          <div class="kv__k">
            <div class="skillName">${escapeHtml(s.name)}</div>
          </div>
          <div class="kv__v">
            <span class="badge">${Number.isFinite(s.total) ? s.total : 0}</span>
            <button class="btn btn--ghost" data-roll="1d20 + @skills.${escapeAttr(code)}.${escapeAttr(key)}.total">Rolar</button>
          </div>
        `;
        kv.appendChild(row);
      }

      return card;
    };

    for (const code of ATTR_ORDER) {
      if (groups[code]?.length) grid.appendChild(makeGroup(code, groups[code]));
    }
    // extras
    Object.keys(groups).filter(code => !ATTR_ORDER.includes(code) && groups[code]?.length)
      .forEach(code => grid.appendChild(makeGroup(code, groups[code])));

    $$("[data-roll]", el).forEach((btn) => {
      btn.addEventListener("click", () => {
        AudioFX.click();
        doRoll(btn.dataset.roll, "Perícia");
      });
    });
  }

  // --------------------------
  // Render: Ability Cards
  // --------------------------
  function badgeForType(type) {
    const t = (type || "").toLowerCase();
    if (t.includes("pass")) return "badge--good";
    if (t.includes("ativa")) return "badge--warn";
    return "";
  }

  function renderAbilityList(container, abilities, opts = {}) {
    const { sectionTitle = "", hint = "" } = opts;

    const wrap = document.createElement("div");
    wrap.className = "card";
    wrap.innerHTML = `
      <div class="card__head">
        <div>
          <div class="card__title">${escapeHtml(sectionTitle)}</div>
          <div class="card__meta">${escapeHtml(hint)}</div>
        </div>
        <div class="badges"><span class="badge">${abilities.length} itens</span></div>
      </div>
      <div class="hr"></div>
      <div class="grid"></div>
    `;

    const grid = $(".grid", wrap);
    grid.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";

    if (!abilities.length) {
      const empty = document.createElement("div");
      empty.className = "card";
      empty.innerHTML = `<div class="card__title">Nada aqui (por enquanto)</div><div class="card__text">Sem itens cadastrados nesta seção.</div>`;
      grid.appendChild(empty);
      container.appendChild(wrap);
      return;
    }

    for (const a of abilities) {
      const card = document.createElement("div");
      card.className = "card";

      const type = a.type || "";
      const level = a.level != null ? `Nível ${a.level}` : "";
      const icon = a.icon ? `${a.icon} ` : "";
      const costText = a.auto_cost && Object.keys(a.auto_cost).length ? formatCost(a.auto_cost) : "";

      const limitOnceCombat = a.effect?.limit === "once_per_combat" || a.limits?.once_per_combat;
      const usedKey = (a.name || "").trim();
      const alreadyUsed = !!runtime.state.combat?.used?.[usedKey];

      const useBtnHtml = (type.toLowerCase().includes("ativa") || costText || a.effect) ? `
        <button class="btn" data-use="1" data-name="${escapeAttr(usedKey)}" data-cost='${escapeAttr(JSON.stringify(a.auto_cost || {}))}' ${limitOnceCombat && alreadyUsed ? "disabled" : ""}>
          Usar${costText ? ` (-${escapeHtml(costText)})` : ""}${limitOnceCombat ? (alreadyUsed ? " (usado)" : " (1/combate)") : ""}
        </button>
      ` : "";

      const rollsFiltered = (a.rolls || []).filter(r => String(r?.expr || "").trim().length > 0);

      const rollBtnsHtml = rollsFiltered.map((r) => `
        <button class="btn btn--ghost" data-roll="${escapeAttr(r.expr)}" data-title="${escapeAttr(r.label)}">${escapeHtml(r.label)}</button>
      `).join("");

      // UI especial: arma com dano configurável
      const hasWeaponInput = !!a.ui?.weapon_damage_input;
      const weaponKey = usedKey || `${a.name || ""}`.trim();
      const defaultWeapon = String(a.ui?.weapon_damage_default || "2d6");
      const savedWeapon = runtime.state.ui.weaponDamage?.[weaponKey] || defaultWeapon;

      const weaponInputHtml = hasWeaponInput ? `
        <div class="hr"></div>
        <div class="card__text"><b>Dano base da arma</b> (ex.: 2d6, 1d12, 3d4)</div>
        <div class="row" style="margin-top:8px;">
          <input class="input" style="flex:1" data-weapon-input="1" data-weapon-key="${escapeAttr(weaponKey)}" value="${escapeAttr(savedWeapon)}" />
          <button class="btn btn--ghost" data-weapon-roll="1" data-weapon-key="${escapeAttr(weaponKey)}">Dano</button>
        </div>
        <div class="small" style="margin-top:6px;">Dano final: (dano base) + 1/4 de Força.</div>
      ` : "";

      card.innerHTML = `
        <div class="card__head">
          <div>
            <div class="card__title">${escapeHtml(icon)}${escapeHtml(a.name || "Habilidade")}</div>
            <div class="card__meta">${escapeHtml([level, type].filter(Boolean).join(" • "))}</div>
          </div>
          <div class="badges">
            ${type ? `<span class="badge ${badgeForType(type)}">${escapeHtml(type)}</span>` : ""}
            ${level ? `<span class="badge">${escapeHtml(level)}</span>` : ""}
          </div>
        </div>
        <div class="card__text">${escapeHtml(a.text || "")}</div>
        <div class="card__actions">
          ${useBtnHtml}
          ${rollBtnsHtml}
        </div>
        ${weaponInputHtml}
      `;

      grid.appendChild(card);

      // Handlers: use
      const useBtn = $("[data-use]", card);
      if (useBtn) {
        useBtn.addEventListener("click", () => {
          AudioFX.click();

          const nameKey = useBtn.dataset.name || "";
          const limit = a.effect?.limit === "once_per_combat" || a.limits?.once_per_combat;
          if (limit && runtime.state.combat?.used?.[nameKey]) {
            AudioFX.error();
            toast("Limite", "—", "Essa habilidade já foi usada neste combate.", [], { reducedMotion: runtime.state.settings.reducedMotion });
            return;
          }

          const costObj = JSON.parse(useBtn.dataset.cost || "{}");
          if (costObj && Object.keys(costObj).length) spend(costObj, a.name || "Habilidade");

          // efeitos automatizados (cura)
          if (a.effect?.type === "heal_percent") {
            const track = a.effect.track || "PS";
            const max = runtime.character.stats.tracks?.[track]?.max ?? 0;
            const amount = Math.max(1, Math.floor(max * Number(a.effect.percent ?? 0)));
            runtime.state.tracks[track] = clamp((runtime.state.tracks[track] ?? 0) + amount, 0, max);
            saveState();
            renderTracks();
            logLine(`+ Cura: ${amount} ${track} (${a.name || "Habilidade"})`);
            toast("Cura", amount, `${a.name || "Habilidade"}\n+${amount} ${track}\nCondição: deve haver sangue inimigo no chão.`, [], { reducedMotion: runtime.state.settings.reducedMotion });
          }

          if (limit) {
            runtime.state.combat.used[nameKey] = true;
            saveState();
            useBtn.disabled = true;
            useBtn.textContent = useBtn.textContent.replace("(1/combate)", "(usado)");
          }

          logLine(`Usou: ${a.name || "Habilidade"}${costObj && Object.keys(costObj).length ? ` (custo: ${formatCost(costObj)})` : ""}`);
          AudioFX.success();
        });
      }

      // Handlers: rolls
      $$("[data-roll]", card).forEach((btn) => {
        btn.addEventListener("click", () => {
          AudioFX.click();
          doRoll(btn.dataset.roll, btn.dataset.title || a.name || "Rolar");
        });
      });

      // Handlers: weapon input + damage roll
      const weaponInput = $("[data-weapon-input]", card);
      if (weaponInput) {
        weaponInput.addEventListener("input", () => {
          const wk = weaponInput.dataset.weaponKey;
          runtime.state.ui.weaponDamage[wk] = weaponInput.value.trim();
          saveState();
        });
      }
      const weaponRollBtn = $("[data-weapon-roll]", card);
      if (weaponRollBtn) {
        weaponRollBtn.addEventListener("click", () => {
          AudioFX.click();
          const wk = weaponRollBtn.dataset.weaponKey;
          const base = (runtime.state.ui.weaponDamage?.[wk] || defaultWeapon).trim() || defaultWeapon;
          // dano base + 1/4 Força
          doRoll(`${base} + @attributes.Força.quarter`, `${a.name || "Arma"} — Dano`);
        });
      }
    }

    container.appendChild(wrap);
  }

  function renderCombat() {
    const el = $("#tab-combat");
    el.innerHTML = "";
    const list = runtime.character.abilities?.combat_tree || [];
    renderAbilityList(el, list, {
      sectionTitle: "Combate",
      hint: "Ações ofensivas gastam PVO. (Você tem 2 por rodada.)"
    });
  }

  function renderExclusive() {
    const el = $("#tab-exclusive");
    el.innerHTML = "";

    const ex = runtime.character.abilities?.exclusive || {};
    const eq = ex.equipment;

    if (eq) {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card__head">
          <div>
            <div class="card__title">${escapeHtml(eq.name || "Equipamento")}</div>
            <div class="card__meta">Descrição e propriedades.</div>
          </div>
          <div class="badges"><span class="badge">Equipamento</span></div>
        </div>
        <div class="hr"></div>
        <div id="eqSections"></div>
      `;
      const box = $("#eqSections", card);
      (eq.sections || []).forEach((s) => {
        const sec = document.createElement("div");
        sec.className = "card";
        sec.style.marginTop = "10px";
        sec.innerHTML = `
          <div class="card__title">${escapeHtml(s.title || "")}</div>
          <div class="card__text">${escapeHtml(s.text || "")}</div>
        `;
        box.appendChild(sec);
      });
      el.appendChild(card);
      el.appendChild(document.createElement("div")).className = "hr";
    }

    const list = ex.abilities || [];
    renderAbilityList(el, list, {
      sectionTitle: "Habilidades Exclusivas",
      hint: "Ações defensivas/reações gastam PVD. (Você tem 3 por rodada.)"
    });
  }

  // --------------------------
  // Roller + Topbar + Tabs
  // --------------------------
  function wireRoller() {
    $("#btnRoll").addEventListener("click", () => {
      AudioFX.click();
      doRoll($("#rollInput").value, "Rolador");
    });
    $("#btnRollAdv").addEventListener("click", () => {
      AudioFX.click();
      doRoll($("#rollInput").value, "Rolador (Vantagem)", "adv");
    });
    $("#btnRollDis").addEventListener("click", () => {
      AudioFX.click();
      doRoll($("#rollInput").value, "Rolador (Desvantagem)", "dis");
    });

    $$(".chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        AudioFX.click();
        $("#rollInput").value = chip.dataset.macro;
        doRoll(chip.dataset.macro, "Atalho");
      });
    });

    $("#rollInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        doRoll($("#rollInput").value, "Rolador");
      }
    });
  }

  function wireTabs() {
    $("#tabs").addEventListener("click", (e) => {
      const btn = e.target.closest(".tab");
      if (!btn) return;
      AudioFX.click();
      activateTab(btn.dataset.tab);
    });
  }

  function wireTopbar() {
    // Reset por combate: restaura PVO/PVD e libera 1/combate
    $("#btnNewCombat").addEventListener("click", () => {
      AudioFX.click();
      const t = runtime.character.stats.tracks || {};
      if (t.PVO) runtime.state.tracks.PVO = t.PVO.max ?? runtime.state.tracks.PVO;
      if (t.PVD) runtime.state.tracks.PVD = t.PVD.max ?? runtime.state.tracks.PVD;
      runtime.state.combat = { used: {} };
      saveState();
      renderTracks();
      logLine("Novo combate: PVO/PVD restaurados e limites 1/combate resetados.");
      AudioFX.success();
      toast("Novo combate", "OK", "PVO/PVD restaurados e limites por combate resetados.", [], { reducedMotion: runtime.state.settings.reducedMotion });
    });

    // Nova rodada: só restaura PVO/PVD
    $("#btnNewRound").addEventListener("click", () => {
      AudioFX.click();
      const t = runtime.character.stats.tracks || {};
      if (t.PVO) runtime.state.tracks.PVO = t.PVO.max ?? runtime.state.tracks.PVO;
      if (t.PVD) runtime.state.tracks.PVD = t.PVD.max ?? runtime.state.tracks.PVD;
      saveState();
      renderTracks();
      logLine("Nova rodada: PVO/PVD restaurados ao máximo.");
      AudioFX.success();
      toast("Nova rodada", "OK", "PVO/PVD restaurados ao máximo.", [], { reducedMotion: runtime.state.settings.reducedMotion });
    });

    // Reset total: tudo no máximo + libera limites por combate
    $("#btnFullReset").addEventListener("click", () => {
      AudioFX.click();
      forceStartAtMax(runtime.character);
      saveState();
      renderTracks();
      renderCombat();      // pra re-habilitar botões “(usado)”
      renderExclusive();
      logLine("Reset total: recursos no máximo e limites por combate resetados.");
      AudioFX.success();
      toast("Reset total", "OK", "Recursos no máximo e limites resetados.", [], { reducedMotion: runtime.state.settings.reducedMotion });
    });

    const soundToggle = $("#soundToggle");
    const motionToggle = $("#motionToggle");

    soundToggle.addEventListener("change", () => {
      runtime.state.settings.sound = soundToggle.checked;
      AudioFX.setEnabled(soundToggle.checked);
      saveState();
      if (soundToggle.checked) AudioFX.click();
    });

    motionToggle.addEventListener("change", () => {
      runtime.state.settings.reducedMotion = motionToggle.checked;
      saveState();
      AudioFX.click();
    });
  }

  function wireLogButtons() {
    $("#btnClearLog").addEventListener("click", () => {
      AudioFX.click();
      runtime.state.log = [];
      saveState();
      renderLog();
      toast("Log", "OK", "Log limpo.", [], { reducedMotion: runtime.state.settings.reducedMotion });
    });

    $("#btnCopyLog").addEventListener("click", async () => {
      AudioFX.click();
      try {
        await navigator.clipboard.writeText(runtime.state.log.join("\n"));
        toast("Log", "OK", "Copiado para a área de transferência.", [], { reducedMotion: runtime.state.settings.reducedMotion });
        AudioFX.success();
      } catch {
        toast("Log", "—", "Não consegui copiar automaticamente. Selecione e copie manualmente.", [], { reducedMotion: runtime.state.settings.reducedMotion });
        AudioFX.error();
      }
    });
  }

  // --------------------------
  // Escape helpers
  // --------------------------
  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/\n/g, " ");
  }

  // --------------------------
  // Boot
  // --------------------------
  function getCharacterFromHtml() {
    const raw = document.getElementById("characterData")?.textContent?.trim();
    if (!raw) throw new Error("Não encontrei o JSON embutido da ficha (characterData).");
    return JSON.parse(raw);
  }

  function boot() {
    // 1) carrega ficha embutida (funciona local e Pages)
    const character = getCharacterFromHtml();
    runtime.character = character;

    // 2) estado salvo (só pra settings e logs), mas sempre começa com recursos no máximo
    const saved = loadState();
    runtime.state = saved ? { ...buildDefaultState(character), ...saved } : buildDefaultState(character);

    // garantir que os objetos existam
    runtime.state.settings = runtime.state.settings || { sound: true, reducedMotion: false };
    runtime.state.tracks = runtime.state.tracks || {};
    runtime.state.combat = runtime.state.combat || { used: {} };
    runtime.state.ui = runtime.state.ui || { weaponDamage: {} };
    runtime.state.ui.weaponDamage = runtime.state.ui.weaponDamage || {};

    // força regra do Pedro
    forceStartAtMax(character);

    // Header
    $("#charName").textContent = character.meta?.name || "Ficha";
    const metaPieces = [];
    if (character.meta?.race?.name) metaPieces.push(`${character.meta.race.name}${character.meta.race.level ? " " + character.meta.race.level : ""}`);
    if (character.meta?.class?.name) metaPieces.push(`${character.meta.class.name}${character.meta.class.level ? " " + character.meta.class.level : ""}`);
    $("#charMeta").textContent = metaPieces.join(" • ") || "—";

    // Toggles
    $("#soundToggle").checked = !!runtime.state.settings.sound;
    $("#motionToggle").checked = !!runtime.state.settings.reducedMotion;
    AudioFX.setEnabled(!!runtime.state.settings.sound);

    // Render tudo
    renderTracks();
    renderLog();
    renderOverview();
    renderAttributes();
    renderSkills();
    renderCombat();
    renderExclusive();

    // Wire
    wireRoller();
    wireTabs();
    wireTopbar();
    wireLogButtons();

    logLine("Ficha carregada. Recursos iniciados no máximo.");
    saveState();
  }

  try {
    boot();
  } catch (e) {
    console.error(e);
    alert(String(e?.message || e));
  }
})();
