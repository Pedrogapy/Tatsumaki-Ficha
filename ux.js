// UX enhancements (Etapa 3)
// - Copiar/Limpar log
// - Flash visual em mudanças de PS/PF/PVO/PVD
// - Toasts discretos para eventos importantes
//
// Etapa 4
// - Botões de ajuste rápido no HUD (PS/PF/PVO/PVD)
// - Filtro + busca no log (Tudo/Rolagens/Recursos/Efeitos)

(function(){
  const qs = (sel) => document.querySelector(sel);

  function ensureToastHost(){
    let host = document.getElementById('toastHost');
    if(!host){
      host = document.createElement('div');
      host.id = 'toastHost';
      host.className = 'toastHost';
      host.setAttribute('aria-live', 'polite');
      host.setAttribute('aria-atomic', 'true');
      document.body.appendChild(host);
    }
    return host;
  }

  function toast(title, detail, type){
    const host = ensureToastHost();
    const el = document.createElement('div');
    el.className = `toast ${type || ''}`.trim();

    const strong = document.createElement('div');
    strong.textContent = title || 'OK';
    el.appendChild(strong);

    if(detail){
      const small = document.createElement('small');
      small.textContent = detail;
      el.appendChild(small);
    }

    host.appendChild(el);
    // remove depois de um tempo
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      el.style.transition = 'opacity .18s ease, transform .18s ease';
      setTimeout(() => el.remove(), 220);
    }, 2200);
  }

  async function copyTextToClipboard(text){
    try{
      await navigator.clipboard.writeText(text);
      return true;
    }catch(_){
      try{
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      }catch(__){
        return false;
      }
    }
  }

  function parseCurrentFromTrackText(txt){
    // "12/100" -> 12
    const m = String(txt || '').trim().match(/^(-?\d+)\s*\//);
    if(!m) return null;
    const v = Number(m[1]);
    return Number.isFinite(v) ? v : null;
  }

  function flashTrack(parent, dir){
    if(!parent) return;
    parent.classList.remove('flash-up', 'flash-down');
    parent.classList.add(dir === 'up' ? 'flash-up' : 'flash-down');
    setTimeout(() => parent.classList.remove('flash-up', 'flash-down'), 620);
  }

  function setupTrackFlash(){
    const ids = ['ps', 'pf', 'pvo', 'pvd'];
    const last = {};

    for(const id of ids){
      const el = document.getElementById(id);
      if(!el) continue;
      last[id] = parseCurrentFromTrackText(el.textContent);

      const obs = new MutationObserver(() => {
        const cur = parseCurrentFromTrackText(el.textContent);
        const prev = last[id];
        if(cur === null || prev === null || cur === prev){
          last[id] = cur;
          return;
        }

        const parent = el.closest('.track');
        flashTrack(parent, cur > prev ? 'up' : 'down');
        last[id] = cur;
      });

      obs.observe(el, { childList: true, characterData: true, subtree: true });
    }
  }

  function classifyToastFromLogLine(line){
    const l = String(line || '').toLowerCase();

    if(l.includes('sem recurso')){
      return { title: 'Sem recurso', detail: line.replace(/^\[[^\]]+\]\s*/, ''), type: 'bad', sfx: 'error' };
    }

    if(l.includes('reset total')){
      return { title: 'Reset total', detail: 'Tudo voltou ao máximo e o log foi reiniciado.', type: 'bad', sfx: 'reset' };
    }

    if(l.includes('novo combate')){
      return { title: 'Novo combate', detail: 'Rodada e ações reiniciadas.', type: '', sfx: 'round' };
    }

    if(l.includes('nova rodada')){
      return { title: 'Nova rodada', detail: 'PVO/PVD restaurados.', type: '', sfx: 'round' };
    }

    if(l.includes('turno iniciado')){
      return { title: 'Turno', detail: line.replace(/^\[[^\]]+\]\s*/, ''), type: '', sfx: 'turn' };
    }

    if(l.includes('arma sanguenta')){
      return { title: 'Arma Sanguenta', detail: line.replace(/^\[[^\]]+\]\s*/, ''), type: '', sfx: 'blood' };
    }

    if(l.includes('plasma ativado')){
      return { title: 'Plasma ativado', detail: line.replace(/^\[[^\]]+\]\s*/, ''), type: '', sfx: 'plasma' };
    }

    if(l.includes('plasma desligado')){
      return { title: 'Plasma desligado', detail: line.replace(/^\[[^\]]+\]\s*/, ''), type: '', sfx: 'click' };
    }

    if(l.startsWith('sorte:') || l.includes('sorte:')){
      return { title: 'Sorte', detail: line.replace(/^\[[^\]]+\]\s*/, ''), type: 'good', sfx: 'roll' };
    }

    return null;
  }

  function setupLogToasts(){
    const logEl = document.getElementById('log');
    if(!logEl) return;

    let lastFirstLine = '';

    const obs = new MutationObserver(() => {
      try{
        if(window.__tatsUx && typeof window.__tatsUx.suppressToasts === 'function' && window.__tatsUx.suppressToasts()){
          return;
        }
      }catch(_){/* ignore */}

      const txt = String(logEl.textContent || '');
      const firstLine = (txt.split('\n')[0] || '').trim();
      if(!firstLine || firstLine === lastFirstLine) return;
      lastFirstLine = firstLine;

      const info = classifyToastFromLogLine(firstLine);
      if(info){
        toast(info.title, info.detail, info.type);
        try{ window.__sfx?.play?.(info.sfx || (info.type === 'bad' ? 'error' : 'click')); }catch(_){/* ignore */}
      }
    });

    obs.observe(logEl, { childList: true, characterData: true, subtree: true });
  }

  function setupLogTools(){
    const copyBtn = qs('#copyLog');
    const clearBtn = qs('#clearLog');
    const logEl = qs('#log');

    if(copyBtn && logEl){
      copyBtn.addEventListener('click', async () => {
        const ok = await copyTextToClipboard(logEl.textContent || '');
        toast(ok ? 'Log copiado' : 'Não consegui copiar', ok ? 'Colado na área de transferência.' : 'Seu navegador bloqueou a cópia.', ok ? 'good' : 'bad');
      });
    }

    if(clearBtn){
      clearBtn.addEventListener('click', () => {
        const api = window.__tats;
        if(api && api.state){
          api.state.logLines = [];
          api.saveState?.();
          api.renderLog?.();
          toast('Log limpo', 'Apaguei o histórico do combate.', '');
          return;
        }
        // fallback visual
        if(logEl) logEl.textContent = '';
        toast('Log limpo', 'Apaguei o texto (o histórico pode voltar ao recarregar).', '');
      });
    }
  }

  function clamp(n, min, max){
    if(!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function trackLabel(key){
    const k = String(key || '').toLowerCase();
    if(k === 'ps') return 'PS';
    if(k === 'pf') return 'PF';
    if(k === 'pvo') return 'PVO';
    if(k === 'pvd') return 'PVD';
    return k.toUpperCase();
  }

  function setupTrackControls(){
    const btns = Array.from(document.querySelectorAll('.trackControls button'));
    if(!btns.length) return;

    const api = window.__tats;
    if(!api || !api.state || !api.MAX) return;

    function setTrack(key, next, reason){
      const k = String(key || '').toLowerCase();
      if(typeof api.state[k] !== 'number') return;

      const max = Number(api.MAX[k] ?? api.state[k]);
      const cur = Number(api.state[k]);
      const v = clamp(Number(next), 0, max);
      if(v === cur) return;

      api.state[k] = v;
      api.render?.();
      api.log?.(`${trackLabel(k)} ${reason || 'ajustado'}: ${cur} → ${v}/${max}`);
    }

    function addDelta(key, delta){
      const k = String(key || '').toLowerCase();
      if(typeof api.state[k] !== 'number') return;
      const max = Number(api.MAX[k] ?? api.state[k]);
      const cur = Number(api.state[k]);
      const next = clamp(cur + Number(delta), 0, max);
      if(next === cur) return;
      api.state[k] = next;
      api.render?.();
      const sign = delta > 0 ? `+${delta}` : String(delta);
      api.log?.(`${trackLabel(k)} ${sign}: ${next}/${max}`);
    }

    btns.forEach(b => {
      b.addEventListener('click', () => {
        const k = b.dataset.track;
        if(!k) return;

        if(b.dataset.reset){
          const max = Number(api.MAX[String(k).toLowerCase()] ?? 0);
          setTrack(k, max, 'max');
          return;
        }

        if(b.dataset.set){
          const cur = Number(api.state[String(k).toLowerCase()] ?? 0);
          const max = Number(api.MAX[String(k).toLowerCase()] ?? cur);
          const raw = prompt(`Definir ${trackLabel(k)} (0 a ${max})`, String(cur));
          if(raw == null) return;
          const n = Number(String(raw).trim().replace(',', '.'));
          if(!Number.isFinite(n)){
            toast('Valor inválido', `Não entendi: "${raw}"`, 'bad');
            try{ window.__sfx?.play?.('error'); }catch(_){/* ignore */}
            return;
          }
          setTrack(k, n, 'set');
          return;
        }

        const d = Number(b.dataset.delta ?? 0);
        if(Number.isFinite(d) && d !== 0){
          addDelta(k, d);
        }
      });
    });
  }

  function classifyLogLine(line, kind){
    const l = String(line || '').toLowerCase();
    if(kind === 'rolls'){
      return l.includes('=>') || l.includes('1d20') || l.includes('dano');
    }
    if(kind === 'resources'){
      return /\b(ps|pf|pvo|pvd)\b/.test(l) || l.includes('sem recurso') || l.includes('restaurados');
    }
    if(kind === 'effects'){
      return l.includes('sanguenta') || l.includes('plasma') || l.includes('aura');
    }
    return true;
  }

  function setupLogFilter(){
    const api = window.__tats;
    const kindEl = document.getElementById('logKind');
    const searchEl = document.getElementById('logSearch');
    const logEl = document.getElementById('log');
    if(!api || !api.state || !logEl || !kindEl || !searchEl) return;

    let suppressToastsUntil = 0;
    window.__tatsUx = window.__tatsUx || {};
    window.__tatsUx.suppressToasts = () => (Date.now() < suppressToastsUntil);

    function apply(){
      const kind = String(kindEl.value || 'all');
      const q = String(searchEl.value || '').trim().toLowerCase();
      const lines = Array.isArray(api.state.logLines) ? api.state.logLines : [];

      let out = lines;
      if(kind !== 'all') out = out.filter(l => classifyLogLine(l, kind));
      if(q) out = out.filter(l => String(l).toLowerCase().includes(q));

      const desired = out.join('\n');
      if(logEl.textContent !== desired) logEl.textContent = desired;
    }

    kindEl.addEventListener('change', () => {
      suppressToastsUntil = Date.now() + 350;
      apply();
    });
    searchEl.addEventListener('input', () => {
      suppressToastsUntil = Date.now() + 350;
      apply();
    });

    // Sempre que o app re-renderizar o log, reaplica filtro se necessário
    const obs = new MutationObserver(() => {
      if(String(kindEl.value) !== 'all' || String(searchEl.value).trim()){
        apply();
      }
    });
    obs.observe(logEl, { childList: true, characterData: true, subtree: true });
  }

  function waitForAppReady(){
    // Se o app já estiver pronto, dispara setup imediatamente
    if(window.__tats && window.__tats.state){
      setupLogTools();
      setupTrackFlash();
      setupLogToasts();
      setupTrackControls();
      setupLogFilter();
      return;
    }

    document.addEventListener('tats-ready', () => {
      setupLogTools();
      setupTrackFlash();
      setupLogToasts();
      setupTrackControls();
      setupLogFilter();
    }, { once: true });

    // fallback: tenta por um tempo
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      if(window.__tats && window.__tats.state){
        clearInterval(timer);
        setupLogTools();
        setupTrackFlash();
        setupLogToasts();
        setupTrackControls();
        setupLogFilter();
      }
      if(tries > 60) clearInterval(timer);
    }, 100);
  }

  document.addEventListener('DOMContentLoaded', () => {
    waitForAppReady();
  });
})();
