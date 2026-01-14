// SFX (Etapa 5) — efeitos sonoros leves usando WebAudio (sem arquivos)
// - Toggle ON/OFF + volume (persistente)
// - Sons: click, roll, error, sangue, plasma, turno/rodada
// Nota: o áudio só desbloqueia após interação do usuário (limitação do navegador)

(function(){
  const STORAGE_KEY = 'tats_sfx:v1';

  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  function load(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return { enabled: true, volume: 0.35 };
      const j = JSON.parse(raw);
      return {
        enabled: (j.enabled !== false),
        volume: clamp(Number(j.volume ?? 0.35), 0, 1)
      };
    }catch(_){
      return { enabled: true, volume: 0.35 };
    }
  }

  function save(){
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); }catch(_){/* ignore */}
  }

  const settings = load();

  let ctx = null;
  let master = null;

  function canAudio(){
    return !!(window.AudioContext || window.webkitAudioContext);
  }

  function ensure(){
    if(!canAudio()) return null;
    if(ctx) return ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    ctx = new Ctx();
    master = ctx.createGain();
    master.gain.value = settings.volume;
    master.connect(ctx.destination);
    return ctx;
  }

  async function unlock(){
    const c = ensure();
    if(!c) return;
    if(c.state === 'suspended'){
      try{ await c.resume(); }catch(_){/* ignore */}
    }
  }

  function setEnabled(v){
    settings.enabled = !!v;
    save();
    updateUI();
  }

  function setVolume(v01){
    settings.volume = clamp(Number(v01), 0, 1);
    if(master) master.gain.value = settings.volume;
    save();
    updateUI();
  }

  function envGain(g, t0, peak, atk, dec){
    g.gain.cancelScheduledValues(t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t0 + Math.max(0.001, atk));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.02, atk + dec));
  }

  function tone(freqStart, freqEnd, dur, type, peak){
    if(!settings.enabled) return;
    const c = ensure();
    if(!c || !master) return;
    const t0 = c.currentTime;

    const o = c.createOscillator();
    const g = c.createGain();

    o.type = type || 'triangle';
    o.frequency.setValueAtTime(freqStart, t0);
    if(freqEnd != null && Number(freqEnd) !== Number(freqStart)){
      try{ o.frequency.exponentialRampToValueAtTime(Math.max(10, freqEnd), t0 + dur); }catch(_){
        o.frequency.linearRampToValueAtTime(freqEnd, t0 + dur);
      }
    }

    envGain(g, t0, peak ?? 0.18, 0.006, dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  function noiseBurst(dur, peak, hpHz, lpHz){
    if(!settings.enabled) return;
    const c = ensure();
    if(!c || !master) return;
    const t0 = c.currentTime;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for(let i=0;i<len;i++) data[i] = (Math.random()*2-1);

    const src = c.createBufferSource();
    src.buffer = buf;

    const g = c.createGain();
    envGain(g, t0, peak ?? 0.10, 0.003, dur);

    let node = src;
    if(hpHz){
      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(hpHz, t0);
      node.connect(hp);
      node = hp;
    }
    if(lpHz){
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(lpHz, t0);
      node.connect(lp);
      node = lp;
    }

    node.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // --- Presets ---
  function s_click(){
    tone(260, 240, 0.045, 'triangle', 0.10);
  }

  function s_roll(){
    // pequenos "tics" + ruído curtinho
    const c = ensure();
    if(!c) return;
    const base = c.currentTime;
    for(let i=0;i<4;i++){
      setTimeout(() => {
        tone(360 + Math.random()*220, 180 + Math.random()*120, 0.06, 'square', 0.08);
        noiseBurst(0.035, 0.05, 900, 3500);
      }, i*32);
    }
  }

  function s_error(){
    tone(220, 90, 0.18, 'sawtooth', 0.15);
    noiseBurst(0.05, 0.06, 500, 1400);
  }

  function s_blood(){
    tone(120, 70, 0.22, 'sine', 0.18);
    noiseBurst(0.08, 0.07, 180, 1400);
  }

  function s_plasma(){
    tone(720, 1600, 0.16, 'triangle', 0.14);
    noiseBurst(0.05, 0.05, 1100, 7000);
  }

  function s_turn(){
    tone(260, 320, 0.10, 'triangle', 0.09);
  }

  function s_round(){
    tone(320, 420, 0.12, 'triangle', 0.10);
  }

  function s_reset(){
    tone(200, 120, 0.22, 'sawtooth', 0.16);
  }

  function play(name){
    if(!settings.enabled) return;
    // sempre tenta desbloquear antes de tocar
    unlock();
    switch(String(name || '')){
      case 'click': return s_click();
      case 'roll': return s_roll();
      case 'error': return s_error();
      case 'blood': return s_blood();
      case 'plasma': return s_plasma();
      case 'turn': return s_turn();
      case 'round': return s_round();
      case 'reset': return s_reset();
      default: return s_click();
    }
  }

  // --- UI wiring ---
  function updateUI(){
    const tgl = document.getElementById('sfxToggle');
    const vol = document.getElementById('sfxVolume');

    if(tgl){
      tgl.textContent = settings.enabled ? 'Som: ON' : 'Som: OFF';
      tgl.setAttribute('aria-pressed', settings.enabled ? 'true' : 'false');
      tgl.classList.toggle('btn-danger', !settings.enabled);
    }
    if(vol){
      const v = Math.round(settings.volume * 100);
      if(String(vol.value) !== String(v)) vol.value = String(v);
      vol.disabled = !settings.enabled;
      vol.style.opacity = settings.enabled ? '1' : '.55';
    }
  }

  function setupControls(){
    const tgl = document.getElementById('sfxToggle');
    const vol = document.getElementById('sfxVolume');

    if(tgl){
      tgl.addEventListener('click', () => {
        setEnabled(!settings.enabled);
        // um click de feedback (quando liga)
        if(settings.enabled) play('click');
      });
    }
    if(vol){
      vol.addEventListener('input', () => {
        const v01 = clamp(Number(vol.value) / 100, 0, 1);
        setVolume(v01);
      });
      vol.addEventListener('change', () => {
        // pequena confirmação
        if(settings.enabled) play('click');
      });
    }

    updateUI();
  }

  // Click global (leve) — não toca em sliders/inputs
  function setupGlobalClicks(){
    document.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('button');
      if(!btn) return;

      // Não duplica sons de efeitos: esses vêm do log
      const noClick = new Set(['use_sanguenta', 'toggle_plasma']);
      if(noClick.has(btn.id)) return;

      // Roll buttons
      const txt = String(btn.textContent || '').toLowerCase();
      if(btn.id === 'roll_luck' || txt.includes('rolar') || txt.includes('teste') || txt.includes('dano')){
        play('roll');
      }else{
        play('click');
      }
    }, { capture: true });
  }

  // Expose a small API so ux.js can trigger event-based sfx
  window.__sfx = {
    play,
    setEnabled,
    setVolume,
    get enabled(){ return settings.enabled; },
    get volume(){ return settings.volume; }
  };

  document.addEventListener('DOMContentLoaded', () => {
    setupControls();
    setupGlobalClicks();
  });
})();
