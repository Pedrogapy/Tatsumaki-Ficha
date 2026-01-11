/* =========================
   Tatsumaki — Ficha Web (v2)
   - Static (GitHub Pages)
   - Sem dependências externas
   - Sons via WebAudio
   ========================= */

(() => {
  // --------------------------
  // Helpers
  // --------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const now = () => new Date();
  const pad2 = (n) => String(n).padStart(2, "0");
  const stamp = () => {
    const d = now();
    return `[${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}]`;
  };

  // Chave “segura” para usar em macros (@skills...):
  // - troca espaços por _
  // - mantém acentos (ok)
  // - remove caracteres estranhos
  const keyOf = (s) => String(s ?? "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-zÀ-ÿ0-9_\-]/g, "");

  // --------------------------
  // Storage
  // --------------------------
  const STORAGE_KEY = "tatsumaki_sheet_v2";
  const loadState = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };
  const saveState = (state) => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  // --------------------------
  // Audio (no assets needed)
  // --------------------------
  const AudioFX = (() => {
    let ctx = null;
    let enabled = true;

    function ensure() {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      return ctx;
    }

    function tone(freq, dur = 0.06, type = "sine", gain = 0.06) {
      if (!enabled) return;
      const c = ensure();
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

    function noise(dur = 0.10, gain = 0.02) {
      if (!enabled) return;
      const c = ensure();
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
      error() { tone(160, 0.08, "sawtooth", 0.03); }
    };
  })();

  // --------------------------
  // Dice Engine + Macros
  // --------------------------
  function buildContext(character, runtime) {
    // Attributes
    const attributes = {};
    for (const a of character.attributes) attributes[a.name] = a;

    // Skills (dict por nome e por keyOf(nome))
    const skills = { physical: {}, intellectual: {} };
    for (const s of character.skills.physical) {
      skills.physical[s.name] = s;
      skills.physical[keyOf(s.name)] = s;
    }
    for (const s of character.skills.intellectual) {
      skills.intellectual[s.name] = s;
      skills.intellectual[keyOf(s.name)] = s;
    }

    return {
      meta: character.meta,
      attributes,
      skills,
      stats: character.stats,
      // runtime.tracks é o estado atual (número)
      tracks: runtime.tracks,
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
      return "0";
    });
  }

  function rollDice(exprRaw, ctx, mode = "normal") {
    // mode: normal | adv | dis (apenas para 1d20 no começo: rola 2d20 e pega maior/menor)
    let expr = (exprRaw || "").trim();
    if (!expr) throw new Error("Expressão vazia.");

    // Adv/Dis: se a expressão começar com 1d20 (ignora espaços)
    if (mode !== "normal") {
      const normalized = expr.replace(/\s+/g, "");
      if (normalized.startsWith("1d20")) {
        expr = expr.replace(/1\s*d\s*20/, "2d20");
      }
    }

    const withMacros = replaceMacros(expr, ctx);

    // tokeniza dados NdM
    const diceRegex = /(\d*)d(\d+)/gi;
    const diceRolls = [];
    const replaced = withMacros.replace(diceRegex, (m, nStr, sidesStr) => {
      const n = nStr ? parseInt(nStr, 10) : 1;
      const sides = parseInt(sidesStr, 10);
      if (!Number.isFinite(n) || !Number.isFinite(sides) || n <= 0 || sides <= 0) return "0";
      const rolls = [];
      for (let i = 0; i < n; i++) rolls.push(1 + Math.floor(Math.random() * sides));
      diceRolls.push({ n, sides, rolls });

      // adv/dis só para 2d20
      if (mode !== "normal" && sides === 20 && n === 2) {
        const a = rolls[0], b = rolls[1];
        const chosen = mode === "adv" ? Math.max(a, b) : Math.min(a, b);
        return String(chosen);
      }
      return String(rolls.reduce((a, b) => a + b, 0));
    });

    // eval seguro: apenas números e operadores
    if (!/^[0-9+\-*/().\s]+$/.test(replaced)) {
      throw new Error("Expressão inválida (use apenas dados, números e + - * / ( ) ).");
    }

    // eslint-disable-next-line no-new-func
    const total = Function(`"use strict"; return (${replaced});`)();

    const detailParts = [];
    detailParts.push(`Expr: ${expr}`);
    if (withMacros !== expr) detailParts.push(`Macros → ${withMacros}`);
    if (replaced !== withMacros) detailParts.push(`Dados → ${replaced}`);

    if (diceRolls.length) {
      const lines = diceRolls.map(d => {
        const list = d.rolls.join(", ");
        return `${d.n}d${d.sides}: [${list}]`;
      });
      detailParts.push(lines.join("\n"));
    }

    return {
      total: Number(total),
      detail: detailParts.join("\n"),
      diceFaces: diceRolls.flatMap(d => d.rolls.slice(0, 8)),
    };
  }

  // --------------------------
  // UI: Toast
  // --------------------------
  const toastHost = $("#toastHost");

  function toast(title, total, detail, diceFaces, opts = {}) {
    const { lifeMs = 4200, reducedMotion = false } = opts;
    const el = document.createElement("div");
    el.className = "toast is-in";

    const diceNodes = (diceFaces || []).slice(0, 8).map((n) => {
      const die = document.createElement("div");
      die.className = "die";
      die.textContent = String(n);
      if (!reducedMotion) die.classList.add("is-rolling");
      return die;
    });

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
    diceNodes.forEach(d => diceBox.appendChild(d));

    toastHost.appendChild(el);

    const kill = () => {
      el.classList.add("is-out");
      setTimeout(() => el.remove(), reducedMotion ? 0 : 220);
    };

    setTimeout(kill, lifeMs);
    el.addEventListener("click", kill);
  }

  // --------------------------
  // App State
  // --------------------------
  const runtime = {
    character: null,
    state: null,
  };

  function buildDefaultState(character) {
    return {
      tracks: {
        PS: character.stats.tracks.PS.current,
        PV: character.stats.tracks.PV.current,
        PF: character.stats.tracks.PF.current,
      },
      settings: {
        sound: character.ui?.defaults?.sound ?? true,
        reducedMotion: character.ui?.defaults?.reduced_motion ?? false,
      },
      log: [],
    };
  }

  function logLine(text) {
    runtime.state.log.push(`${stamp()} ${text}`);
    if (runtime.state.log.length > 2000) runtime.state.log.shift();
    renderLog();
    saveState(runtime.state);
  }

  function renderLog() {
    $("#log").textContent = runtime.state.log.join("\n");
  }

  // --------------------------
  // Tracks UI
  // --------------------------
  function adjustTrack(key, delta) {
    const max = runtime.character.stats.tracks[key].max ?? 999999;
    const cur = runtime.state.tracks[key] ?? 0;
    const next = clamp(cur + delta, 0, max);
    runtime.state.tracks[key] = next;
    saveState(runtime.state);
    renderTracks();
  }

  function spend(costObj, reason = "") {
    // costObj: {PS: n, PV: n, PF: n}
    const keys = ["PS", "PV", "PF"];
    for (const k of keys) {
      const cost = Number(costObj?.[k] ?? 0);
      if (cost <= 0) continue;
      runtime.state.tracks[k] = clamp(
        (runtime.state.tracks[k] ?? 0) - cost,
        0,
        runtime.character.stats.tracks[k].max ?? 999999
      );
    }
    saveState(runtime.state);
    renderTracks();
    if (reason) logLine(`- Custo aplicado: ${formatCost(costObj)} (${reason})`);
  }

  function formatCost(costObj) {
    const parts = [];
    for (const k of ["PS", "PV", "PF"]) {
      const v = Number(costObj?.[k] ?? 0);
      if (v > 0) parts.push(`${v} ${k}`);
    }
    return parts.length ? parts.join(" + ") : "0";
  }

  function renderTracks() {
    const box = $("#tracks");
    box.innerHTML = "";
    const tracks = runtime.character.stats.tracks;

    for (const key of ["PS", "PV", "PF"]) {
      const t = tracks[key];
      const cur = runtime.state.tracks[key] ?? 0;
      const max = t.max ?? 0;
      const pct = max > 0 ? clamp((cur / max) * 100, 0, 100) : 0;

      const el = document.createElement("div");
      el.className = "track";
      el.innerHTML = `
        <div class="track__top">
          <div class="track__label">
            <div class="track__name">${key}</div>
            <div class="track__desc">${t.label}</div>
          </div>
          <div class="track__value">${cur} / ${max}</div>
        </div>
        <div class="track__bar"><div style="width:${pct}%"></div></div>
        <div class="track__controls">
          <button class="btn btn--ghost" data-track="${key}" data-delta="-10">-10</button>
          <button class="btn btn--ghost" data-track="${key}" data-delta="-1">-1</button>
          <button class="btn btn--ghost" data-track="${key}" data-delta="1">+1</button>
          <button class="btn btn--ghost" data-track="${key}" data-delta="10">+10</button>
        </div>
      `;
      box.appendChild(el);
    }

    $$(".track .btn", box).forEach((b) => {
      b.addEventListener("click", () => {
        AudioFX.click();
        const k = b.dataset.track;
        const d = parseInt(b.dataset.delta, 10);
        adjustTrack(k, d);
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
    const ac = c.stats.armor_class?.total ?? "—";
    const per = c.stats.perception ?? "—";
    const luck = c.stats.luck ?? "—";

    const metaLines = [];
    if (c.meta.race?.name) metaLines.push(`Raça: ${c.meta.race.name}${c.meta.race.level ? ` ${c.meta.race.level}` : ""}`);
    if (c.meta.class?.name) metaLines.push(`Classe: ${c.meta.class.name}${c.meta.class.level ? ` ${c.meta.class.level}` : ""}`);
    if (Array.isArray(c.meta.professions) && c.meta.professions.length) {
      const p = c.meta.professions.map(x => x.level ? `${x.name} ${x.level}` : x.name).join(" / ");
      metaLines.push(`Profissões: ${p}`);
    }
    if (c.meta.experience_raw) metaLines.push(`Experiência: ${c.meta.experience_raw}`);

    el.innerHTML = `
      <div class="grid">
        <div class="card">
          <div class="card__head">
            <div>
              <div class="card__title">Resumo</div>
              <div class="card__meta">${metaLines.join(" • ") || "—"}</div>
            </div>
            <div class="badges">
              <span class="badge badge--warn">CA ${ac}</span>
              <span class="badge">Percepção ${per}</span>
              <span class="badge">Sorte ${luck}</span>
            </div>
          </div>
          <div class="card__text">
Use o menu acima para navegar pelas seções.
- Ativas normalmente consomem 1 PV (ação) se não tiver custo definido.
- Exclusivas com custo definido já descontam PV/PF/PS automaticamente.
          </div>
          <div class="small" style="margin-top:10px;">
Macros úteis:
<code>@attributes.Força.half</code> • <code>@skills.physical.Armas_Avançadas.total</code> • <code>@tracks.PF</code>
          </div>
        </div>

        <div class="card">
          <div class="card__title">Atalhos rápidos</div>
          <div class="card__text">Clique para rolar automaticamente:</div>
          <div class="card__actions">
            <button class="btn" data-roll="1d20 + @skills.physical.Lutar.total">Ataque (Lutar)</button>
            <button class="btn" data-roll="1d20 + @skills.physical.Armas_Avançadas.total">Armas Avançadas</button>
            <button class="btn" data-roll="1d20 + @skills.physical.Reflexo.total">Reflexo</button>
            <button class="btn" data-roll="1d20 + @skills.intellectual.Percepção.total">Percepção</button>
            <button class="btn" data-roll="1d20 + @skills.intellectual.Ocultismo.total">Ocultismo</button>
          </div>
        </div>
      </div>
    `;

    $$("[data-roll]", el).forEach((btn) => {
      btn.addEventListener("click", () => {
        AudioFX.click();
        const expr = btn.dataset.roll;
        doRoll(expr, "Atalho");
      });
    });
  }

  // --------------------------
  // Render: Attributes
  // --------------------------
  function renderAttributes() {
    const c = runtime.character;
    const el = $("#tab-attributes");
    el.innerHTML = `<div class="grid"></div>`;
    const grid = $(".grid", el);

    for (const a of c.attributes) {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card__head">
          <div>
            <div class="card__title">${escapeHtml(a.name)}</div>
            <div class="card__meta">Valor ${a.value} • 1/2 ${a.half} • 1/4 ${a.quarter} • 1/8 ${a.eighth}</div>
          </div>
          <div class="badges">
            <span class="badge badge--good">${a.value}</span>
          </div>
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

    const makeList = (title, list, groupKey) => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card__head">
          <div>
            <div class="card__title">${escapeHtml(title)}</div>
            <div class="card__meta">Clique em “Rolar” para fazer 1d20 + Total.</div>
          </div>
          <div class="badges"><span class="badge">${list.length} perícias</span></div>
        </div>
        <div class="hr"></div>
        <div class="kv"></div>
      `;
      const kv = $(".kv", card);

      for (const s of list) {
        const row = document.createElement("div");
        row.style.display = "contents";
        const key = keyOf(s.name);
        row.innerHTML = `
          <div class="kv__k">${escapeHtml(s.name)}</div>
          <div class="kv__v">
            <span class="badge">${escapeHtml(s.attribute ?? "—")}</span>
            <span class="badge">${Number.isFinite(s.total) ? s.total : 0}</span>
            <button class="btn btn--ghost" data-roll="1d20 + @skills.${groupKey}.${key}.total">Rolar</button>
          </div>
        `;
        kv.appendChild(row);
      }
      return card;
    };

    el.innerHTML = `<div class="grid"></div>`;
    const grid = $(".grid", el);
    grid.appendChild(makeList("Perícias Físicas", c.skills.physical, "physical"));
    grid.appendChild(makeList("Perícias Intelectuais", c.skills.intellectual, "intellectual"));

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
        <div class="badges">
          <span class="badge">${abilities.length} itens</span>
        </div>
      </div>
      <div class="hr"></div>
      <div class="grid"></div>
    `;

    const grid = $(".grid", wrap);
    grid.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";

    for (const a of abilities) {
      const card = document.createElement("div");
      card.className = "card";

      const type = a.type || "";
      const level = a.level != null ? `Nível ${a.level}` : "";
      const icon = a.icon ? `${a.icon} ` : "";
      const cost = a.auto_cost && Object.keys(a.auto_cost).length ? formatCost(a.auto_cost) : "";

      const rollBtns = (a.rolls || []).map((r) => `
        <button class="btn btn--ghost" data-roll="${escapeAttr(r.expr)}" data-title="${escapeAttr(r.label)}">${escapeHtml(r.label)}</button>
      `).join("");

      const useBtn = (type.toLowerCase().includes("ativa") || cost) ? `
        <button class="btn" data-use="1" data-cost='${escapeAttr(JSON.stringify(a.auto_cost || {}))}'>Usar${cost ? ` (-${cost})` : ""}</button>
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
          ${useBtn}
          ${rollBtns}
        </div>
      `;
      grid.appendChild(card);

      // Use
      const use = $("[data-use]", card);
      if (use) {
        use.addEventListener("click", () => {
          AudioFX.click();
          const costObj = JSON.parse(use.dataset.cost || "{}");
          if (costObj && Object.keys(costObj).length) spend(costObj, a.name || "Habilidade");
          logLine(`Usou: ${a.name || "Habilidade"}${costObj && Object.keys(costObj).length ? ` (custo: ${formatCost(costObj)})` : ""}`);
          AudioFX.success();
          toast("Ação", "OK", `${a.name || "Habilidade"}\nCusto: ${formatCost(costObj)}`, [], { reducedMotion: runtime.state.settings.reducedMotion });
        });
      }

      // Rolls
      $$("[data-roll]", card).forEach((btn) => {
        btn.addEventListener("click", () => {
          AudioFX.click();
          doRoll(btn.dataset.roll, btn.dataset.title || a.name || "Rolar");
        });
      });
    }

    container.appendChild(wrap);
  }

  // --------------------------
  // Render: Combat / Craft / Exclusive
  // --------------------------
  function renderCombat() {
    const el = $("#tab-combat");
    el.innerHTML = "";
    const list = runtime.character.abilities.combat_tree || [];
    renderAbilityList(el, list, {
      sectionTitle: "Habilidades de Combate",
      hint: "Ativas descontam 1 PV por padrão (ação), se não houver custo definido."
    });
  }

  function renderCraft() {
    const el = $("#tab-craft");
    el.innerHTML = "";
    const list = runtime.character.abilities.craft_tree || [];
    renderAbilityList(el, list, {
      sectionTitle: "Ferreiro — O Mestre da Forja Eterna",
      hint: "Se você quiser, dá para ajustar custos/rolagens editando data/character.json."
    });
  }

  function renderExclusive() {
    const el = $("#tab-exclusive");
    el.innerHTML = "";

    const ex = runtime.character.abilities.exclusive;
    const eq = ex?.equipment;

    if (eq) {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card__head">
          <div>
            <div class="card__title">${escapeHtml(eq.name || "Equipamento")}</div>
            <div class="card__meta">Descrição e propriedades.</div>
          </div>
          <div class="badges"><span class="badge">Arma / Relíquia</span></div>
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

    const list = ex?.abilities || [];
    const adapted = list.map((a) => ({
      name: a.name,
      type: a.type,
      icon: "",
      level: null,
      text: buildExclusiveText(a),
      rolls: a.rolls,
      auto_cost: a.auto_cost
    }));

    renderAbilityList(el, adapted, {
      sectionTitle: "Habilidades Exclusivas",
      hint: "Custos detectados na ficha já são descontados automaticamente."
    });
  }

  function buildExclusiveText(a) {
    const lines = [];
    if (a.flavor) lines.push(`“${a.flavor}”`);
    if (a.kv && Object.keys(a.kv).length) {
      for (const [k, v] of Object.entries(a.kv)) lines.push(`${k}: ${v}`);
    } else if (a.text) {
      lines.push(a.text);
    }
    return lines.join("\n");
  }

  // --------------------------
  // Roller UI
  // --------------------------
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

  // --------------------------
  // Settings buttons
  // --------------------------
  function wireTopbar() {
    $("#btnNewRound").addEventListener("click", () => {
      AudioFX.click();
      runtime.state.tracks.PV = runtime.character.stats.tracks.PV.max ?? runtime.state.tracks.PV;
      saveState(runtime.state);
      renderTracks();
      logLine("Nova rodada: PV restaurado ao máximo.");
      AudioFX.success();
      toast("Nova rodada", "OK", "PV foi restaurado ao máximo.", [], { reducedMotion: runtime.state.settings.reducedMotion });
    });

    $("#btnFullReset").addEventListener("click", () => {
      AudioFX.click();
      runtime.state.tracks.PS = runtime.character.stats.tracks.PS.max ?? runtime.state.tracks.PS;
      runtime.state.tracks.PV = runtime.character.stats.tracks.PV.max ?? runtime.state.tracks.PV;
      runtime.state.tracks.PF = runtime.character.stats.tracks.PF.max ?? runtime.state.tracks.PF;
      saveState(runtime.state);
      renderTracks();
      logLine("Reset total: PS/PV/PF restaurados ao máximo.");
      AudioFX.success();
      toast("Reset total", "OK", "PS, PV e PF foram restaurados ao máximo.", [], { reducedMotion: runtime.state.settings.reducedMotion });
    });

    const soundToggle = $("#soundToggle");
    const motionToggle = $("#motionToggle");

    soundToggle.addEventListener("change", () => {
      runtime.state.settings.sound = soundToggle.checked;
      AudioFX.setEnabled(soundToggle.checked);
      saveState(runtime.state);
      if (soundToggle.checked) AudioFX.click();
    });

    motionToggle.addEventListener("change", () => {
      runtime.state.settings.reducedMotion = motionToggle.checked;
      saveState(runtime.state);
      AudioFX.click();
    });
  }

  // --------------------------
  // Tabs wiring
  // --------------------------
  function wireTabs() {
    $("#tabs").addEventListener("click", (e) => {
      const btn = e.target.closest(".tab");
      if (!btn) return;
      AudioFX.click();
      const tab = btn.dataset.tab;
      activateTab(tab);
    });
  }

  // --------------------------
  // Log buttons
  // --------------------------
  function wireLogButtons() {
    $("#btnClearLog").addEventListener("click", () => {
      AudioFX.click();
      runtime.state.log = [];
      saveState(runtime.state);
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
  // Escape HTML / Attr
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
    // atributo HTML: evita quebrar aspas
    return escapeHtml(s).replace(/\n/g, " ");
  }

  // --------------------------
  // Boot
  // --------------------------
  async function boot() {
    const res = await fetch("./data/character.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Não consegui carregar data/character.json");
    const character = await res.json();
    runtime.character = character;

    // Load state
    const saved = loadState();
    runtime.state = saved || buildDefaultState(character);

    // apply settings
    $("#soundToggle").checked = !!runtime.state.settings.sound;
    $("#motionToggle").checked = !!runtime.state.settings.reducedMotion;
    AudioFX.setEnabled(!!runtime.state.settings.sound);

    // Header
    $("#charName").textContent = character.meta?.name || "Ficha";
    const metaPieces = [];
    if (character.meta?.race?.name) metaPieces.push(`${character.meta.race.name}${character.meta.race.level ? " " + character.meta.race.level : ""}`);
    if (character.meta?.class?.name) metaPieces.push(`${character.meta.class.name}${character.meta.class.level ? " " + character.meta.class.level : ""}`);
    $("#charMeta").textContent = metaPieces.join(" • ") || "—";

    // UI
    renderTracks();
    renderLog();

    wireRoller();
    wireTabs();
    wireTopbar();
    wireLogButtons();

    // Chips com macros usando keyOf (sem espaços)
    $$(".chip").forEach((c) => {
      c.dataset.macro = c.dataset.macro
        .replace("Armas Avançadas", "Armas_Avançadas")
        .replace("Primeiros Socorros", "Primeiros_Socorros")
        .replace("Armas Pesadas", "Armas_Pesadas")
        .replace("Seguir Trilhas", "Seguir_Trilhas");
    });

    renderOverview();
    renderAttributes();
    renderSkills();
    renderCombat();
    renderExclusive();
    renderCraft();

    logLine("Ficha carregada. Bom jogo.");
  }

  boot().catch((e) => {
    console.error(e);
    alert(String(e?.message || e));
  });
})();
