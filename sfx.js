// SFX (Etapa 5 + 6) — efeitos sonoros via WebAudio (sem arquivos)
// - Toggle ON/OFF + volume (persistente)
// - Pacotes: Sutil / ShadowHeart / Agressivo
// - Ambiente opcional (OFF por padrão) — respeita a escolha “Sons A”
// Nota: o áudio só desbloqueia após interação do usuário (limitação do navegador)

(function(){
  const KEY_V2 = 'tats_sfx:v2';
  const KEY_V1 = 'tats_sfx:v1';

  const clamp = (n,a,b) => Math.min(b, Math.max(a, n));
  const nowIso = () => new Date().toISOString();

  function load(){
    // migra v1 -> v2 automaticamente
    try{
      const raw2 = localStorage.getItem(KEY_V2);
      if(raw2){
        const j = JSON.parse(raw2);
        return {
          enabled: (j.enabled !== false),
          volume: clamp(Number(j.volume ?? 0.35), 0, 1),
          pack: String(j.pack || 'shadowheart'),
          ambient: !!j.ambient,
          ambientLevel: clamp(Number(j.ambientLevel ?? 0.12), 0, 1)
        };
      }

      const raw1 = localStorage.getItem(KEY_V1);
      if(raw1){
        const j = JSON.parse(raw1);
        return {
          enabled: (j.enabled !== false),
          volume: clamp(Number(j.volume ?? 0.35), 0, 1),
          pack: 'shadowheart',
          ambient: false,
          ambientLevel: 0.12
        };
      }
    }catch(_){/* ignore */}

    return {
      enabled: true,
      volume: 0.35,
      pack: 'shadowheart',
      ambient: false,
      ambientLevel: 0.12
    };
  }

  const settings = load();

  function save(){
    try{
      localStorage.setItem(KEY_V2, JSON.stringify({
        ...settings,
        saved_at: nowIso()
      }));
    }catch(_){/* ignore */}
  }

  // --- WebAudio graph ---
  let ctx = null;
  let master = null;
  let sfxBus = null;
  let sfxSend = null;
  let delay = null;
  let feedback = null;
  let delayFilter = null;
  let ambientBus = null;

  let ambientNodes = null; // {src, gain, stop()}

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

    sfxBus = ctx.createGain();
    sfxBus.gain.value = 1.0;
    sfxBus.connect(master);

    // FX send (delay curto + filtro) — dá a vibe “arcana” sem pesar
    sfxSend = ctx.createGain();
    sfxSend.gain.value = packParams().fxSend;

    delay = ctx.createDelay(1.0);
    delay.delayTime.value = packParams().delayTime;

    feedback = ctx.createGain();
    feedback.gain.value = packParams().delayFeedback;

    delayFilter = ctx.createBiquadFilter();
    delayFilter.type = 'lowpass';
    delayFilter.frequency.value = packParams().delayLP;

    // send -> delay -> filter -> master
    sfxSend.connect(delay);
    delay.connect(delayFilter);
    delayFilter.connect(master);
    // feedback loop
    delayFilter.connect(feedback);
    feedback.connect(delay);

    ambientBus = ctx.createGain();
    ambientBus.gain.value = settings.ambient ? settings.ambientLevel : 0;
    ambientBus.connect(master);

    return ctx;
  }

  async function unlock(){
    const c = ensure();
    if(!c) return;
    if(c.state === 'suspended'){
      try{ await c.resume(); }catch(_){/* ignore */}
    }
    // garante que o ambiente esteja coerente após desbloqueio
    syncAmbient();
  }

  // --- Pack parameters ---
  function packParams(){
    const p = String(settings.pack || 'shadowheart');
    if(p === 'subtle'){
      return { fxSend: 0.02, delayTime: 0.09, delayFeedback: 0.08, delayLP: 1800, gainMul: 0.85 };
    }
    if(p === 'aggressive'){
      return { fxSend: 0.06, delayTime: 0.12, delayFeedback: 0.14, delayLP: 2600, gainMul: 1.10 };
    }
    // shadowheart (padrão)
    return { fxSend: 0.04, delayTime: 0.10, delayFeedback: 0.11, delayLP: 2200, gainMul: 1.00 };
  }

  function applyPack(){
    const c = ensure();
    if(!c) return;
    const pp = packParams();
    if(sfxSend) sfxSend.gain.value = pp.fxSend;
    if(delay) delay.delayTime.value = pp.delayTime;
    if(feedback) feedback.gain.value = pp.delayFeedback;
    if(delayFilter) delayFilter.frequency.value = pp.delayLP;
  }

  // --- Settings setters ---
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

  function setPack(name){
    settings.pack = String(name || 'shadowheart');
    applyPack();
    save();
    updateUI();
  }

  function setAmbient(on){
    settings.ambient = !!on;
    save();
    updateUI();
    syncAmbient();
  }

  function setAmbientLevel(v01){
    settings.ambientLevel = clamp(Number(v01), 0, 1);
    save();
    updateUI();
    syncAmbient();
  }

  // --- helpers (envelopes / nodes) ---
  function envGain(g, t0, peak, atk, dec){
    g.gain.cancelScheduledValues(t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t0 + Math.max(0.001, atk));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.02, atk + dec));
  }

  function connectSfx(node, sendAmount){
    if(!sfxBus || !master) return;
    node.connect(sfxBus);
    if(sfxSend && sendAmount && sendAmount > 0){
      const send = ctx.createGain();
      send.gain.value = sendAmount;
      node.connect(send);
      send.connect(sfxSend);
    }
  }

  function tone(freqStart, freqEnd, dur, type, peak, send){
    if(!settings.enabled) return;
    const c = ensure();
    if(!c) return;
    const pp = packParams();
    const t0 = c.currentTime;

    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || 'triangle';
    o.frequency.setValueAtTime(freqStart, t0);

    if(freqEnd != null && Number(freqEnd) !== Number(freqStart)){
      try{ o.frequency.exponentialRampToValueAtTime(Math.max(10, freqEnd), t0 + dur); }
      catch(_){ o.frequency.linearRampToValueAtTime(freqEnd, t0 + dur); }
    }

    envGain(g, t0, (peak ?? 0.18) * pp.gainMul, 0.006, dur);
    o.connect(g);
    connectSfx(g, send ?? (settings.pack === 'shadowheart' ? 0.05 : 0.03));
    o.start(t0);
    o.stop(t0 + dur + 0.06);
  }

  function noiseBurst(dur, peak, hpHz, lpHz, send){
    if(!settings.enabled) return;
    const c = ensure();
    if(!c) return;
    const pp = packParams();
    const t0 = c.currentTime;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for(let i=0;i<len;i++) data[i] = (Math.random()*2-1);

    const src = c.createBufferSource();
    src.buffer = buf;

    const g = c.createGain();
    envGain(g, t0, (peak ?? 0.10) * pp.gainMul, 0.003, dur);

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
    connectSfx(g, send ?? (settings.pack === 'aggressive' ? 0.07 : 0.04));
    src.start(t0);
    src.stop(t0 + dur + 0.03);
  }

  // --- Presets por pack ---
  function s_click(){
    const p = String(settings.pack);
    if(p === 'subtle'){
      tone(250, 230, 0.045, 'triangle', 0.09, 0.02);
      return;
    }
    if(p === 'aggressive'){
      tone(300, 220, 0.055, 'square', 0.11, 0.05);
      noiseBurst(0.018, 0.05, 1200, 4200, 0.03);
      return;
    }
    // shadowheart
    tone(220, 200, 0.055, 'triangle', 0.10, 0.05);
    noiseBurst(0.016, 0.04, 900, 2800, 0.03);
  }

  function s_roll(){
    const p = String(settings.pack);
    const c = ensure();
    if(!c) return;
    const ticks = (p === 'aggressive') ? 5 : (p === 'subtle' ? 3 : 4);
    const base = c.currentTime;

    for(let i=0;i<ticks;i++){
      setTimeout(() => {
        const f1 = 340 + Math.random()*240;
        const f2 = 160 + Math.random()*140;
        tone(f1, f2, 0.06, (p === 'aggressive' ? 'square' : 'triangle'), 0.09, 0.04);
        noiseBurst(0.030, p === 'aggressive' ? 0.07 : 0.05, 1000, p === 'aggressive' ? 5200 : 3800, 0.04);
      }, i * (p === 'subtle' ? 38 : 32));
    }
  }

  function s_error(){
    const p = String(settings.pack);
    if(p === 'subtle'){
      tone(200, 90, 0.16, 'sawtooth', 0.12, 0.03);
      return;
    }
    if(p === 'aggressive'){
      tone(260, 60, 0.22, 'sawtooth', 0.18, 0.08);
      noiseBurst(0.07, 0.08, 420, 1200, 0.06);
      return;
    }
    // shadowheart
    tone(220, 70, 0.20, 'sawtooth', 0.15, 0.06);
    noiseBurst(0.06, 0.07, 380, 1300, 0.05);
  }

  function s_blood(){
    const p = String(settings.pack);
    if(p === 'subtle'){
      tone(120, 72, 0.18, 'sine', 0.16, 0.05);
      noiseBurst(0.055, 0.05, 160, 1200, 0.04);
      return;
    }
    if(p === 'aggressive'){
      tone(150, 52, 0.26, 'sawtooth', 0.20, 0.09);
      noiseBurst(0.10, 0.09, 120, 1500, 0.07);
      return;
    }
    // shadowheart
    tone(110, 55, 0.24, 'sine', 0.19, 0.08);
    noiseBurst(0.085, 0.08, 130, 1400, 0.06);
  }

  function s_plasma(){
    const p = String(settings.pack);
    if(p === 'subtle'){
      tone(780, 1500, 0.14, 'triangle', 0.13, 0.04);
      noiseBurst(0.04, 0.05, 1200, 7000, 0.04);
      return;
    }
    if(p === 'aggressive'){
      tone(900, 2400, 0.18, 'square', 0.16, 0.07);
      noiseBurst(0.06, 0.07, 1500, 9000, 0.06);
      return;
    }
    // shadowheart
    tone(900, 1700, 0.16, 'triangle', 0.15, 0.06);
    noiseBurst(0.05, 0.06, 1200, 8200, 0.05);
  }

  function s_turn(){
    const p = String(settings.pack);
    tone(240, 320, p === 'subtle' ? 0.08 : 0.10, 'triangle', 0.09, 0.03);
  }

  function s_round(){
    const p = String(settings.pack);
    tone(320, 460, p === 'aggressive' ? 0.14 : 0.12, 'triangle', 0.11, 0.04);
  }

  function s_reset(){
    const p = String(settings.pack);
    if(p === 'subtle'){
      tone(180, 120, 0.18, 'sawtooth', 0.14, 0.05);
      return;
    }
    if(p === 'aggressive'){
      tone(220, 90, 0.26, 'sawtooth', 0.19, 0.10);
      noiseBurst(0.06, 0.07, 420, 1600, 0.06);
      return;
    }
    // shadowheart
    tone(200, 110, 0.22, 'sawtooth', 0.16, 0.07);
    noiseBurst(0.05, 0.06, 380, 1600, 0.05);
  }

  function play(name){
    if(!settings.enabled) return;
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

  // --- Ambient (opcional) ---
  function createAmbient(){
    const c = ensure();
    if(!c || !ambientBus) return null;

    // Drone leve: rumble + hiss filtrado
    const out = c.createGain();
    out.gain.value = settings.ambientLevel;

    // rumble
    const o1 = c.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = 48;

    const o2 = c.createOscillator();
    o2.type = 'sawtooth';
    o2.frequency.value = 96;

    const rumble = c.createGain();
    rumble.gain.value = 0.018;
    o1.connect(rumble);
    o2.connect(rumble);

    const rumbleLP = c.createBiquadFilter();
    rumbleLP.type = 'lowpass';
    rumbleLP.frequency.value = 160;
    rumble.connect(rumbleLP);
    rumbleLP.connect(out);

    // hiss (noise)
    const len = Math.max(1, Math.floor(c.sampleRate * 1.2));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for(let i=0;i<len;i++) data[i] = (Math.random()*2-1);
    const n = c.createBufferSource();
    n.buffer = buf;
    n.loop = true;

    const nHP = c.createBiquadFilter();
    nHP.type = 'highpass';
    nHP.frequency.value = 900;
    const nLP = c.createBiquadFilter();
    nLP.type = 'lowpass';
    nLP.frequency.value = 3200;

    const nGain = c.createGain();
    nGain.gain.value = 0.006;

    n.connect(nHP);
    nHP.connect(nLP);
    nLP.connect(nGain);
    nGain.connect(out);

    // LFO modula o filtro do hiss, dá “vida” sem virar música
    const lfo = c.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.12;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 450;
    lfo.connect(lfoGain);
    lfoGain.connect(nLP.frequency);

    out.connect(ambientBus);

    const start = () => {
      const t = c.currentTime;
      o1.start(t);
      o2.start(t);
      n.start(t);
      lfo.start(t);
    };
    const stop = () => {
      const t = c.currentTime;
      try{o1.stop(t);}catch(_){ }
      try{o2.stop(t);}catch(_){ }
      try{n.stop(t);}catch(_){ }
      try{lfo.stop(t);}catch(_){ }
      try{out.disconnect();}catch(_){ }
    };

    return { start, stop };
  }

  function syncAmbient(){
    const c = ensure();
    if(!c || !ambientBus) return;

    ambientBus.gain.value = settings.ambient ? settings.ambientLevel : 0;

    if(settings.ambient && settings.enabled){
      if(!ambientNodes){
        ambientNodes = createAmbient();
        try{ ambientNodes?.start?.(); }catch(_){/* ignore */}
      }
    }else{
      if(ambientNodes){
        try{ ambientNodes.stop?.(); }catch(_){/* ignore */}
        ambientNodes = null;
      }
    }
  }

  // --- UI wiring ---
  function updateUI(){
    const tgl = document.getElementById('sfxToggle');
    const vol = document.getElementById('sfxVolume');
    const pack = document.getElementById('sfxPack');
    const amb = document.getElementById('ambToggle');

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
    if(pack){
      if(String(pack.value) !== String(settings.pack)) pack.value = String(settings.pack);
      pack.disabled = !settings.enabled;
      pack.style.opacity = settings.enabled ? '1' : '.55';
    }
    if(amb){
      amb.textContent = settings.ambient ? 'Ambiente: ON' : 'Ambiente: OFF';
      amb.setAttribute('aria-pressed', settings.ambient ? 'true' : 'false');
      amb.disabled = !settings.enabled;
      amb.style.opacity = settings.enabled ? '1' : '.55';
    }
  }

  function setupControls(){
    const tgl = document.getElementById('sfxToggle');
    const vol = document.getElementById('sfxVolume');
    const pack = document.getElementById('sfxPack');
    const amb = document.getElementById('ambToggle');

    if(tgl){
      tgl.addEventListener('click', () => {
        setEnabled(!settings.enabled);
        if(settings.enabled){
          unlock();
          play('click');
        }
        syncAmbient();
      });
    }
    if(vol){
      vol.addEventListener('input', () => {
        setVolume(clamp(Number(vol.value) / 100, 0, 1));
      });
      vol.addEventListener('change', () => {
        if(settings.enabled) play('click');
      });
    }
    if(pack){
      pack.addEventListener('change', () => {
        setPack(pack.value);
        if(settings.enabled) play('click');
      });
    }
    if(amb){
      amb.addEventListener('click', () => {
        setAmbient(!settings.ambient);
        if(settings.enabled) play('click');
      });
    }

    updateUI();
  }

  // Click global (leve) — não toca em sliders/inputs
  function setupGlobalClicks(){
    document.addEventListener('click', (e) => {
      // qualquer clique desbloqueia o audio
      unlock();

      const btn = e.target?.closest?.('button');
      if(!btn) return;

      // Não duplica sons de efeitos: esses vêm do log
      const noClick = new Set(['use_sanguenta', 'toggle_plasma', 'ambToggle', 'sfxToggle']);
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

  // Expose API so ux.js can trigger event-based sfx
  window.__sfx = {
    play,
    setEnabled,
    setVolume,
    setPack,
    setAmbient,
    setAmbientLevel,
    get enabled(){ return settings.enabled; },
    get volume(){ return settings.volume; },
    get pack(){ return settings.pack; },
    get ambient(){ return settings.ambient; }
  };

  document.addEventListener('DOMContentLoaded', () => {
    ensure();
    applyPack();
    setupControls();
    setupGlobalClicks();
    // por padrão, ambiente respeita o settings (OFF)
    syncAmbient();
  });
})();
