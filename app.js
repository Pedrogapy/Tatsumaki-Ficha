// --- Simple dice roller
function roll(expr){
  const m = expr.match(/(\d+)d(\d+)([+-]\d+)?/i);
  if(!m) return {total:0, detail:expr};
  const n=+m[1], s=+m[2], mod=+m[3]||0;
  let rolls=[]; let sum=0;
  for(let i=0;i<n;i++){ const r=1+Math.floor(Math.random()*s); rolls.push(r); sum+=r; }
  sum+=mod;
  return {total:sum, detail:`${expr} => [${rolls.join(', ')}] ${mod? (mod>0?'+':'')+mod:''} = ${sum}`};
}

// --- State
const MAX = { ps:100, pvo:2, pvd:3, pf:100 };
let state = {
  ps:MAX.ps, pvo:MAX.pvo, pvd:MAX.pvd, pf:MAX.pf,
  round:1,
  effects: {
    sanguenta: null, // {target, rounds}
    plasma: null // {target}
  }
};

function resetTracks(){
  state.ps=MAX.ps; state.pvo=MAX.pvo; state.pvd=MAX.pvd; state.pf=MAX.pf;
}

function log(msg){
  const el=document.getElementById('log');
  el.textContent = msg + '\n' + el.textContent;
}

// --- Effects helpers
function applySanguenta(target){
  const dur = roll('1d4+1').total;
  state.effects.sanguenta = { target, rounds: dur };
  // rule: substitutes plasma on same target
  if(state.effects.plasma && state.effects.plasma.target===target){
    state.effects.plasma = null;
  }
  log(`Arma Sanguenta em ${target} por ${dur} rodadas (+1d8 dano).`);
  renderEffects();
}

function togglePlasma(target){
  if(state.effects.plasma && state.effects.plasma.target===target){
    state.effects.plasma = null;
    log(`Plasma desligado em ${target}.`);
  } else {
    state.effects.plasma = { target };
    // rule: substitutes sanguenta on same target
    if(state.effects.sanguenta && state.effects.sanguenta.target===target){
      state.effects.sanguenta = null;
    }
    log(`Plasma ativado em ${target} (+1d12, ignora resistências).`);
  }
  renderEffects();
}

function nextRound(){
  state.round++;
  if(state.effects.sanguenta){
    state.effects.sanguenta.rounds--;
    if(state.effects.sanguenta.rounds<=0){
      log(`Arma Sanguenta expirou.`);
      state.effects.sanguenta=null;
    }
  }
  renderEffects();
}

// --- Damage calc
function damageFor(target, baseExpr, attrQuarter){
  let totalExpr = baseExpr;
  let notes=[];
  // Essence: +2 dice simulated by +2d8 baseline for demo
  totalExpr = totalExpr.replace(/(\d+)d(\d+)/, (m,a,b)=>`${+a+2}d${b}`);
  if(state.effects.sanguenta && state.effects.sanguenta.target===target){
    totalExpr += '+1d8'; notes.push('Sanguenta');
  }
  if(state.effects.plasma && state.effects.plasma.target===target){
    totalExpr += '+1d12'; notes.push('Plasma (ignora resistências)');
  }
  const res = roll(totalExpr.replace(/\+\s*/g,'+'));
  log(res.detail + (notes.length? ` | ${notes.join(', ')}`:''));
}

// --- UI
function render(){
  document.getElementById('ps').textContent=state.ps;
  document.getElementById('pvo').textContent=state.pvo;
  document.getElementById('pvd').textContent=state.pvd;
  document.getElementById('pf').textContent=state.pf;
  renderEffects();
}
function renderEffects(){
  const ul=document.getElementById('effects'); ul.innerHTML='';
  if(state.effects.sanguenta){
    const li=document.createElement('li');
    li.textContent = `Sanguenta em ${state.effects.sanguenta.target} (${state.effects.sanguenta.rounds} rodadas)`;
    ul.appendChild(li);
  }
  if(state.effects.plasma){
    const li=document.createElement('li');
    li.textContent = `Plasma em ${state.effects.plasma.target} (∞)`;
    ul.appendChild(li);
  }
  if(!state.effects.sanguenta && !state.effects.plasma){
    const li=document.createElement('li'); li.textContent='—';
    ul.appendChild(li);
  }
}

document.getElementById('newRound').onclick=()=>{ nextRound(); };
document.getElementById('newCombat').onclick=()=>{ state.round=1; state.pvo=MAX.pvo; state.pvd=MAX.pvd; render(); };
document.getElementById('resetAll').onclick=()=>{ resetTracks(); state.effects={sanguenta:null, plasma:null}; render(); log('Reset total.'); };

document.getElementById('atk_melee').onclick=()=>log(roll('1d20+6').detail);
document.getElementById('atk_sword').onclick=()=>log(roll('1d20+11').detail);
document.getElementById('atk_heavy').onclick=()=>log(roll('1d20+11').detail);

document.getElementById('dmg_melee').onclick=()=>damageFor('melee','2d8', 'for');
document.getElementById('dmg_sword').onclick=()=>damageFor('sword','3d8', 'dex');
document.getElementById('dmg_heavy').onclick=()=>{
  const base=document.getElementById('heavy_base').value||'2d6';
  damageFor('heavy', base, 'for');
};

document.getElementById('use_sanguenta').onclick=()=>{
  const t=document.getElementById('target_sanguenta').value;
  applySanguenta(t);
};
document.getElementById('toggle_plasma').onclick=()=>{
  const t=document.getElementById('target_plasma').value;
  togglePlasma(t);
};

resetTracks();
render();
