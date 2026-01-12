/* =========================
   Tatsumaki — Ficha Web (v9)
   - Funciona no GitHub Pages e local (sem servidor)
   - Sons (WebAudio) + animações simples
   - PV dividido: PVO (ofensivo) / PVD (defensivo)
   - Ao abrir o site: PS/PVO/PVD/PF sempre no máximo
   ========================= */

(() => {
  // --------------------------
  // DOM helpers
  // --------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  // --------------------------
  // Storage (salva só preferências/UI)
  // --------------------------
  const STORAGE_KEY = "tatsumaki_sheet_v9";

  const loadState = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const saveState = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(runtime.state));
    } catch {
      // ignore
    }
  };

  // --------------------------
  // Audio (WebAudio, sem arquivos)
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
      for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.75;
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
  // Utilities
  // --------------------------
  const pad2 = (n) => String(n).padStart(2, "0");
  const stamp = () => {
    const d = new Date();
    return `[${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}]`;
  };

  const escapeHtml = (s) => String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");

  const keyOf = (s) => String(s ?? "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-zÀ-ÿ0-9_\-]/g, "");

  // --------------------------
  // Toast
  // --------------------------
  const toastHost = () => $("#toastHost");
  function toast(title, total, detail, diceFaces = []) {
    const reducedMotion = !!runtime.state.settings.reducedMotion;

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
    $(".toast__title", el).textContent = title || "";
    $(".toast__total", el).textContent = (total === null || total === undefined) ? "—" : String(total);
    $(".toast__detail", el).textContent = detail || "";

    const diceBox = $(".toast__dice", el);
    diceFaces.slice(0, 8).forEach((n) => {
      const die = document.createElement("div");
      die.className = "die";
      die.textContent = String(n);
      if (!reducedMotion) die.classList.add("is-rolling");
      diceBox.appendChild(die);
    });

    toastHost().appendChild(el);

    const kill = () => {
      el.classList.add("is-out");
      setTimeout(() => el.remove(), reducedMotion ? 0 : 220);
    };

    setTimeout(kill, 4200);
    el.addEventListener("click", kill);
  }

  // --------------------------
  // Context + Macros
  // --------------------------
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

  function buildContext(character) {
    const attributes = {};
    for (const a of character.attributes) attributes[a.name] = a;

    const skills = { physical: {}, intellectual: {}, FOR: {}, DES: {}, FORT: {}, ARC: {}, INT: {}, SAB: {} };
    const put = (group, s) => {
      group[s.name] = s;
      group[keyOf(s.name)] = s;
    };

    for (const s of character.skills.physical || []) {
      put(skills.physical, s);
      const code = String(s.attribute || "").toUpperCase();
      if (skills[code]) put(skills[code], s);
    }
    for (const s of character.skills.intellectual || []) {
      put(skills.intellectual, s);
      const code = String(s.attribute || "").toUpperCase();
      if (skills[code]) put(skills[code], s);
    }

    return {
      meta: character.meta,
      attributes,
      skills,
      tracks: runtime.state.tracks,
      ui: runtime.state.ui,
    };
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

  // --------------------------
  // Dice roller
  // --------------------------
  function rollDice(exprRaw, ctx, mode = "normal") {
    let expr = String(exprRaw || "").trim();
    if (!expr) throw new Error("Expressão vazia.");

    // Advantage / disadvantage (apenas se começar com 1d20)
    if (mode !== "normal") {
      const normalized = expr.replace(/\s+/g, "");
      if (normalized.startsWith("1d20")) expr = expr.replace(/1\s*d\s*20/i, "2d20");
    }

    const withMacros = replaceMacros(expr, ctx);

    const diceRolls = [];
    const diceRegex = /(\d*)d(\d+)/gi;
    const replaced = withMacros.replace(diceRegex, (m, nStr, sidesStr) => {
      const n = nStr ? parseInt(nStr, 10) : 1;
      const sides = parseInt(sidesStr, 10);
      if (!Number.isFinite(n) || !Number.isFinite(sides) || n <= 0 || sides <= 0) return "0";

      const rolls = [];
      for (let i = 0; i < n; i++) rolls.push(1 + Math.floor(Math.random() * sides));
      diceRolls.push({ n, sides, rolls });

      if (mode !== "normal" && sides === 20 && n === 2) {
        const chosen = mode === "adv" ? Math.max(rolls[0], rolls[1]) : Math.min(rolls[0], rolls[1]);
        return String(chosen);
      }
      return String(rolls.reduce((a, b) => a + b, 0));
    });

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
      detailParts.push(diceRolls.map(d => `${d.n}d${d.sides}: [${d.rolls.join(", ")}]`).join("\n"));
    }

    return {
      total: Number(total),
      detail: detailParts.join("\n"),
      diceFaces: diceRolls.flatMap(d => d.rolls),
    };
  }

  // --------------------------
  // Runtime state
  // --------------------------
  const runtime = {
    character: null,
    state: null,
  };

  function defaultState(character) {
    const tracks = {};
    const order = character.stats.tracks_order || Object.keys(character.stats.tracks || {});
    for (const k of order) tracks[k] = character.stats.tracks[k]?.max ?? character.stats.tracks[k]?.current ?? 0;

    return {
      // sempre resetado ao abrir (mas ainda guardamos para UI)
      tracks,
      // preferências
      settings: {
        sound: character.ui?.defaults?.sound ?? true,
        reducedMotion: character.ui?.defaults?.reduced_motion ?? false,
      },
      // inputs/UI
      ui: {
        weaponDamage: { heavy: "2d6" }, // default
        conditions: { bloodOnGround: false },
      },
      // limites por combate
      combat: { used: {} }, // { "Absorver Sangue": true }
      log: [],
    };
  }

  function resetTracksToMax() {
    const tracks = runtime.character.stats.tracks || {};
    const order = runtime.character.stats.tracks_order || Object.keys(tracks);
    for (const k of order) {
      runtime.state.tracks[k] = tracks[k]?.max ?? tracks[k]?.current ?? 0;
    }
  }

  function logLine(text) {
    runtime.state.log.push(`${stamp()} ${text}`);
    if (runtime.state.log.length > 500) runtime.state.log.shift();
    $("#log").textContent = runtime.state.log.join("\n");
    saveState();
  }

  // --------------------------
  // Track spend & adjust
  // --------------------------
  function canSpend(costObj = {}) {
    for (const [k, v] of Object.entries(costObj)) {
      const cost = Number(v ?? 0);
      if (cost <= 0) continue;
      if ((runtime.state.tracks[k] ?? 0) < cost) return false;
    }
    return true;
  }

  function spend(costObj = {}, reason = "") {
    for (const [k, v] of Object.entries(costObj)) {
      const cost = Number(v ?? 0);
      if (cost <= 0) continue;
      const max = runtime.character.stats.tracks[k]?.max ?? 999999;
      const cur = runtime.state.tracks[k] ?? 0;
      runtime.state.tracks[k] = clamp(cur - cost, 0, max);
    }
    renderTracks();
    saveState();
    if (reason) logLine(`- Custo: ${formatCost(costObj)} (${reason})`);
  }

  function heal(trackKey, amount, reason = "") {
    const max = runtime.character.stats.tracks[trackKey]?.max ?? 0;
    const cur = runtime.state.tracks[trackKey] ?? 0;
    const next = clamp(cur + amount, 0, max);
    runtime.state.tracks[trackKey] = next;
    renderTracks();
    saveState();
    if (reason) logLine(`+ Cura: ${amount} ${trackKey} (${reason})`);
  }

  function formatCost(costObj = {}) {
    const parts = [];
    for (const k of Object.keys(costObj)) {
      const v = Number(costObj[k] ?? 0);
      if (v > 0) parts.push(`${v} ${k}`);
    }
    return parts.length ? parts.join(" + ") : "0";
  }

  // --------------------------
  // Render Tracks
  // --------------------------
  function renderTracks() {
    const box = $("#tracks");
    if (!box) return;
    box.innerHTML = "";

    const tracksDef = runtime.character.stats.tracks || {};
    const order = runtime.character.stats.tracks_order || Object.keys(tracksDef);

    for (const key of order) {
      const t = tracksDef[key];
      if (!t) continue;

      const cur = runtime.state.tracks[key] ?? 0;
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
          <div class="track__value">${cur} / ${max}</div>
        </div>
        <div class="track__bar"><div style="width:${pct}%"></div></div>
        <div class="track__controls">
          <button class="btn btn--ghost" data-track="${escapeHtml(key)}" data-delta="-10">-10</button>
          <button class="btn btn--ghost" data-track="${escapeHtml(key)}" data-delta="-1">-1</button>
          <button class="btn btn--ghost" data-track="${escapeHtml(key)}" data-delta="1">+1</button>
          <button class="btn btn--ghost" data-track="${escapeHtml(key)}" data-delta="10">+10</button>
        </div>
      `;
      box.appendChild(el);

      // PV costuma ser pequeno, mas deixa os botões mesmo assim
      // (fica útil pra reverter gasto no meio do jogo)
    }

    $$("[data-track]", box).forEach((b) => {
      b.addEventListener("click", () => {
        AudioFX.click();
        const k = b.dataset.track;
        const d = parseInt(b.dataset.delta, 10);
        const max = runtime.character.stats.tracks[k]?.max ?? 999999;
        const cur = runtime.state.tracks[k] ?? 0;
        runtime.state.tracks[k] = clamp(cur + d, 0, max);
        renderTracks();
        saveState();
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
  // Roll wrapper (UI + log)
  // --------------------------
  function doRoll(expr, title, mode = "normal") {
    const ctx = buildContext(runtime.character);

    try {
      AudioFX.roll();
      const r = rollDice(expr, ctx, mode);
      logLine(`${title}: ${expr} = ${r.total}`);
      toast(title, r.total, r.detail, r.diceFaces);
      AudioFX.success();
      return r.total;
    } catch (e) {
      AudioFX.error();
      toast("ERRO", null, String(e?.message || e), []);
      logLine(`ERRO: ${String(e?.message || e)}`);
      return null;
    }
  }

  // --------------------------
  // Render: Overview
  // --------------------------
  function renderOverview() {
    const c = runtime.character;
    const el = $("#tab-overview");
    if (!el) return;

    const ac = c.stats.armor_class?.total ?? "—";
    const per = c.stats.perception ?? "—";
    const luck = c.stats.luck ?? "—";

    const metaPieces = [];
    if (c.meta?.race?.name) metaPieces.push(`Raça: ${c.meta.race.name}${c.meta.race.level ? ` ${c.meta.race.level}` : ""}`);
    if (c.meta?.class?.name) metaPieces.push(`Classe: ${c.meta.class.name}${c.meta.class.level ? ` ${c.meta.class.level}` : ""}`);
    if (c.meta?.experience_raw) metaPieces.push(`XP: ${c.meta.experience_raw}`);

    el.innerHTML = `
      <div class="grid">
        <div class="card">
          <div class="card__head">
            <div>
              <div class="card__title">Resumo</div>
              <div class="card__meta">${escapeHtml(metaPieces.join(" • ") || "—")}</div>
            </div>
            <div class="badges">
              <span class="badge badge--warn">CA ${escapeHtml(ac)}</span>
              <span class="badge">Percepção ${escapeHtml(per)}</span>
              <span class="badge">Sorte ${escapeHtml(luck)}</span>
            </div>
          </div>
          <div class="card__text">
PV é dividido:
- PVO: ações ofensivas (2 por rodada)
- PVD: reações/defesa (3 por rodada)

Ao abrir o site, PS/PVO/PVD/PF sempre começam no máximo.
          </div>
          <div class="card__actions">
            <button class="btn" data-roll="1d20 + @skills.FOR.Lutar.total" data-title="Teste — Lutar">Teste (Lutar)</button>
            <button class="btn" data-roll="2d8 + @attributes.Força.quarter" data-title="Dano — Corpo a corpo">Dano (2d8 + ¼ Força)</button>
            <button class="btn btn--ghost" data-roll="1d20 + @skills.DES.Armas_Avançadas.total" data-title="Teste — Espada Tatsumaki">Teste (Espada Tatsumaki)</button>
          </div>
        </div>

        <div class="card">
          <div class="card__title">Pesquisa rápida</div>
          <div class="card__meta">Digite para procurar perícias/habilidades e abrir a seção.</div>
          <input id="globalSearch" class="input" placeholder="Ex: Reflexo, Absorver Sangue, Onda Sonora..." />
          <div id="globalResults" class="card__text" style="margin-top:10px;"></div>
        </div>
      </div>
    `;

    $$("[data-roll]", el).forEach((btn) => {
      btn.addEventListener("click", () => {
        AudioFX.click();
        doRoll(btn.dataset.roll, btn.dataset.title || "Rolar");
      });
    });

    const input = $("#globalSearch", el);
    const results = $("#globalResults", el);

    const skills = [...(c.skills.physical || []), ...(c.skills.intellectual || [])].map(s => ({
      type: "Perícia",
      name: s.name,
      tab: "skills",
      hint: `Total ${s.total}`
    }));

    const abilities = [
      ...(c.abilities?.combat_tree || []).map(a => ({ type: "Combate", name: a.name, tab: "combat", hint: a.type || "" })),
      ...((c.abilities?.exclusive?.abilities || []).map(a => ({ type: "Exclusiva", name: a.name, tab: "exclusive", hint: a.type || "" })))
    ];

    const all = [...skills, ...abilities];

    const renderMatches = () => {
      const q = (input.value || "").trim().toLowerCase();
      if (!q) { results.textContent = "—"; return; }

      const hits = all.filter(x => x.name.toLowerCase().includes(q)).slice(0, 8);
      if (!hits.length) { results.textContent = "Nada encontrado."; return; }

      results.innerHTML = hits.map((h, i) => {
        return `<div style="margin:6px 0;">
          <button class="btn btn--ghost" data-jump="${escapeHtml(h.tab)}" data-name="${escapeHtml(h.name)}">
            ${escapeHtml(h.type)}: ${escapeHtml(h.name)} <span class="small">(${escapeHtml(h.hint)})</span>
          </button>
        </div>`;
      }).join("");

      $$("[data-jump]", results).forEach((b) => {
        b.addEventListener("click", () => {
          AudioFX.click();
          activateTab(b.dataset.jump);
          // foco “soft”: só troca a aba (fica simples)
        });
      });
    };

    input.addEventListener("input", renderMatches);
    renderMatches();
  }

  // --------------------------
  // Render: Attributes
  // --------------------------
  function renderAttributes() {
    const c = runtime.character;
    const el = $("#tab-attributes");
    if (!el) return;

    el.innerHTML = `<div class="grid"></div>`;
    const grid = $(".grid", el);

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
          <button class="btn btn--ghost" data-roll="1d20 + @attributes.${escapeHtml(a.name)}.half" data-title="Teste (${escapeHtml(a.name)} 1/2)">Teste (1/2)</button>
          <button class="btn btn--ghost" data-roll="1d20 + @attributes.${escapeHtml(a.name)}.quarter" data-title="Teste (${escapeHtml(a.name)} 1/4)">Teste (1/4)</button>
          <button class="btn btn--ghost" data-roll="1d20 + @attributes.${escapeHtml(a.name)}.eighth" data-title="Teste (${escapeHtml(a.name)} 1/8)">Teste (1/8)</button>
        </div>
      `;
      grid.appendChild(card);
    }

    $$("[data-roll]", el).forEach((btn) => {
      btn.addEventListener("click", () => {
        AudioFX.click();
        doRoll(btn.dataset.roll, btn.dataset.title || "Teste de atributo");
      });
    });
  }

  // --------------------------
  // Perícia descriptions (referência rápida)
  // --------------------------
  const SKILL_DESC = {
    "Lutar": "Lutar sem armas, técnicas de luta.",
    "Agarrar": "Segurar algo ou imobilizar alvos com firmeza física.",
    "Quebrar": "Romper objetos ou estruturas pela força bruta.",
    "Arrancar": "Puxar com violência algo preso ou incrustado.",
    "Arremesso": "Lançar objetos ou inimigos com potência.",
    "Destravar": "Forçar trancas, correntes ou mecanismos travados.",
    "Desprender": "Soltar-se de amarras, garras ou contenções físicas.",
    "Levantamento": "Erguer grandes pesos ou levantar obstáculos.",
    "Armas Pesadas": "Manusear com eficácia armamentos de grande pesadas.",

    "Arcanismo": "Entendimento sobre magia, runas e planos místicos.",
    "Ocultismo": "Saber sobre maldições, entidades e segredos proibidos.",
    "Intimidação": "Ameaça ou força alguém ao medo.",
    "Empatia": "Ler emoções e intenções das pessoas.",
    "Intuição": "Saber algo sem explicação lógica — pura sensação.",
    "Invocação": "Chamar criaturas, armas ou espíritos para auxiliá-lo.",
    "Canalização": "Focar energias mágicas em feitiços ou habilidades.",
    "Conjuração": "Utilizar runas como forma de feitiçaria.",
    "Presença": "Imposição mágica ou espiritual que afeta seres e ambientes.",

    "Furtividade": "Mover-se em silêncio e escondido.",
    "Espionagem": "Observar e colher informações sem levantar suspeitas.",
    "Acrobacia": "Manobras ágeis, cambalhotas, equilíbrio.",
    "Reflexo": "Esquivas rápidas, ação surpresa ou emergências.",
    "Defletir": "Desviar projéteis ou ataques com reflexos rápidos.",
    "Pontaria": "Acertar alvos com precisão usando armas à distância.",
    "Manuseio": "Controlar objetos delicados ou perigosos com agilidade.",
    "Prestidigitação": "Executar truques rápidos com as mãos, como roubo ou mágica.",
    "Armas Avançadas": "Operar armamentos complexos com destreza técnica.",

    "Atletismo": "Corridas, saltos, escaladas, natação.",
    "Resistência": "Suportar fadiga, frio, veneno ou dor.",
    "Manobra": "Golpes especiais como agarrar, derrubar, desarmar.",
    "Saúde": "Resistência física a doenças, venenos e exaustão.",
    "Firmeza": "Manter-se estável diante de impactos ou tentações.",
    "Defender": "Proteger-se ou a outros de ataques diretos.",
    "Tolerar a Dor": "Suportar ferimentos sem perder desempenho.",
    "Determinação": "Persistir mesmo sob pressão ou desvantagem.",
    "Contra-Ataque": "Responder a um ataque com reação imediata e precisa.",

    "Investigação": "Raciocínio lógico e dedutivo para encontrar pistas e segredos.",
    "Cartografia": "Leitura e criação de mapas.",
    "Tática": "Planejamento estratégico de combate e movimentação.",
    "Persuasão": "Convencer, inspirar ou acalmar.",
    "Negociação": "Trocar bens ou ideias com vantagem.",
    "Pilotagem": "Conduzir veículos mágicos, criaturas voadoras ou máquinas.",
    "Falsificação": "Criar documentos, selos ou objetos falsos.",
    "Tecnologia": "Compreensão e uso de máquinas, circuitos e dispositivos modernos.",
    "Criptografia": "Decifrar, codificar ou reconhecer padrões secretos em mensagens.",

    "Religião": "Conhecimento sobre deuses, cultos e rituais.",
    "História": "Saber sobre eventos antigos, reinos caídos e linhagens.",
    "Medicina": "Diagnóstico, primeiros socorros e tratamento de doenças.",
    "Natureza": "Saber sobre plantas, criaturas e fenômenos naturais.",
    "Sobrevivência": "Navegar em ambientes hostis, caçar e encontrar abrigo.",
    "Liderança": "Inspirar e comandar aliados em combate ou fora dele.",
    "Domar": "Treinar e manter controle sobre animais ou monstros.",
    "Ofício": "Criar, consertar ou aprimorar itens por meio de técnicas manuais.",
    "Percepção": "Notar detalhes sutis no ambiente ou mudanças ao redor."
  };

  const getSkillDesc = (name) => SKILL_DESC[name] || "";

  // --------------------------
  // Render: Skills (com busca)
  // --------------------------
  function renderSkills() {
    const c = runtime.character;
    const el = $("#tab-skills");
    if (!el) return;

    const ATTR_LABEL = {
      FOR: "Força",
      DES: "Destreza",
      FORT: "Fortitude",
      ARC: "Arcano",
      INT: "Inteligência",
      SAB: "Sabedoria",
    };
    const ORDER = ["FOR", "DES", "FORT", "ARC", "INT", "SAB"];

    const all = [...(c.skills.physical || []), ...(c.skills.intellectual || [])];
    const groups = {};
    for (const s of all) {
      const code = String(s.attribute || "").toUpperCase();
      if (!groups[code]) groups[code] = [];
      groups[code].push(s);
    }

    el.innerHTML = `
      <div class="card">
        <div class="card__head">
          <div>
            <div class="card__title">Perícias</div>
            <div class="card__meta">Pesquise pelo nome. Clique em “Rolar” para 1d20 + Total.</div>
          </div>
        </div>
        <input id="skillSearch" class="input" placeholder="Pesquisar perícia..." style="margin-top:10px;" />
      </div>
      <div class="grid" style="margin-top:12px;"></div>
    `;

    const qEl = $("#skillSearch", el);
    const grid = $(".grid", el);

    const draw = () => {
      const q = (qEl.value || "").trim().toLowerCase();
      grid.innerHTML = "";

      const renderGroup = (code, list) => {
        const title = ATTR_LABEL[code] ? `${ATTR_LABEL[code]} (${code})` : code;
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `
          <div class="card__head">
            <div>
              <div class="card__title">${escapeHtml(title)}</div>
              <div class="card__meta">${escapeHtml(list.length)} perícias</div>
            </div>
          </div>
          <div class="hr"></div>
          <div class="kv"></div>
        `;
        const kv = $(".kv", card);

        const sorted = [...list].sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));

        for (const s of sorted) {
          if (q && !s.name.toLowerCase().includes(q)) continue;

          const row = document.createElement("div");
          row.style.display = "contents";
          const sk = keyOf(s.name);
          const desc = getSkillDesc(s.name);

          row.innerHTML = `
            <div class="kv__k">
              <div class="skillName">${escapeHtml(s.name)}</div>
              ${desc ? `<div class="skillDesc">${escapeHtml(desc)}</div>` : ``}
            </div>
            <div class="kv__v">
              <span class="badge">${Number.isFinite(s.total) ? s.total : 0}</span>
              <button class="btn btn--ghost" data-roll="1d20 + @skills.${escapeHtml(code)}.${escapeHtml(sk)}.total" data-title="Perícia — ${escapeHtml(s.name)}">Rolar</button>
            </div>
          `;
          kv.appendChild(row);
        }

        // se filtrou e não sobrou nada, não mostra o card
        if (!kv.children.length) return null;
        return card;
      };

      for (const code of ORDER) {
        const list = groups[code] || [];
        if (!list.length) continue;
        const card = renderGroup(code, list);
        if (card) grid.appendChild(card);
      }

      // outros códigos (se existirem)
      const extra = Object.keys(groups).filter(c0 => !ORDER.includes(c0));
      for (const code of extra) {
        const card = renderGroup(code, groups[code]);
        if (card) grid.appendChild(card);
      }

      $$("[data-roll]", grid).forEach((btn) => {
        btn.addEventListener("click", () => {
          AudioFX.click();
          doRoll(btn.dataset.roll, btn.dataset.title || "Perícia");
        });
      });
    };

    qEl.addEventListener("input", draw);
    draw();
  }

  // --------------------------
  // Ability rendering (combate / exclusivas)
  // --------------------------
  function renderAbilityList(container, abilities, opts = {}) {
    const { sectionTitle = "", hint = "", searchId = "" } = opts;

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
      ${searchId ? `<input id="${escapeHtml(searchId)}" class="input" placeholder="Pesquisar..." style="margin-top:10px;" />` : ""}
      <div class="hr"></div>
      <div class="grid"></div>
    `;

    const grid = $(".grid", wrap);
    grid.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";

    const input = searchId ? $(`#${CSS.escape(searchId)}`, wrap) : null;

    const draw = () => {
      const q = (input?.value || "").trim().toLowerCase();
      grid.innerHTML = "";

      for (const a of abilities) {
        if (q && !(a.name || "").toLowerCase().includes(q)) continue;

        const card = document.createElement("div");
        card.className = "card";

        const type = a.type || "";
        const level = a.level != null ? `Nível ${a.level}` : "";
        const icon = a.icon ? `${a.icon} ` : "";
        const cost = a.auto_cost && Object.keys(a.auto_cost).length ? formatCost(a.auto_cost) : "";

        const rolls = Array.isArray(a.rolls) ? a.rolls : [];

        // Combos: se tem Teste e Dano, cria botão Atacar (gasta custo 1x)
        const hasTest = rolls.some(r => (r.label || "").toLowerCase().includes("teste"));
        const hasDmg = rolls.some(r => (r.label || "").toLowerCase().includes("dano"));

        // Weapon damage input (arma pesada)
        const weaponKey = (a.ui && a.ui.weapon_damage_input) ? "heavy" : null;
        const baseDefault = a.ui?.weapon_damage_default || runtime.state.ui.weaponDamage.heavy || "2d6";

        if (weaponKey && !runtime.state.ui.weaponDamage[weaponKey]) {
          runtime.state.ui.weaponDamage[weaponKey] = baseDefault;
          saveState();
        }

        const isAbsorb = (a.name || "").toLowerCase().includes("absorver sangue");
        const usedOnce = !!runtime.state.combat.used[a.name];

        const conditionBlood = isAbsorb ? !!runtime.state.ui.conditions.bloodOnGround : true;

        const canUse = (!cost || canSpend(a.auto_cost)) && (!usedOnce) && (conditionBlood);

        // roll buttons (exceto arma pesada, que ganha um botão "Dano" custom)
        const rollBtns = rolls.map((r) => {
          return `<button class="btn btn--ghost" data-roll="${escapeHtml(r.expr)}" data-title="${escapeHtml(r.label || "Rolar")}">${escapeHtml(r.label || "Rolar")}</button>`;
        }).join("");

        const attackBtn = (hasTest && (hasDmg || weaponKey)) ? `<button class="btn" data-attack="1">Atacar (-${cost || "1 PVO"})</button>` : "";

        const useBtn = (!attackBtn && (type.toLowerCase().includes("ativa") || cost)) ? `
          <button class="btn" data-use="1" ${canUse ? "" : "disabled"}>${usedOnce ? "Usado (1x combate)" : `Usar (-${cost || "1"})`}</button>
        ` : "";

        const extraUI = [
          weaponKey ? `
            <div style="margin-top:10px;">
              <div class="small">Dano base da arma pesada:</div>
              <input class="input" data-weapon-input="heavy" value="${escapeHtml(runtime.state.ui.weaponDamage.heavy || baseDefault)}" />
              <div class="small" style="margin-top:6px;">Ex: 2d10, 1d12, 3d6...</div>
            </div>
          ` : "",
          isAbsorb ? `
            <div style="margin-top:10px;">
              <label class="toggle" style="display:inline-flex;">
                <input type="checkbox" data-blood-toggle ${conditionBlood ? "checked" : ""} />
                <span>Sangue inimigo no chão</span>
              </label>
              <div class="small" style="margin-top:6px;">Condição necessária para usar a habilidade.</div>
            </div>
          ` : ""
        ].join("");

        card.innerHTML = `
          <div class="card__head">
            <div>
              <div class="card__title">${escapeHtml(icon)}${escapeHtml(a.name || "Habilidade")}</div>
              <div class="card__meta">${escapeHtml([level, type].filter(Boolean).join(" • "))}</div>
            </div>
            <div class="badges">
              ${type ? `<span class="badge">${escapeHtml(type)}</span>` : ""}
              ${level ? `<span class="badge">${escapeHtml(level)}</span>` : ""}
            </div>
          </div>

          <div class="card__text">${escapeHtml(a.text || "")}</div>
          ${extraUI}
          <div class="card__actions">
            ${attackBtn}
            ${useBtn}
            ${rollBtns}
            ${weaponKey ? `<button class="btn btn--ghost" data-heavy-dmg="1">Dano</button>` : ""}
          </div>
        `;

        // events
        // weapon input
        const wInput = $("[data-weapon-input]", card);
        if (wInput) {
          wInput.addEventListener("input", () => {
            runtime.state.ui.weaponDamage.heavy = wInput.value.trim() || baseDefault;
            saveState();
          });
        }

        // blood condition
        const bloodToggle = $("[data-blood-toggle]", card);
        if (bloodToggle) {
          bloodToggle.addEventListener("change", () => {
            runtime.state.ui.conditions.bloodOnGround = !!bloodToggle.checked;
            saveState();
            draw(); // re-render to enable/disable button
          });
        }

        // custom heavy damage
        const heavyBtn = $("[data-heavy-dmg]", card);
        if (heavyBtn) {
          heavyBtn.addEventListener("click", () => {
            AudioFX.click();
            const base = (runtime.state.ui.weaponDamage.heavy || baseDefault).trim() || baseDefault;
            doRoll(`${base} + @attributes.Força.quarter`, `${a.name || "Arma Pesada"} — Dano`);
          });
        }

        // roll buttons
        $$("[data-roll]", card).forEach((btn) => {
          btn.addEventListener("click", () => {
            AudioFX.click();
            doRoll(btn.dataset.roll, btn.dataset.title || a.name || "Rolar");
          });
        });

        // attack (spend + roll test + roll dmg)
        const atk = $("[data-attack]", card);
        if (atk) {
          atk.addEventListener("click", () => {
            AudioFX.click();

            const costObj = a.auto_cost && Object.keys(a.auto_cost).length ? a.auto_cost : { PVO: 1 };

            if (!canSpend(costObj)) {
              AudioFX.error();
              toast("Sem recurso", null, `Falta: ${formatCost(costObj)}`, []);
              return;
            }

            spend(costObj, a.name || "Ataque");

            // rola teste
            const test = rolls.find(r => (r.label || "").toLowerCase().includes("teste"));
            if (test) doRoll(test.expr, `${a.name} — Teste`);

            // rola dano
            const dmg = rolls.find(r => (r.label || "").toLowerCase().includes("dano"));
            if (dmg) doRoll(dmg.expr, `${a.name} — Dano`);
            else if (weaponKey) {
              const base = (runtime.state.ui.weaponDamage.heavy || baseDefault).trim() || baseDefault;
              doRoll(`${base} + @attributes.Força.quarter`, `${a.name} — Dano`);
            }
          });
        }

        // use (custo + efeito)
        const use = $("[data-use]", card);
        if (use) {
          use.addEventListener("click", () => {
            AudioFX.click();

            const costObj = a.auto_cost || {};
            if (costObj && Object.keys(costObj).length && !canSpend(costObj)) {
              AudioFX.error();
              toast("Sem recurso", null, `Falta: ${formatCost(costObj)}`, []);
              return;
            }

            if (isAbsorb) {
              if (!runtime.state.ui.conditions.bloodOnGround) {
                AudioFX.error();
                toast("Condição não atendida", null, "Precisa haver sangue inimigo no chão.", []);
                return;
              }
              if (runtime.state.combat.used[a.name]) {
                AudioFX.error();
                toast("Limite", null, "Só 1 vez por combate.", []);
                return;
              }
            }

            if (costObj && Object.keys(costObj).length) spend(costObj, a.name || "Habilidade");

            // efeito especial: cura % max
            if (a.effect && a.effect.type === "heal_percent") {
              const track = a.effect.track || "PS";
              const max = runtime.character.stats.tracks[track]?.max ?? 0;
              const amount = Math.floor(max * Number(a.effect.percent || 0));
              heal(track, amount, a.name || "Cura");

              if (a.effect.limit === "once_per_combat") {
                runtime.state.combat.used[a.name] = true;
                saveState();
                draw();
              }

              AudioFX.success();
              toast("Habilidade", "OK", `${a.name}\nCura: ${amount} ${track}\nCusto: ${formatCost(costObj)}`, []);
              logLine(`Usou: ${a.name} (cura ${amount} ${track})`);
              return;
            }

            AudioFX.success();
            toast("Habilidade", "OK", `${a.name}\nCusto: ${formatCost(costObj)}`, []);
            logLine(`Usou: ${a.name} (custo ${formatCost(costObj)})`);
          });
        }

        grid.appendChild(card);
      }
    };

    if (input) input.addEventListener("input", draw);
    draw();

    container.appendChild(wrap);
  }

  function renderCombat() {
    const el = $("#tab-combat");
    if (!el) return;
    el.innerHTML = "";

    const list = runtime.character.abilities?.combat_tree || [];
    renderAbilityList(el, list, {
      sectionTitle: "Combate",
      hint: "Ações ofensivas gastam PVO. Use “Atacar” para rolar teste+dano e gastar custo automaticamente.",
      searchId: "combatSearch"
    });
  }

  function renderExclusive() {
    const el = $("#tab-exclusive");
    if (!el) return;
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

    const list = (ex.abilities || []).map((a) => ({
      name: a.name,
      type: a.type,
      icon: "",
      level: null,
      text: buildExclusiveText(a),
      rolls: a.rolls || [],
      auto_cost: a.auto_cost || {},
      effect: a.effect || null
    }));

    renderAbilityList(el, list, {
      sectionTitle: "Exclusivas",
      hint: "Custos são descontados automaticamente. Algumas têm limite por combate.",
      searchId: "exclusiveSearch"
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
  // Sidebar roller
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

  // --------------------------
  // Topbar buttons
  // --------------------------
  function wireTopbar() {
    const soundToggle = $("#soundToggle");
    const motionToggle = $("#motionToggle");

    soundToggle.checked = !!runtime.state.settings.sound;
    motionToggle.checked = !!runtime.state.settings.reducedMotion;
    AudioFX.setEnabled(!!runtime.state.settings.sound);

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

    $("#btnNewRound").addEventListener("click", () => {
      AudioFX.click();
      // nova rodada: restaura PVs
      runtime.state.tracks.PVO = runtime.character.stats.tracks.PVO?.max ?? runtime.state.tracks.PVO;
      runtime.state.tracks.PVD = runtime.character.stats.tracks.PVD?.max ?? runtime.state.tracks.PVD;
      renderTracks();
      saveState();
      logLine("Nova rodada: PVO e PVD restaurados.");
      toast("Nova rodada", "OK", "PVO e PVD restaurados ao máximo.", []);
      AudioFX.success();
    });

    $("#btnFullReset").addEventListener("click", () => {
      AudioFX.click();
      resetTracksToMax();
      runtime.state.combat.used = {};
      renderTracks();
      saveState();
      logLine("Reset total: PS/PVO/PVD/PF restaurados ao máximo; limites por combate resetados.");
      toast("Reset total", "OK", "Tudo restaurado ao máximo e combate resetado.", []);
      AudioFX.success();
    });

    // Novo combate (cria no HTML como btnNewCombat? no seu layout é btnNewRound, btnFullReset
    // No seu index.html existe btnNewRound e btnFullReset; e também btnNewCombat em versões anteriores.
    // Vamos suportar se existir.
    const btnNewCombat = $("#btnNewCombat");
    if (btnNewCombat) {
      btnNewCombat.addEventListener("click", () => {
        AudioFX.click();
        runtime.state.combat.used = {};
        runtime.state.ui.conditions.bloodOnGround = false;
        runtime.state.tracks.PVO = runtime.character.stats.tracks.PVO?.max ?? runtime.state.tracks.PVO;
        runtime.state.tracks.PVD = runtime.character.stats.tracks.PVD?.max ?? runtime.state.tracks.PVD;
        renderTracks();
        renderCombat();
        renderExclusive();
        saveState();
        logLine("Novo combate: limites resetados; PVs restaurados.");
        toast("Novo combate", "OK", "Limites por combate resetados.", []);
        AudioFX.success();
      });
    }
  }

  // --------------------------
  // Tabs wire
  // --------------------------
  function wireTabs() {
    $("#tabs").addEventListener("click", (e) => {
      const btn = e.target.closest(".tab");
      if (!btn) return;
      AudioFX.click();
      activateTab(btn.dataset.tab);
    });
  }

  // --------------------------
  // Log controls
  // --------------------------
  function wireLogButtons() {
    $("#btnClearLog").addEventListener("click", () => {
      AudioFX.click();
      runtime.state.log = [];
      $("#log").textContent = "";
      saveState();
      toast("Log", "OK", "Log limpo.", []);
    });

    $("#btnCopyLog").addEventListener("click", async () => {
      AudioFX.click();
      try {
        await navigator.clipboard.writeText(runtime.state.log.join("\n"));
        toast("Log", "OK", "Copiado para a área de transferência.", []);
        AudioFX.success();
      } catch {
        toast("Log", null, "Não consegui copiar automaticamente. Selecione e copie manualmente.", []);
        AudioFX.error();
      }
    });
  }

  // --------------------------
  // Load character data
  // --------------------------
  async function loadCharacter() {
    // 1) tenta pegar do HTML (funciona offline)
    const tag = document.getElementById("characterData");
    if (tag && tag.textContent && tag.textContent.trim().startsWith("{")) {
      return JSON.parse(tag.textContent);
    }

    // 2) fallback: busca do arquivo (funciona no Pages)
    const res = await fetch("./data/character.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Não consegui carregar data/character.json");
    return res.json();
  }

  // --------------------------
  // Boot
  // --------------------------
  async function boot() {
    runtime.character = await loadCharacter();

    // state
    const saved = loadState();
    runtime.state = saved ? {
      ...defaultState(runtime.character),
      ...saved,
      settings: { ...defaultState(runtime.character).settings, ...(saved.settings || {}) },
      ui: { ...defaultState(runtime.character).ui, ...(saved.ui || {}) },
      combat: { ...defaultState(runtime.character).combat, ...(saved.combat || {}) },
    } : defaultState(runtime.character);

    // Regras do Pedro: sempre começar PS/PV/PF no máximo (PV dividido também)
    resetTracksToMax();

    // UI meta
    $("#charName").textContent = runtime.character.meta?.name || "Ficha";
    const metaPieces = [];
    if (runtime.character.meta?.race?.name) metaPieces.push(`${runtime.character.meta.race.name}${runtime.character.meta.race.level ? " " + runtime.character.meta.race.level : ""}`);
    if (runtime.character.meta?.class?.name) metaPieces.push(`${runtime.character.meta.class.name}${runtime.character.meta.class.level ? " " + runtime.character.meta.class.level : ""}`);
    $("#charMeta").textContent = metaPieces.join(" • ") || "—";

    // wires
    wireTabs();
    wireTopbar();
    wireRoller();
    wireLogButtons();

    // initial renders
    renderTracks();
    $("#log").textContent = runtime.state.log.join("\n");

    renderOverview();
    renderAttributes();
    renderSkills();
    renderCombat();
    renderExclusive();

    // Log
    logLine("Ficha carregada. Bom jogo.");
  }

  boot().catch((e) => {
    console.error(e);
    alert(String(e?.message || e));
  });
})();
