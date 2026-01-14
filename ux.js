// UX enhancements (Etapa 3)
// - Copiar/Limpar log
// - Flash visual em mudanças de PS/PF/PVO/PVD
// - Toasts discretos para eventos importantes

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
      return { title: 'Sem recurso', detail: line.replace(/^\[[^\]]+\]\s*/, ''), type: 'bad' };
    }

    if(l.includes('reset total')){
      return { title: 'Reset total', detail: 'Tudo voltou ao máximo e o log foi reiniciado.', type: 'bad' };
    }

    if(l.includes('novo combate')){
      return { title: 'Novo combate', detail: 'Rodada e ações reiniciadas.', type: '' };
    }

    if(l.includes('nova rodada')){
      return { title: 'Nova rodada', detail: 'PVO/PVD restaurados.', type: '' };
    }

    if(l.includes('arma sanguenta')){
      return { title: 'Arma Sanguenta', detail: line.replace(/^\[[^\]]+\]\s*/, ''), type: '' };
    }

    if(l.includes('plasma ativado')){
      return { title: 'Plasma ativado', detail: line.replace(/^\[[^\]]+\]\s*/, ''), type: '' };
    }

    if(l.startsWith('sorte:') || l.includes('sorte:')){
      return { title: 'Sorte', detail: line.replace(/^\[[^\]]+\]\s*/, ''), type: 'good' };
    }

    return null;
  }

  function setupLogToasts(){
    const logEl = document.getElementById('log');
    if(!logEl) return;

    let lastFirstLine = '';

    const obs = new MutationObserver(() => {
      const txt = String(logEl.textContent || '');
      const firstLine = (txt.split('\n')[0] || '').trim();
      if(!firstLine || firstLine === lastFirstLine) return;
      lastFirstLine = firstLine;

      const info = classifyToastFromLogLine(firstLine);
      if(info) toast(info.title, info.detail, info.type);
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

  function waitForAppReady(){
    // Se o app já estiver pronto, dispara setup imediatamente
    if(window.__tats && window.__tats.state){
      setupLogTools();
      setupTrackFlash();
      setupLogToasts();
      return;
    }

    document.addEventListener('tats-ready', () => {
      setupLogTools();
      setupTrackFlash();
      setupLogToasts();
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
      }
      if(tries > 60) clearInterval(timer);
    }, 100);
  }

  document.addEventListener('DOMContentLoaded', () => {
    waitForAppReady();
  });
})();
