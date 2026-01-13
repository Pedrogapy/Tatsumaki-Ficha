// ======== DADOS FIXOS DA FICHA =========
const ATTR = {
  for: 6,
  dex: 6,
  arc: 5
};

// Essência: Verdadeira 3 + Ofensiva 2 = +3 dados
const ESSENCE_DICE_BONUS = 3;

// Recursos máximos
const MAX = {
  ps: 108,
  pvo: 2,
  pvd: 3,
  pf: 66
};

let state = {
  ps: MAX.ps,
  pvo: MAX.pvo,
  pvd: MAX.pvd,
  pf: MAX.pf,
  round: 1,
  initiative: [],
  effects: {
    sanguenta: null,
    plasma: null
  }
};

// ======== UTIL =========
function log(msg) {
  const el = document.getElementById("log");
  el.textContent = msg + "\n" + el.textContent;
}

function roll(expr) {
  const match = expr.match(/(\d+)d(\d+)([+-]\d+)?/);
  let total = 0;
  let rolls = [];
  if (!match) return 0;
  let [_, n, d, mod] = match;
  for (let i = 0; i < +n; i++) {
    let r = Math.floor(Math.random() * +d) + 1;
    rolls.push(r);
    total += r;
  }
  if (mod) total += +mod;
  return { total, rolls };
}

function render() {
  ps.textContent = state.ps;
  pvo.textContent = state.pvo;
  pvd.textContent = state.pvd;
  pf.textContent = state.pf;
  round.textContent = state.round;
  renderEffects();
}

// ======== ATAQUES =========
function attackMelee() {
  log(`Teste Lutar: 1d20+6 → ${roll("1d20+6").total}`);
}

function damageMelee() {
  damage("melee", `2d8+${ATTR.for}`);
}

function attackSword() {
  log(`Teste Espada: 1d20+11 → ${roll("1d20+11").total}`);
}

function damageSword() {
  damage("sword", `3d8+${ATTR.dex}`);
}

function attackHeavy() {
  log(`Teste Arma Pesada: 1d20+11 → ${roll("1d20+11").total}`);
}

function damageHeavy() {
  damage("heavy", `2d6+${ATTR.for}`);
}

// ======== DANO COM ESSÊNCIA + BUFFS =========
function damage(target, baseExpr) {
  let [dice, sides] = baseExpr.split("d");
  dice = parseInt(dice) + ESSENCE_DICE_BONUS;

  let expr = `${dice}d${sides}`;
  let notes = ["Essência +3d"];

  if (state.effects.sanguenta?.target === target) {
    expr += "+1d8";
    notes.push("Sanguenta");
  }

  if (state.effects.plasma?.target === target) {
    expr += "+1d12";
    notes.push("Plasma (ignora resistências)");
  }

  const r = roll(expr);
  log(`Dano ${expr} = ${r.total} [${notes.join(", ")}]`);
}

// ======== HABILIDADES =========
function activateSanguenta() {
  if (state.pvo < 1 || state.ps < 4) return;
  const target = sanguentaTarget.value;

  state.ps -= 4;
  state.pvo -= 1;

  const duration = roll("1d4+1").total;

  state.effects.plasma = state.effects.plasma?.target === target ? null : state.effects.plasma;
  state.effects.sanguenta = { target, rounds: duration };

  log(`Arma Sanguenta em ${target} por ${duration} rodadas`);
  render();
}

function togglePlasma() {
  if (state.pvo < 1 || state.pf < 8) return;
  const target = plasmaTarget.value;

  if (state.effects.plasma?.target === target) {
    state.effects.plasma = null;
    log("Plasma desativado");
  } else {
    state.pvo -= 1;
    state.pf -= 8;
    state.effects.sanguenta = state.effects.sanguenta?.target === target ? null : state.effects.sanguenta;
    state.effects.plasma = { target };
    log(`Plasma ativado em ${target}`);
  }
  render();
}

// ======== INICIATIVA =========
function addInitiative() {
  const name = initName.value.trim();
  if (!name) return;
  state.initiative.push({ name, done: false });
  initName.value = "";
  renderInitiative();
}

function renderInitiative() {
  initiative.innerHTML = "";
  state.initiative.forEach((c, i) => {
    const li = document.createElement("li");
    li.textContent = c.done ? `✔ ${c.name}` : c.name;
    li.onclick = () => endTurn(i);
    initiative.appendChild(li);
  });
}

function endTurn(i) {
  state.initiative[i].done = true;
  if (state.initiative.every(c => c.done)) {
    nextRound();
  }
  renderInitiative();
}

// ======== RODADAS =========
function nextRound() {
  state.round++;
  state.initiative.forEach(c => c.done = false);

  if (state.effects.sanguenta) {
    state.effects.sanguenta.rounds--;
    if (state.effects.sanguenta.rounds <= 0) {
      log("Arma Sanguenta expirou");
      state.effects.sanguenta = null;
    }
  }
  render();
}

// ======== EFEITOS =========
function renderEffects() {
  effects.innerHTML = "";
  if (state.effects.sanguenta) {
    effects.innerHTML += `<li>Sanguenta (${state.effects.sanguenta.target}) — ${state.effects.sanguenta.rounds} rod.</li>`;
  }
  if (state.effects.plasma) {
    effects.innerHTML += `<li>Plasma (${state.effects.plasma.target})</li>`;
  }
}

// ======== INIT =========
render();
