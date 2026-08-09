(function () {
  const appEl = document.getElementById('app');
  const characterSelect = document.getElementById('characterSelect');
  const saveStatus = document.getElementById('saveStatus');
  const systemName = document.getElementById('systemName');
  const banner = document.getElementById('connectionBanner');
  const toast = document.getElementById('toast');
  const attributeDialog = document.getElementById('attributeDialog');
  const settingsDialog = document.getElementById('settingsDialog');
  const newCharacterDialog = document.getElementById('newCharacterDialog');
  const testDialog = document.getElementById('testDialog');
  const testDialogTitle = document.getElementById('testDialogTitle');
  const testDialogFormula = document.getElementById('testDialogFormula');
  const testResult = document.getElementById('testResult');
  const damageDialog = document.getElementById('damageDialog');
  const damageSource = document.getElementById('damageSource');
  const incomingDamage = document.getElementById('incomingDamage');
  const damageType = document.getElementById('damageType');
  const damageOrder = document.getElementById('damageOrder');
  const damageProtections = document.getElementById('damageProtections');
  const manualResistance = document.getElementById('manualResistance');
  const manualReduction = document.getElementById('manualReduction');
  const damagePreview = document.getElementById('damagePreview');
  const applyDamageBtn = document.getElementById('applyDamageBtn');
  let pendingTest = null;
  let pendingDamageContext = null;

  let state = {
    system: null,
    characters: [],
    character: null,
    data: null,
    combat: null,
    rules: null,
    activeTab: 'sheet',
    mode: 'local',
    dirty: false,
    saving: false,
    editingAttribute: null,
    saveTimer: null
  };

  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  function notify(message, tone = 'normal') {
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.classList.remove('hidden');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.add('hidden'), 2800);
  }

  function setSaveStatus(text, mode = '') {
    saveStatus.textContent = text;
    saveStatus.dataset.mode = mode;
  }

  function markDirty() {
    state.dirty = true;
    setSaveStatus('Alterações…', 'dirty');
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveNow, 650);
  }

  async function saveNow() {
    if (!state.character || state.saving || !state.dirty) return;
    state.saving = true;
    setSaveStatus('Salvando…', 'saving');
    try {
      RPG.applySheetFormulas(state.data, state.rules);
      const name = state.data.identity?.name || state.character.name;
      await DB.saveCharacter(state.character.slug, name, state.data, state.combat);
      state.character.name = name;
      const meta = state.characters.find((item) => item.slug === state.character.slug);
      if (meta) meta.name = name;
      state.dirty = false;
      setSaveStatus(state.mode === 'remote' ? 'Salvo no banco' : 'Salvo localmente', 'saved');
      renderCharacterSelect();
    } catch (error) {
      console.error(error);
      setSaveStatus('Falha ao salvar', 'error');
      notify(`Erro ao salvar: ${error.message}`, 'error');
    } finally {
      state.saving = false;
      if (state.dirty) markDirty();
    }
  }

  function num(value) {
    return Number(value) || 0;
  }

  function currentResource(key) {
    return RPG.resourceCurrent(state.data, state.rules, key);
  }

  function effectiveAbilityCost(ability) {
    return RPG.effectiveAbilityCost(ability?.cost || {}, state.data);
  }

  function effectiveCostLabel(ability) {
    const originalPf = Math.max(0, num(ability?.cost?.pf));
    const effective = effectiveAbilityCost(ability);
    const label = RPG.formatCost(effective);
    const discount = RPG.essencePfDiscount(state.data);
    if (originalPf > 0 && discount > 0) return `${label} · Controle Parcial: −${Math.min(discount, originalPf)} P.F`;
    return label;
  }

  function restoreAllPv(showNotice = false) {
    const pv = state.data.resources.pv ||= {};
    const hadSpent = num(pv.attackLost) > 0 || num(pv.reactionLost) > 0;
    pv.attackLost = 0;
    pv.reactionLost = 0;
    if (showNotice && hadSpent) notify('Todos os P.V foram restaurados.');
  }

  function ensureEssenceCombatState() {
    state.combat.essenceEffects ||= {};
    state.data.essence ||= { levels: {}, stages: {}, note: '' };
    state.data.essence.dailyUses ||= {};
  }

  function essenceDefinition(id) {
    return RPG.essenceActiveAbilities(state.data, state.rules).find(item => item.id === id);
  }

  function activeEssenceEffect(id) {
    ensureEssenceCombatState();
    return state.combat.essenceEffects[id] || null;
  }

  function canPayEssenceCost(cost) {
    const effective = RPG.effectiveAbilityCost(cost || {}, state.data);
    const pvCost = RPG.abilityPvCosts(effective);
    return (
      Math.max(0, num(effective.pf)) <= currentResource('pf') &&
      pvCost.attack <= RPG.pvPoolCurrent(state.data, state.rules, 'attack') &&
      pvCost.reaction <= RPG.pvPoolCurrent(state.data, state.rules, 'reaction')
    );
  }

  function payEssenceCost(cost) {
    const effective = RPG.effectiveAbilityCost(cost || {}, state.data);
    if (num(effective.pf)) spendResource('pf', effective.pf);
    const pvCost = RPG.abilityPvCosts(effective);
    if (pvCost.attack) spendPv('attack', pvCost.attack);
    if (pvCost.reaction) spendPv('reaction', pvCost.reaction);
    return effective;
  }

  function activateEssenceEffect(id) {
    ensureEssenceCombatState();
    if (!state.combat.active) {
      notify('Inicie o combate para ativar esta técnica da Essência.', 'error');
      return false;
    }
    const def = essenceDefinition(id);
    if (!def) return false;

    if (id === 'liberacao-condensada') {
      const used = Math.max(0, num(state.data.essence.dailyUses[id]));
      if (used >= 1) {
        notify('Liberação Condensada já foi usada hoje.', 'error');
        return false;
      }
    }

    if (def.perTurnCost && !canPayEssenceCost(def.perTurnCost)) {
      notify('Recursos insuficientes para ativar esta técnica.', 'error');
      return false;
    }

    let durationExpression = def.duration || '1';
    if (durationExpression === 'choice:2|1d4') {
      const rollDuration = confirm('Liberação Condensada: OK para rolar 1d4 de duração. Cancelar para usar duração fixa de 2 turnos.');
      durationExpression = rollDuration ? '1d4' : '2';
    }

    let duration = 1;
    try { duration = Math.max(1, RPG.rollDiceExpression(durationExpression).result); }
    catch { duration = Math.max(1, num(durationExpression) || 1); }

    if (def.perTurnCost) payEssenceCost(def.perTurnCost);
    state.combat.essenceEffects[id] = {
      id,
      name: def.name,
      turns: duration,
      durationExpression,
      defense: def.defense || '',
      damageBonus: def.damageBonus || '',
      activatedAtRound: num(state.combat.round),
      activatedAtTurn: num(state.combat.turn)
    };

    if (id === 'liberacao-condensada') {
      state.data.essence.dailyUses[id] = Math.max(0, num(state.data.essence.dailyUses[id])) + 1;
    }

    notify(`${def.name} ativada por ${duration} turno${duration === 1 ? '' : 's'}.`);
    return true;
  }

  function endEssenceEffect(id, message = '') {
    ensureEssenceCombatState();
    const effect = state.combat.essenceEffects[id];
    if (!effect) return;
    delete state.combat.essenceEffects[id];
    if (message) notify(message);
  }

  function tickEssenceEffects() {
    ensureEssenceCombatState();
    const definitions = Object.fromEntries(RPG.essenceActiveAbilities(state.data, state.rules).map(item => [item.id, item]));

    Object.keys(state.combat.essenceEffects).forEach(id => {
      const effect = state.combat.essenceEffects[id];
      effect.turns = Math.max(0, num(effect.turns) - 1);

      if (effect.turns <= 0) {
        delete state.combat.essenceEffects[id];
        notify(`${effect.name || id} terminou.`);
        return;
      }

      const def = definitions[id];
      if (def?.perTurnCost) {
        if (!canPayEssenceCost(def.perTurnCost)) {
          delete state.combat.essenceEffects[id];
          notify(`${effect.name || id} foi encerrada por falta de recursos.`, 'error');
          return;
        }
        payEssenceCost(def.perTurnCost);
      }
    });
  }

  function essencePassivesHtml(compact = false) {
    const passives = RPG.essencePassives(state.data, state.rules);
    if (!passives.length) return '<span class="muted">Nenhuma passiva de Essência ativa.</span>';
    return `<div class="${compact ? 'essence-passive-chips' : 'essence-passive-list'}">
      ${passives.map(item => compact
        ? `<span class="essence-passive-chip" title="${esc(item.text)}">${esc(item.name)}: ${esc(item.kind === 'damage-flat' ? `+${item.value} dano` : item.kind === 'resource' ? '+1 P.V' : item.kind === 'cost' ? '−1 P.F' : item.kind === 'resistance' ? item.value : '+1 dado')}</span>`
        : `<div class="essence-passive-row"><div><span class="tag">${esc(item.path)}</span><strong>${esc(item.name)}</strong></div><p>${esc(item.text)}</p></div>`
      ).join('')}
    </div>`;
  }

  function essenceDamageReminderHtml(ability = null) {
    const modifiers = ability
      ? RPG.abilityDamageModifiers(ability, state.data, state.rules)
      : RPG.essenceDamageModifiers(state.data, state.rules);
    const condensed = activeEssenceEffect('liberacao-condensada');
    if (!modifiers.length && !condensed) return '';
    const tags = ability ? RPG.abilityTags(ability) : [];
    return `<div class="essence-damage-reminder">
      <strong>${ability ? 'Bônus automáticos desta habilidade' : 'Modificadores de dano'}</strong>
      ${ability && tags.includes('essence') ? '<span><b>Essência:</b> esta habilidade conta como habilidade de Essência.</span>' : ''}
      ${modifiers.map(item => `<span>${esc(item.text)}</span>`).join('')}
      ${condensed ? `<span><b>Liberação Condensada ativa:</b> +1d12 de dano do tipo de energia e ignora resistências físicas e algumas mágicas por ${num(condensed.turns)} turno${num(condensed.turns) === 1 ? '' : 's'}.</span>` : ''}
      <small>${ability ? 'Todas as habilidades do Tatsumaki têm a tag Essência por padrão. Tags adicionais como Mágica, Física e Corpo a corpo acumularão os respectivos bônus quando forem definidas.' : 'Os bônus por tipo se acumulam quando o ataque se enquadra.'}</small>
    </div>`;
  }

  // DAMAGE_AND_ABILITY_SYSTEM_V7
  const CHAOS_TRANSFORMATION_PROFILES = {
    'mascara-caos': {
      id: 'mascara-caos', name: 'Máscara do Caos', tier: 'inferior', tempPs: 30, ca: 2,
      activation: { consumeAttack: true, consumeReaction: false, text: 'Ativação por 1 turno: sem atacar ou contra-atacar; pode apenas defender ou se reposicionar. Consome todos os P.V de Ataque.' },
      inheritedMask: false, physicalResistance: false, chaosShield: true, startingChaosMinimum: 2, chaosOnAbilityHit: 1,
      testAdvantages: { skills: ['Intimidação'], attributes: [] }, skillBonuses: {},
      damageBonuses: [{ expression: '1d8', label: 'Máscara do Caos · Energia do Caos' }]
    },
    'personificacao-caos': {
      id: 'personificacao-caos', name: 'Personificação do Caos', tier: 'superior', tempPs: 90, ca: 4,
      activation: { consumeAttack: true, consumeReaction: true, text: 'Ativação por 1 turno: sem ações ofensivas ou defensivas. Consome todos os P.V de Ataque e Reação; os buffs começam no próximo turno.' },
      inheritedMask: true, physicalResistance: true, chaosShield: true, startingChaosMinimum: 2, chaosOnAbilityHit: 1,
      manifestedPvAttackPerTurn: 1,
      testAdvantages: { skills: ['Intimidação'], attributes: ['FOR', 'DES', 'FORT'] },
      skillBonuses: { 'Contra-Ataque': 3 },
      damageBonuses: [
        { expression: '1d8', label: 'Máscara do Caos herdada · Energia do Caos' },
        { expression: 'primary', label: 'Personificação do Caos · +1 dado do ataque' }
      ]
    }
  };

  function activeTransformationProfile() {
    return CHAOS_TRANSFORMATION_PROFILES[state.combat?.activeTransformation] || null;
  }

  function transformationCaBonus() {
    return Math.max(0, num(activeTransformationProfile()?.ca));
  }

  function transformationTestAdvantage(source = '') {
    const profile = activeTransformationProfile();
    if (!profile) return 0;
    if (String(source).startsWith('attribute:')) {
      const abbr = String(source).split(':')[1];
      return profile.testAdvantages.attributes.includes(abbr) ? 1 : 0;
    }
    if (String(source).startsWith('skill:')) {
      const index = Number(String(source).split(':')[1]);
      const skill = state.data.skills?.[index];
      return skill && profile.testAdvantages.skills.includes(skill.name) ? 1 : 0;
    }
    return 0;
  }

  function transformationSkillBonus(skillName) {
    return Math.max(0, num(activeTransformationProfile()?.skillBonuses?.[skillName]));
  }

  function transformationPanelHtml() {
    if (state.combat?.pendingTransformation) {
      const pending = CHAOS_TRANSFORMATION_PROFILES[state.combat.pendingTransformation];
      return `<div class="active-transformation transformation-pending"><span class="tag">ATIVAÇÃO</span><strong>${esc(pending?.name || state.combat.pendingTransformation)}</strong><span>${esc(pending?.activation?.text || '')}</span><span>Os buffs entram no próximo turno.</span></div>`;
    }
    const profile = activeTransformationProfile();
    if (!profile) {
      return `<div class="stack-actions transformation-choices">
        ${(state.data.transformations || []).map(t => {
          const p = CHAOS_TRANSFORMATION_PROFILES[t.id];
          const hint = p?.inheritedMask
            ? 'Forma superior: herda todos os buffs da Máscara e soma os próprios.'
            : p ? 'Forma inferior: pacote-base dos buffs do Caos.' : (t.summary || '');
          return `<div class="transformation-choice"><button class="secondary-btn" data-action="activate-transformation" data-transformation="${esc(t.id)}">${esc(t.name)}</button><small>${esc(hint)}</small></div>`;
        }).join('')}
      </div>`;
    }
    const details = profile.id === 'personificacao-caos'
      ? [
          '+90 P.S temporários (+30 herdados + +60 próprios)',
          '+4 CA (+2 herdados + +2 próprios)',
          'Resistência a todo dano físico',
          'Escudo Natural 2d8 herdado da Máscara',
          'Vantagem em Intimidação e em FOR/DES/FORT',
          '+3 em Contra-Ataque',
          '+1d8 de Caos herdado + +1 dado próprio em ataques',
          'Reflete 25% do dano final recebido',
          'Aura do Caos em 18m conforme a descrição da ficha',
          'Ataque Manifestado: +1 P.V de Ataque adicional por turno (regra especial exibida para controle manual)',
          'Não pode Esquivar ou Bloquear; pode Contra-Atacar'
        ]
      : [
          '+30 P.S temporários', '+2 CA', 'Vantagem em Intimidação',
          '+1d8 de Energia do Caos nos ataques', 'Escudo Natural 2d8',
          'O Escudo Natural não reduz Dano Verdadeiro',
          'Ao concluir, Pontos de Caos ficam em pelo menos 2; acertos de habilidade podem gerar +1 Caos'
        ];
    return `<div class="active-transformation transformation-detail">
      <div class="transformation-heading"><div><span class="tag">${profile.tier === 'superior' ? 'FORMA SUPERIOR' : 'FORMA INFERIOR'}</span><strong>${esc(profile.name)}</strong></div><span>${num(state.combat.transformationTurns)} turnos restantes</span></div>
      ${profile.inheritedMask ? '<p class="transformation-inheritance">Personificação = todos os buffs da Máscara + buffs próprios.</p>' : ''}
      <div class="transformation-buffs">${details.map(x => `<span>• ${esc(x)}</span>`).join('')}</div>
      <div class="transformation-actions">
        ${profile.chaosOnAbilityHit ? '<button class="secondary-btn small" data-action="transformation-hit-chaos">Habilidade acertou: +1 Caos</button>' : ''}
        <button class="secondary-btn small" data-action="end-transformation">Encerrar</button>
      </div>
    </div>`;
  }

  function normalizeSpecialAbilities() {
    let changed = false;
    const parry = (state.data.abilities || []).find(item => item.id === 'parry');
    if (parry) {
      const nextCost = { ...(parry.cost || {}) };
      delete nextCost.pv;
      delete nextCost.pvAttack;
      if (num(nextCost.pvReaction) !== 1) nextCost.pvReaction = 1;
      if (JSON.stringify(nextCost) !== JSON.stringify(parry.cost || {})) {
        parry.cost = nextCost;
        changed = true;
      }
      const summary = 'Contra ataque físico: role uma moeda. Cara anula o dano e concede 1 ação que gastaria P.V de Reação sem gastar P.V; Coroa faz Tatsumaki receber o dano completo, aplicando resistências e reduções normalmente.';
      if (parry.summary !== summary) { parry.summary = summary; changed = true; }
    }
    return changed;
  }

  function ensureCombatExtensions() {
    state.combat.freeReactionActions = Math.max(0, num(state.combat.freeReactionActions));
    state.combat.abilityResults ||= {};
    state.combat.damageHistory ||= [];
    state.combat.pendingDamageReductions ||= [];
    const activeProfile = CHAOS_TRANSFORMATION_PROFILES[state.combat.activeTransformation];
    if (activeProfile) {
      const tracked = Math.max(0, num(state.combat.transformationTempPs));
      const expected = Math.max(0, num(activeProfile.tempPs));
      if (tracked !== expected) {
        state.data.resources.ps.temporary = Math.max(0, num(state.data.resources.ps.temporary) + (expected - tracked));
        state.combat.transformationTempPs = expected;
      }
    }
  }

  function normalizeName(value = '') {
    return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  function skillValueByName(name) {
    const target = normalizeName(name);
    const skill = (state.data.skills || []).find(item => normalizeName(item.name) === target);
    return skill ? RPG.skillTotal(skill, state.data, state.rules) : 0;
  }

  function quarterByPortugueseAttribute(name) {
    const key = normalizeName(name);
    const map = { forca: 'FOR', destreza: 'DES', fortitude: 'FORT', arcano: 'ARC', sabedoria: 'SAB', inteligencia: 'INT' };
    const abbr = map[key];
    return abbr ? RPG.quarter(state.data, state.rules, abbr) : 0;
  }

  function abilityDamagePlan(ability) {
    if (!ability?.damage) return null;
    const text = String(ability.damage);
    const plan = { dice: [], flat: 0, labels: [], externalProjectile: false, special: null, primarySides: null, unresolvedBonusDice: 0 };

    if (ability.id === 'refracao') {
      plan.special = 'refraction';
      plan.primarySides = 8;
      plan.labels.push('Refrações: 1d4 + 1; cada refração causa 1d8');
    } else {
      const diceRegex = /(\d+)d(\d+)/gi;
      let match;
      while ((match = diceRegex.exec(text))) {
        const count = Number(match[1]);
        const sides = Number(match[2]);
        plan.dice.push({ count, sides, label: `${count}d${sides} base` });
        if (!plan.primarySides) plan.primarySides = sides;
      }
    }

    const fractionRegex = /1\/4\s+(Força|Destreza|Fortitude|Arcano|Sabedoria|Inteligência)/gi;
    let f;
    while ((f = fractionRegex.exec(text))) {
      const value = quarterByPortugueseAttribute(f[1]);
      plan.flat += value;
      plan.labels.push(`¼ ${f[1]} = +${value}`);
    }

    for (const skillName of ['Presença', 'Armas Avançadas']) {
      if (normalizeName(text).includes(normalizeName(skillName))) {
        const value = skillValueByName(skillName);
        plan.flat += value;
        plan.labels.push(`${skillName} = +${value}`);
      }
    }

    if (normalizeName(text).includes('dano do projetil')) {
      plan.externalProjectile = true;
      plan.labels.push('Dano do projétil = informado ao rolar');
    }

    const essenceMods = RPG.abilityDamageModifiers(ability, state.data, state.rules);
    essenceMods.forEach(mod => {
      if (mod.kind === 'damage-flat') {
        plan.flat += num(mod.value);
        plan.labels.push(`${mod.name} = +${num(mod.value)}`);
      } else if (mod.kind === 'damage') {
        if (plan.primarySides) plan.dice.push({ count: 1, sides: plan.primarySides, label: mod.name });
        else { plan.unresolvedBonusDice += 1; plan.labels.push(`${mod.name} = +1 dado do ataque`); }
      }
    });

    const transformation = activeTransformationProfile();
    (transformation?.damageBonuses || []).forEach(item => {
      if (item.expression === '1d8') plan.dice.push({ count: 1, sides: 8, label: item.label });
      if (item.expression === 'primary') {
        if (plan.primarySides) plan.dice.push({ count: 1, sides: plan.primarySides, label: item.label });
        else { plan.unresolvedBonusDice += 1; plan.labels.push(`${item.label} = +1 dado do ataque`); }
      }
    });

    if (activeEssenceEffect('liberacao-condensada')) {
      plan.dice.push({ count: 1, sides: 12, label: 'Liberação Condensada' });
    }

    return plan;
  }

  function abilityDamageFormulaHtml(ability) {
    const plan = abilityDamagePlan(ability);
    if (!plan) return '';
    const diceText = plan.special === 'refraction'
      ? '1d4+1 refrações × 1d8'
      : plan.dice.map(d => `${d.count}d${d.sides}`).join(' + ');
    const parts = [diceText, plan.flat ? `+ ${plan.flat}` : '', plan.externalProjectile ? '+ dano do projétil' : '', plan.unresolvedBonusDice ? `+ ${plan.unresolvedBonusDice} dado(s) do ataque` : ''].filter(Boolean);
    return `<div class="ability-resolution-preview"><strong>Resultado calculável</strong><span>${esc(parts.join(' '))}</span>${plan.labels.length ? `<small>${plan.labels.map(esc).join(' · ')}</small>` : ''}</div>`;
  }

  function abilityResultHtml(ability) {
    const result = state.combat?.abilityResults?.[ability.id];
    if (!result) return '';
    return `<div class="ability-last-result ${result.success === false ? 'failure' : result.success === true ? 'success' : ''}"><span>Último resultado</span><strong>${esc(result.title || result.result)}</strong>${result.details ? `<small>${esc(result.details)}</small>` : ''}</div>`;
  }

  function abilitySpecialActionsHtml(ability) {
    if (!ability) return '';
    if (ability.id === 'sentenca-rei') return '<button class="secondary-btn small" data-action="roll-ability-special" data-ability="sentenca-rei" data-special="corruption">Rolar corrupção 1d10</button>';
    if (ability.id === 'colar-resistencia') return '<button class="secondary-btn small" data-action="roll-ability-special" data-ability="colar-resistencia" data-special="magic-normal">Proteção magia 2d12</button><button class="secondary-btn small" data-action="roll-ability-special" data-ability="colar-resistencia" data-special="magic-essence">Proteção Essência 2d8</button>';
    if (ability.id === 'plasma-melhorado') return '<button class="secondary-btn small" data-action="roll-ability-special" data-ability="plasma-melhorado" data-special="duration">Rolar duração 1d4+1</button>';
    return '';
  }

  function rollAbilitySpecial(ability, special) {
    ensureCombatExtensions();
    let roll;
    let title = '';
    let details = '';
    if (ability.id === 'sentenca-rei' && special === 'corruption') {
      roll = RPG.rollDiceExpression('1d10');
      title = `${roll.result}% de corrupção inicial`;
      details = `1d10 = ${roll.result}. O resultado do dado é a porcentagem inicial de corrupção.`;
    } else if (ability.id === 'colar-resistencia' && (special === 'magic-normal' || special === 'magic-essence')) {
      const arc = RPG.quarter(state.data, state.rules, 'ARC');
      const expr = special === 'magic-normal' ? `2d12+${arc}` : `2d8+${arc}`;
      roll = RPG.rollDiceExpression(expr);
      title = `${roll.result} de redução mágica`;
      const protectionType = special === 'magic-normal' ? 'magical' : 'essence';
      details = `${special === 'magic-normal' ? 'Magia normal' : 'Magia de Essência/Arcana'}: ${expr} = ${roll.result}. A redução ficou disponível no menu Tomar Dano.`;
      state.combat.pendingDamageReductions = (state.combat.pendingDamageReductions || []).filter(item => item.source !== 'colar-resistencia' || item.damageType !== protectionType);
      state.combat.pendingDamageReductions.push({ id: `colar-${Date.now()}`, source: 'colar-resistencia', damageType: protectionType, amount: roll.result, label: `Colar de Resistência Mágica · redução ${roll.result}` });
    } else if (ability.id === 'plasma-melhorado' && special === 'duration') {
      roll = RPG.rollDiceExpression('1d4+1');
      title = `${roll.result} turnos de duração`;
      details = `1d4+1 = ${roll.result}.`;
    } else {
      notify('Esta rolagem especial ainda não foi automatizada.', 'error');
      return;
    }
    const result = { title, result: roll.result, details, at: new Date().toISOString() };
    state.combat.abilityResults[ability.id] = result;
    state.combat.rollHistory.unshift({ ...roll, label: ability.name, expression: `${ability.name}: ${roll.expression}`, at: result.at });
    state.combat.rollHistory = state.combat.rollHistory.slice(0, 30);
    markDirty(); render(); notify(`${ability.name}: ${title}`);
  }

  function rollExpressionWithHistory(expression, label) {
    const roll = RPG.rollDiceExpression(expression);
    state.combat.rollHistory.unshift({ ...roll, label, expression: `${label}: ${roll.expression}`, at: new Date().toISOString() });
    state.combat.rollHistory = state.combat.rollHistory.slice(0, 30);
    return roll;
  }

  function rollAbilityDamage(ability) {
    ensureCombatExtensions();
    const plan = abilityDamagePlan(ability);
    if (!plan) { notify('Esta habilidade ainda não possui uma rolagem numérica de dano definida.', 'error'); return; }

    let total = plan.flat;
    const detail = [];
    let primarySides = plan.primarySides;

    if (plan.externalProjectile) {
      const value = prompt('Informe o dano do projétil já rolado:', '0');
      if (value === null) return;
      const projectile = Math.max(0, num(value));
      total += projectile;
      detail.push(`Projétil ${projectile}`);
    }

    if (!primarySides && plan.unresolvedBonusDice > 0) {
      const sidesInput = prompt('Qual é o tamanho do dado principal deste ataque? Ex.: digite 8 para d8.', '8');
      if (sidesInput === null) return;
      primarySides = Math.max(2, Math.floor(num(sidesInput) || 8));
      for (let i = 0; i < plan.unresolvedBonusDice; i += 1) plan.dice.push({ count: 1, sides: primarySides, label: 'Dado adicional do ataque' });
    }

    if (plan.special === 'refraction') {
      const countRoll = RPG.rollDiceExpression('1d4+1');
      const count = countRoll.result;
      const damageRoll = RPG.rollDiceExpression(`${count}d8`);
      total += damageRoll.result;
      detail.push(`Refrações ${countRoll.details.join(' ')} = ${count}`, `${count}d8 = ${damageRoll.result}`);
      plan.dice.filter(d => d.label !== `${count}d8`).forEach(() => {});
      const extraDice = plan.dice.filter(d => !(d.count === 1 && d.sides === 4));
      for (const die of extraDice) {
        const r = RPG.rollDiceExpression(`${die.count}d${die.sides}`);
        total += r.result;
        detail.push(`${die.label}: ${r.expression} = ${r.result}`);
      }
    } else {
      for (const die of plan.dice) {
        const r = RPG.rollDiceExpression(`${die.count}d${die.sides}`);
        total += r.result;
        detail.push(`${die.label}: ${r.expression} = ${r.result}`);
      }
    }

    if (plan.flat) detail.push(`Bônus fixos +${plan.flat}`);
    const result = { title: `${total} de dano`, result: total, details: detail.join(' · '), at: new Date().toISOString() };
    state.combat.abilityResults[ability.id] = result;
    state.combat.rollHistory.unshift({ result: total, expression: `${ability.name}: dano = ${total}`, details: detail, at: result.at });
    state.combat.rollHistory = state.combat.rollHistory.slice(0, 30);
    markDirty();
    render();
    notify(`${ability.name}: ${total} de dano.`);
  }

  function rollParryOutcome(ability) {
    ensureCombatExtensions();
    const coin = RPG.rollDiceExpression('1d2');
    const success = coin.result === 1;
    const result = success
      ? { success: true, title: 'Cara · Parry bem-sucedido', details: 'Dano anulado. 1 ação que custaria P.V de Reação pode ser usada sem gastar P.V.', at: new Date().toISOString() }
      : { success: false, title: 'Coroa · Parry falhou', details: 'Tatsumaki recebe o dano completo do ataque, aplicando resistências e reduções normalmente.', at: new Date().toISOString() };
    state.combat.abilityResults[ability.id] = result;
    state.combat.rollHistory.unshift({ result: success ? 'Cara' : 'Coroa', expression: `${ability.name}: moeda`, details: [`1d2 = ${coin.result}`, success ? 'Cara = sucesso' : 'Coroa = falha'], at: result.at });
    state.combat.rollHistory = state.combat.rollHistory.slice(0, 30);
    if (success) {
      state.combat.freeReactionActions = Math.max(0, num(state.combat.freeReactionActions)) + 1;
      notify('Cara: dano anulado. Você ganhou 1 ação de Reação sem custo de P.V.');
    } else {
      notify('Coroa: Parry falhou. Informe o dano recebido.');
      setTimeout(() => openDamageDialog({ source: 'Parry falhou · dano completo do ataque' }), 30);
    }
  }

  function isPhysicalDamageType(type) {
    return String(type).startsWith('physical-');
  }

  function currentClothingReduction() {
    return RPG.quarter(state.data, state.rules, 'FORT') + RPG.quarter(state.data, state.rules, 'FOR');
  }

  function availableDamageProtections(type) {
    const trueDamage = type === 'true';
    const physical = isPhysicalDamageType(type);
    const cutting = type === 'physical-cutting';
    const profile = activeTransformationProfile();
    const protections = [];
    if (!trueDamage && cutting && RPG.essenceLevel(state.data, 'defense') >= 3) protections.push({ id: 'guardian', kind: 'resistance', factor: 0.5, label: 'Aura Guardiã · Resistência a Dano Cortante (metade)' });
    if (!trueDamage && physical && profile?.physicalResistance) protections.push({ id: 'personification-physical', kind: 'resistance', factor: 0.5, label: 'Personificação do Caos · Resistência a dano físico (metade)' });
    if (!trueDamage && activeEssenceEffect('aura-aco')) protections.push({ id: 'steel-aura', kind: 'resistance', factor: 0.5, label: 'Aura de Aço · Resistência ativa (metade)' });
    if (!trueDamage && physical) protections.push({ id: 'clothing', kind: 'flat', amount: currentClothingReduction(), label: `Roupa · redução física de ¼ FORT + ¼ FOR = ${currentClothingReduction()}` });
    if (!trueDamage && profile?.chaosShield) protections.push({ id: 'chaos-shield', kind: 'roll', expression: '2d8', label: `${profile.name} · Escudo Natural 2d8` });
    if (!trueDamage && physical && state.combat?.activePosture === 'impenetravel-destruidor') protections.push({ id: 'posture-block', kind: 'roll', expression: '1d8', defaultChecked: false, label: 'Postura Impenetrável e Destruidor · +1d8 de defesa física (marque somente em bloqueio bem-sucedido)' });
    (state.combat?.pendingDamageReductions || []).forEach(item => {
      if (item.damageType === type) protections.push({ id: item.id, kind: 'flat', amount: item.amount, consumeOnUse: true, label: item.label });
    });
    return protections;
  }

  function renderDamageProtections() {
    const type = damageType.value;
    const options = availableDamageProtections(type);
    if (type === 'true') {
      damageProtections.innerHTML = '<div class="damage-true-warning">Dano Verdadeiro ignora resistências e reduções normais e reduz diretamente o núcleo de P.S.</div>';
      manualResistance.checked = false;
      manualResistance.disabled = true;
      manualReduction.value = 0;
      manualReduction.disabled = true;
    } else {
      manualResistance.disabled = false;
      manualReduction.disabled = false;
      damageProtections.innerHTML = options.length
        ? options.map(item => `<label class="damage-protection-option"><input type="checkbox" data-damage-protection="${esc(item.id)}" ${item.defaultChecked === false ? '' : 'checked'}><span><strong>${esc(item.label)}</strong><small>${item.kind === 'resistance' ? 'Resistências não acumulam: somente a mais forte será aplicada.' : item.kind === 'roll' ? 'Será rolado somente ao confirmar o dano.' : 'Redução fixa.'}</small></span></label>`).join('')
        : '<span class="muted">Nenhuma proteção automática se aplica a este tipo de dano.</span>';
    }
    updateDamagePreview();
  }

  function calculateIncomingDamage(rollRandom = false) {
    const incoming = Math.max(0, Math.floor(num(incomingDamage.value)));
    const type = damageType.value;
    if (type === 'true') return { incoming, final: incoming, resistanceApplied: false, resistanceLabel: '', reductions: [], reflected: 0, trueDamage: true };

    const options = Object.fromEntries(availableDamageProtections(type).map(item => [item.id, item]));
    const checked = [...damageProtections.querySelectorAll('[data-damage-protection]:checked')].map(input => options[input.dataset.damageProtection]).filter(Boolean);
    if (manualResistance.checked) checked.push({ id: 'manual-resistance', kind: 'resistance', factor: 0.5, label: 'Outra Resistência (metade)' });
    const manual = Math.max(0, Math.floor(num(manualReduction.value)));
    if (manual) checked.push({ id: 'manual-reduction', kind: 'flat', amount: manual, label: `Redução manual ${manual}` });

    const resistances = checked.filter(x => x.kind === 'resistance');
    const strongest = resistances.length ? resistances.reduce((best, item) => item.factor < best.factor ? item : best) : null;
    const reductions = [];
    let flat = 0;
    checked.filter(x => x.kind === 'flat').forEach(item => { flat += Math.max(0, num(item.amount)); reductions.push({ label: item.label, amount: num(item.amount) }); });
    checked.filter(x => x.kind === 'roll').forEach(item => {
      if (rollRandom) {
        const r = RPG.rollDiceExpression(item.expression);
        flat += r.result;
        reductions.push({ label: `${item.label}: ${r.expression} = ${r.result}`, amount: r.result, roll: r });
      } else reductions.push({ label: `${item.label}: será rolado ao aplicar`, amount: 0, pendingRoll: true });
    });

    let value = incoming;
    const order = damageOrder.value;
    if (order === 'flat-first') {
      value = Math.max(0, value - flat);
      if (strongest) value = Math.floor(value * strongest.factor);
    } else {
      if (strongest) value = Math.floor(value * strongest.factor);
      value = Math.max(0, value - flat);
    }
    const reflected = activeTransformationProfile()?.id === 'personificacao-caos' ? Math.floor(value * 0.25) : 0;
    return { incoming, final: value, resistanceApplied: !!strongest, resistanceLabel: strongest?.label || '', resistanceCount: resistances.length, reductions, reflected, trueDamage: false, order, selectedProtectionIds: checked.map(item => item.id) };
  }

  function updateDamagePreview() {
    if (!damageDialog?.open) return;
    const calc = calculateIncomingDamage(false);
    const lines = [];
    if (calc.trueDamage) lines.push('Dano Verdadeiro: nenhuma resistência ou redução normal é aplicada.');
    else {
      if (calc.resistanceApplied) lines.push(`${calc.resistanceLabel}${calc.resistanceCount > 1 ? ` · ${calc.resistanceCount} resistências elegíveis, mas só 1 é aplicada` : ''}`);
      calc.reductions.forEach(item => lines.push(item.label));
      if (calc.reflected) lines.push(`Personificação: após receber o dano, ${calc.reflected} será indicado como dano a refletir.`);
    }
    damagePreview.innerHTML = `<span>Dano informado: <b>${calc.incoming}</b></span><strong>Dano final${calc.reductions?.some(x => x.pendingRoll) ? ' antes das rolagens de redução' : ''}: ${calc.final}</strong>${lines.length ? `<small>${lines.map(esc).join(' · ')}</small>` : ''}`;
  }

  function openDamageDialog(context = {}) {
    pendingDamageContext = context;
    damageSource.textContent = context.source || 'Dano recebido';
    incomingDamage.value = Math.max(0, num(context.amount));
    damageType.value = context.type || 'physical-other';
    damageOrder.value = 'resistance-first';
    manualResistance.checked = false;
    manualReduction.value = 0;
    renderDamageProtections();
    if (!damageDialog.open) damageDialog.showModal();
  }

  function applyIncomingDamage() {
    const calc = calculateIncomingDamage(true);
    if (calc.incoming <= 0) { notify('Informe um valor de dano maior que zero.', 'error'); return; }
    if (calc.trueDamage) changeTrueDamage(calc.final);
    else spendResource('ps', calc.final);
    ensureCombatExtensions();
    const details = [];
    if (calc.resistanceApplied) details.push(calc.resistanceLabel, calc.resistanceCount > 1 ? `Resistência aplicada uma única vez entre ${calc.resistanceCount} opções.` : '');
    calc.reductions.forEach(item => details.push(item.label));
    if (calc.reflected) details.push(`Refletir ao atacante: ${calc.reflected}`);
    if (calc.selectedProtectionIds?.length) {
      state.combat.pendingDamageReductions = (state.combat.pendingDamageReductions || []).filter(item => !calc.selectedProtectionIds.includes(item.id));
    }
    state.combat.damageHistory.unshift({ source: pendingDamageContext?.source || 'Dano recebido', type: damageType.value, incoming: calc.incoming, final: calc.final, details: details.filter(Boolean), at: new Date().toISOString() });
    state.combat.damageHistory = state.combat.damageHistory.slice(0, 30);
    state.combat.rollHistory.unshift({ result: calc.final, expression: `Tomar Dano: ${calc.incoming} → ${calc.final}`, details: details.filter(Boolean), at: new Date().toISOString() });
    state.combat.rollHistory = state.combat.rollHistory.slice(0, 30);
    markDirty();
    damageDialog.close();
    renderCombat();
    notify(`Tatsumaki recebeu ${calc.final} de dano.${calc.reflected ? ` Refletir ${calc.reflected}.` : ''}`);
  }

  function attributeTotal(abbr) {
    return RPG.attributeTotal(state.data.attributes?.[abbr]);
  }

  function resourceCard(key, combat = false) {
    const r = state.data.resources[key];
    const formulaBase = RPG.resourceFormulaBase(state.data, state.rules, key);
    const current = RPG.resourceCurrent(state.data, state.rules, key);
    const temporary = key === 'pv' ? 0 : Math.max(0, num(r.temporary));
    const trueDamage = key === 'ps' ? Math.max(0, num(r.trueDamage)) : 0;
    const coreMax = RPG.resourceCoreMax(state.data, state.rules, key);
    const capacityBeforeLoss = RPG.resourceCapacity(state.data, state.rules, key);
    const maxBonus = Math.max(0, num(r.maxBonus));
    const percent = capacityBeforeLoss > 0 ? Math.max(0, Math.min(100, current / capacityBeforeLoss * 100)) : 0;

    return `
      <article class="resource-card ${combat ? 'combat-resource' : ''}">
        <div class="resource-title-row">
          <span>${esc(r.label)}</span>
          <strong>${current} <small>máx. atual</small></strong>
        </div>

        <div class="resource-breakdown">
          <span>Fórmula ${formulaBase}</span>
          ${maxBonus ? `<span>Bônus máx. +${maxBonus}</span>` : ''}
          ${key === 'ps' && trueDamage ? `<span>Dano Verdadeiro −${trueDamage}</span>` : ''}
          ${temporary ? `<span>Temp +${temporary}</span>` : ''}
          ${num(r.lost) ? `<span>Perdido −${num(r.lost)}</span>` : ''}
          ${key === 'ps' ? `<span>Núcleo ${coreMax}</span>` : ''}
        </div>

        <div class="meter"><span style="width:${percent}%"></span></div>

        ${combat ? `
          <div class="resource-controls">
            <button data-action="resource-change" data-resource="${key}" data-delta="10">−10</button>
            <button data-action="resource-change" data-resource="${key}" data-delta="5">−5</button>
            <button data-action="resource-change" data-resource="${key}" data-delta="1">−1</button>
            <button data-action="resource-heal" data-resource="${key}" data-delta="1">+1</button>
            <button data-action="resource-heal" data-resource="${key}" data-delta="5">+5</button>
            <button data-action="resource-heal" data-resource="${key}" data-delta="10">+10</button>
          </div>
          ${key === 'ps' ? `
            <div class="true-damage-box">
              <span>Dano Verdadeiro <strong>${trueDamage}</strong></span>
              <div class="true-damage-controls">
                <button data-action="true-damage-change" data-delta="1">DV +1</button>
                <button data-action="true-damage-change" data-delta="5">DV +5</button>
                <button data-action="true-damage-change" data-delta="10">DV +10</button>
                <button data-action="true-damage-change" data-delta="-1">DV −1</button>
                <button data-action="true-damage-change" data-delta="-5">DV −5</button>
                <button data-action="true-damage-change" data-delta="-10">DV −10</button>
              </div>
            </div>` : ''}
        ` : `
          <div class="resource-fields ${key === 'ps' ? 'four-fields' : ''}">
            <label>Perdidos<input type="number" min="0" data-path="resources.${key}.lost" value="${num(r.lost)}"></label>
            <label>Bônus do máximo<input type="number" min="0" data-path="resources.${key}.maxBonus" value="${maxBonus}"></label>
            <label>Temporário<input type="number" min="0" data-path="resources.${key}.temporary" value="${temporary}"></label>
            ${key === 'ps' ? `<label>Dano Verdadeiro<input type="number" min="0" data-path="resources.ps.trueDamage" value="${trueDamage}"></label>` : ''}
          </div>
          <p class="help-text">O máximo base é calculado automaticamente pela fórmula da ficha.</p>
        `}
      </article>`;
  }

  function pvCard(combat = false) {
    const r = state.data.resources.pv;
    const totalMax = RPG.pvTotalMax(state.data, state.rules);
    const split = RPG.splitPv(totalMax);
    const attack = RPG.pvPoolCurrent(state.data, state.rules, 'attack');
    const reaction = RPG.pvPoolCurrent(state.data, state.rules, 'reaction');
    const totalCurrent = attack + reaction;
    const percent = totalMax > 0 ? Math.max(0, Math.min(100, totalCurrent / totalMax * 100)) : 0;
    const maxBonus = Math.max(0, num(r.maxBonus));

    const pool = (kind, label, current, max, lost) => `
      <div class="pv-pool">
        <div><span>${label}</span><strong>${current} / ${max}</strong></div>
        ${combat ? `
          <div class="pv-controls">
            <button data-action="pv-spend" data-pool="${kind}" data-delta="1">−1</button>
            <button data-action="pv-spend" data-pool="${kind}" data-delta="2">−2</button>
            <button data-action="pv-heal" data-pool="${kind}" data-delta="1">+1</button>
            <button data-action="pv-heal" data-pool="${kind}" data-delta="2">+2</button>
          </div>` : `<small>Gastos: ${lost}</small>`}
      </div>`;

    return `
      <article class="resource-card pv-card ${combat ? 'combat-resource' : ''}">
        <div class="resource-title-row">
          <span>P.V</span>
          <strong>${totalCurrent} <small>/ ${totalMax} pela fórmula</small></strong>
        </div>
        <div class="resource-breakdown">
          <span>Base: MAX(⅛ FOR, ⅛ DES) + 2</span>
          ${RPG.essencePvBonus(state.data) ? `<span>Liberação Instintiva: +${RPG.essencePvBonus(state.data)} P.V já incluído no +2 da fórmula</span>` : ''}
          ${maxBonus ? `<span>Bônus total +${maxBonus}</span>` : ''}
        </div>
        <div class="meter"><span style="width:${percent}%"></span></div>
        <div class="pv-pools">
          ${pool('attack', 'P.V Ataque', attack, split.attack, num(r.attackLost))}
          ${pool('reaction', 'P.V Reação', reaction, split.reaction, num(r.reactionLost))}
        </div>
        ${combat ? '' : `
          <div class="resource-fields pv-fields">
            <label>Bônus no P.V total<input type="number" min="0" step="1" data-path="resources.pv.maxBonus" value="${maxBonus}"></label>
            <label>Ataque gastos<input type="number" min="0" data-path="resources.pv.attackLost" value="${num(r.attackLost)}"></label>
            <label>Reação gastos<input type="number" min="0" data-path="resources.pv.reactionLost" value="${num(r.reactionLost)}"></label>
          </div>
          <p class="help-text">${totalMax} total → ${split.attack} de Ataque + ${split.reaction} de Reação.</p>
        `}
      </article>`;
  }

  function identityField(label, key, type = 'text') {
    const value = state.data.identity?.[key] ?? '';
    return `<label class="field"><span>${esc(label)}</span><input type="${type}" data-path="identity.${key}" value="${esc(value)}"></label>`;
  }

  function renderSheet() {
    const d = state.data;
    const attrs = Object.entries(d.attributes || {}).map(([abbr, attr]) => {
      const total = RPG.attributeTotal(attr);
      const quarter = RPG.fraction(total, state.rules.attributeQuarterDivisor || 4);
      const eighth = RPG.fraction(total, state.rules.attributeEighthDivisor || 8);
      return `
        <article class="attribute-card">
          <button type="button" class="attribute-edit-button" data-action="edit-attribute" data-attribute="${abbr}">
            <span>${esc(attr.name)}</span>
            <strong>${total}</strong>
            <small>¼ ${quarter} · ⅛ ${eighth}</small>
          </button>
          <button type="button" class="attribute-test-button" data-action="roll-attribute" data-attribute="${abbr}">Testar · 1d20 + ${eighth}</button>
        </article>`;
    }).join('');

    const grouped = Object.groupBy ? Object.groupBy(d.skills || [], s => s.attribute) : (d.skills || []).reduce((acc, skill) => {
      (acc[skill.attribute] ||= []).push(skill); return acc;
    }, {});
    const skillGroups = Object.entries(grouped).map(([abbr, skills]) => `
      <section class="skill-group card">
        <div class="card-title"><h3>${esc(d.attributes?.[abbr]?.name || abbr)}</h3><span>${abbr}</span></div>
        <div class="skill-table">
          <div class="skill-head"><span>Perícia</span><span>Nível</span><span>Pro.</span><span>Total</span><span>Teste</span></div>
          ${skills.map(skill => {
            const index = d.skills.indexOf(skill);
            const finalValue = RPG.skillTotal(skill, d, state.rules);
            return `<div class="skill-row">
              <span>${esc(skill.name)}</span>
              <input type="number" min="0" data-skill-index="${index}" data-skill-field="level" value="${num(skill.level)}">
              <input type="checkbox" data-skill-index="${index}" data-skill-field="proficient" ${skill.proficient ? 'checked' : ''}>
              <strong>+${finalValue}</strong>
              <button type="button" class="skill-test-button" data-action="roll-skill" data-skill-index="${index}">Rolar</button>
            </div>`;
          }).join('')}
        </div>
      </section>`).join('');

    RPG.applySheetFormulas(d, state.rules);
    const baseCa = RPG.armorClass(d, state.rules);
    const ca = baseCa + transformationCaBonus();
    const perception = RPG.perception(d);
    const luck = RPG.luck(d, state.rules);
    const armorParts = d.derived?.armorClass?.parts || [];

    appEl.innerHTML = `
      <section class="hero card">
        <div>
          <span class="eyebrow">FICHA DE PERSONAGEM</span>
          <input class="character-name-input" data-path="identity.name" value="${esc(d.identity.name)}" aria-label="Nome do personagem">
          <p>${esc(d.identity.class)} · ${esc(d.identity.race)}</p>
        </div>
        <div class="hero-stats">
          <span>CA <strong>${ca}</strong></span>
          <span>Mov. <strong>${num(d.derived?.movement)}</strong></span>
          <span>Inic. <strong>${num(d.derived?.initiative)}</strong></span>
          <span>Crítico <strong>${num(d.derived?.criticalMargin || state.rules.criticalMargin)}</strong></span>
        </div>
      </section>

      <section class="resources-grid">
        ${resourceCard('ps')}${pvCard()}${resourceCard('pf')}
      </section>

      <section class="two-column">
        <div>
          <div class="section-heading"><div><span class="eyebrow">BASE</span><h2>Atributos</h2></div><small>Clique em um atributo para abrir os modificadores.</small></div>
          <div class="attribute-grid">${attrs}</div>
        </div>
        <div class="card derived-card">
          <div class="card-title"><h3>Combate e derivados</h3></div>
          <div class="derived-grid">
            <label>Percepção Passiva<input type="number" value="${perception}" readonly title="Fórmula original da ficha: 8 + metade da Destreza, arredondada para baixo"></label>
            <label>Sorte<input type="number" value="${luck}" readonly title="1/4 da Destreza, arredondado para baixo"></label>
            <label>Movimento<input type="number" data-path="derived.movement" value="${num(d.derived?.movement)}"></label>
            <label>Iniciativa<input type="number" data-path="derived.initiative" value="${num(d.derived?.initiative)}"></label>
            <label>Margem crítica<input type="number" data-path="derived.criticalMargin" value="${num(d.derived?.criticalMargin || state.rules.criticalMargin)}"></label>
          </div>
          <div class="armor-breakdown">
            <span>Classe de Armadura <strong>${ca}${transformationCaBonus() ? ` <small>(base ${baseCa} + ${transformationCaBonus()} transformação)</small>` : ''}</strong></span>
            ${armorParts.map((part, i) => {
              const normalized = String(part.label || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
              const isDex = normalized === 'destreza';
              const value = isDex ? RPG.quarter(d, state.rules, 'DES') : num(part.value);
              return `<label>${esc(part.label)}<input type="number" ${isDex ? 'readonly title="Calculado como 1/4 da Destreza"' : `data-armor-index="${i}"`} value="${value}"></label>`;
            }).join('')}
          </div>
        </div>
      </section>

      <section class="card identity-card">
        <div class="card-title"><h3>Dados do personagem</h3></div>
        <div class="form-grid">
          ${identityField('Raça','race')}${identityField('Classe','class')}${identityField('Profissão','profession')}
          ${identityField('Idade','age','number')}${identityField('Altura','height','number')}${identityField('Peso','weight','number')}
          ${identityField('Experiência','experience')}${identityField('Pontos de classe','classPoints','number')}${identityField('Pontos de profissão','professionPoints','number')}
          ${identityField('Dados de foco','focusDice','number')}${identityField('Dados de sangue','bloodDice','number')}${identityField('Pontos de afinidade','affinityPoints')}
          ${identityField('Origem','origin')}${identityField('Afinidade','affinity')}${identityField('Estilo de vida','lifestyle')}
        </div>
      </section>

      <div class="section-heading"><div><span class="eyebrow">TESTES</span><h2>Perícias</h2></div><small>Total da ficha = ⅛ do atributo + nível; com proficiência, soma novamente ⅛.</small></div>
      <section class="skills-grid">${skillGroups}</section>
    `;
  }

  function cooldownFor(id) { return Math.max(0, num(state.combat.cooldowns?.[id])); }
  function usesFor(id) { return Math.max(0, num(state.combat.uses?.[id])); }

  function abilityCombatCard(ability) {
    const cd = cooldownFor(ability.id);
    const uses = usesFor(ability.id);
    const limit = ability.usesPerCombat || ability.usesPerSession || ability.usesPerDay || 0;
    const exhausted = limit && uses >= limit;
    return `<article class="ability-card ${cd ? 'cooling' : ''}">
      <div class="ability-top">
        <div><span class="tag">${esc(ability.category)}</span><span class="tag essence-tag">Essência</span><h3>${esc(ability.name)}</h3></div>
        ${cd ? `<span class="cooldown">${cd} turno${cd === 1 ? '' : 's'}</span>` : ''}
      </div>
      <p>${esc(ability.summary)}</p>
      ${ability.id === 'parry' ? '<div class="ability-special-rule"><strong>Moeda:</strong> Cara = anula o dano e libera 1 ação de Reação sem custo de P.V. · Coroa = recebe o dano completo, aplicando resistências e reduções.</div>' : ''}
      ${ability.damage ? essenceDamageReminderHtml(ability) : ''}
      ${ability.damage ? abilityDamageFormulaHtml(ability) : ''}
      ${abilityResultHtml(ability)}
      <div class="ability-meta">
        <span>${esc(effectiveCostLabel(ability))}</span>
        ${ability.damage ? `<span>${esc(ability.damage)}</span>` : ''}
        ${limit ? `<span>Usos: ${uses}/${limit}</span>` : ''}
      </div>
      <div class="ability-actions">
        <button class="primary-btn small" data-action="use-ability" data-ability="${ability.id}" ${cd || exhausted ? 'disabled' : ''}>${ability.id === 'parry' ? 'Usar e rolar moeda' : 'Usar'}</button>
        ${ability.damage ? `<button class="secondary-btn small" data-action="roll-ability-damage" data-ability="${ability.id}">Rolar dano</button>` : ''}
        ${abilitySpecialActionsHtml(ability)}
        ${ability.cost?.chaosAlternative ? `<button class="secondary-btn small" data-action="use-ability-chaos" data-ability="${ability.id}" ${cd || exhausted ? 'disabled' : ''}>Usar com Caos</button>` : ''}
        ${cd ? `<button class="ghost-btn small" data-action="clear-cooldown" data-ability="${ability.id}">Zerar recarga</button>` : ''}
      </div>
    </article>`;
  }

  function renderCombat() {
    const active = state.combat.active;
    const conditions = state.combat.conditions || [];
    appEl.innerHTML = `
      <section class="combat-header card ${active ? 'combat-active' : ''}">
        <div>
          <span class="eyebrow">MODO DE COMBATE</span>
          <h1>${active ? `Rodada ${state.combat.round} · Turno ${state.combat.turn}` : 'Fora de combate'}</h1>
          <p>Recargas, transformações, condições e recursos são salvos junto da ficha.</p>
          <div class="combat-inline-status">
            <span>CA atual <b>${RPG.armorClass(state.data, state.rules) + transformationCaBonus()}</b></span>
            ${num(state.combat.freeReactionActions) ? `<span class="free-reaction-status">Reação grátis: <b>${num(state.combat.freeReactionActions)}</b></span>` : ''}
          </div>
        </div>
        <div class="combat-header-actions">
          <button class="damage-btn" data-action="take-damage">Tomar Dano</button>
          ${active ? `
            <button class="secondary-btn" data-action="next-turn">Próximo turno</button>
            <button class="secondary-btn" data-action="next-round">Nova rodada</button>
            <button class="danger-btn" data-action="end-combat">Encerrar combate</button>
          ` : `<button class="primary-btn" data-action="start-combat">Iniciar combate</button>`}
        </div>
      </section>

      <section class="resources-grid combat-grid">
        ${resourceCard('ps', true)}${pvCard(true)}${resourceCard('pf', true)}
      </section>
      <p class="combat-rule-note">P.V de Ataque e Reação são restaurados automaticamente ao iniciar uma nova rodada e ao encerrar o combate.</p>

      <section class="card essence-combat-card">
        <div class="card-title"><div><span class="eyebrow">ESSÊNCIA</span><h3>Passivas e técnicas</h3></div></div>
        ${essencePassivesHtml(true)}
        ${essenceDamageReminderHtml()}
        <div class="essence-active-grid">
          ${RPG.essenceActiveAbilities(state.data, state.rules).map(def => {
            const activeEffect = activeEssenceEffect(def.id);
            const usedToday = num(state.data.essence?.dailyUses?.[def.id]);
            const disabledDaily = def.usesPerDay && usedToday >= def.usesPerDay;
            const effectiveCost = def.perTurnCost ? RPG.effectiveAbilityCost(def.perTurnCost, state.data) : null;
            return `<article class="essence-technique ${activeEffect ? 'active' : ''}">
              <div><span class="tag">${esc(def.path)}</span><strong>${esc(def.name)}</strong></div>
              <p>${esc(def.summary)}</p>
              ${def.defense ? `<small>Defesa atual: ${esc(def.defense)}</small>` : ''}
              ${effectiveCost ? `<small>Custo por turno: ${esc(RPG.formatCost(effectiveCost))}${RPG.essencePfDiscount(state.data) ? ' (Controle Parcial aplicado)' : ''}</small>` : ''}
              ${def.usesPerDay ? `<small>Uso diário: ${usedToday}/${def.usesPerDay}</small>` : ''}
              ${activeEffect
                ? `<div class="essence-effect-status"><span>${num(activeEffect.turns)} turno${num(activeEffect.turns) === 1 ? '' : 's'} restante${num(activeEffect.turns) === 1 ? '' : 's'}</span><button class="ghost-btn small" data-action="end-essence-effect" data-effect="${esc(def.id)}">Encerrar</button></div>`
                : `<button class="secondary-btn small" data-action="activate-essence-effect" data-effect="${esc(def.id)}" ${disabledDaily ? 'disabled' : ''}>Ativar</button>`}
            </article>`;
          }).join('')}
        </div>
      </section>

      <section class="combat-tools-grid">
        <article class="card chaos-card">
          <div class="card-title"><h3>Pontos de Caos</h3></div>
          <div class="counter-large">
            <button data-action="chaos-change" data-delta="-1">−</button>
            <strong>${num(state.combat.chaosPoints)}</strong>
            <button data-action="chaos-change" data-delta="1">＋</button>
          </div>
        </article>

        <article class="card">
          <div class="card-title"><h3>Postura</h3></div>
          <select data-combat-path="activePosture">
            <option value="">Nenhuma</option>
            ${(state.data.postures || []).map(p => `<option value="${esc(p.id)}" ${state.combat.activePosture === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select>
          ${state.combat.activePosture ? `<p class="help-text">${esc((state.data.postures || []).find(p => p.id === state.combat.activePosture)?.summary || '')}</p>` : ''}
        </article>

        <article class="card">
          <div class="card-title"><h3>Transformação</h3></div>
          ${transformationPanelHtml()}
        </article>

        <article class="card">
          <div class="card-title"><h3>Condições e efeitos</h3><button class="ghost-btn small" data-action="add-condition">Adicionar</button></div>
          <div class="chips">${conditions.length ? conditions.map((c, i) => `<button class="chip" data-action="remove-condition" data-index="${i}" title="Clique para remover">${esc(typeof c === 'string' ? c : c.name)}</button>`).join('') : '<span class="muted">Nenhuma condição ativa.</span>'}</div>
        </article>
      </section>

      <section class="dice-panel card">
        <div class="card-title"><div><span class="eyebrow">ROLAGEM RÁPIDA</span><h3>Dados</h3></div></div>
        <div class="dice-row">
          <input id="diceExpression" placeholder="Ex.: 3d8+14" autocomplete="off">
          <button class="primary-btn" data-action="roll-dice">Rolar</button>
          <button class="ghost-btn" data-action="quick-die" data-die="d20">d20</button>
          <button class="ghost-btn" data-action="quick-die" data-die="d12">d12</button>
          <button class="ghost-btn" data-action="quick-die" data-die="d10">d10</button>
          <button class="ghost-btn" data-action="quick-die" data-die="d8">d8</button>
          <button class="ghost-btn" data-action="quick-die" data-die="d6">d6</button>
        </div>
        <div class="roll-history">
          ${(state.combat.rollHistory || []).slice(0, 8).map(r => `<div><strong>${esc(r.result)}</strong><span>${esc(r.expression)}</span><small>${esc((r.details || []).join(' · '))}</small></div>`).join('') || '<span class="muted">As rolagens recentes aparecem aqui.</span>'}
        </div>
      </section>

      <div class="section-heading"><div><span class="eyebrow">ATALHOS</span><h2>Habilidades de combate</h2></div><small>Usar uma habilidade aplica custos e recarga registrados na ficha.</small></div>
      <section class="ability-grid">${(state.data.abilities || []).map(abilityCombatCard).join('')}</section>
    `;
  }

  function renderAbilities() {
    appEl.innerHTML = `
      <section class="section-heading"><div><span class="eyebrow">ARSENAL</span><h2>Habilidades</h2></div><input id="abilitySearch" class="search-input" placeholder="Buscar habilidade…"></section>
      <section class="card essence-ability-banner">
        <div class="card-title"><div><span class="eyebrow">MODIFICADORES SEMPRE ATIVOS</span><h3>Essência aplicada às habilidades</h3></div></div>
        ${essencePassivesHtml(true)}
        ${essenceDamageReminderHtml()}
      </section>
      <section class="ability-grid" id="abilitiesList">
        ${(state.data.abilities || []).map(a => `<article class="ability-card searchable" data-search="${esc(`${a.name} ${a.category} ${a.summary}`.toLowerCase())}">
          <div class="ability-top"><div><span class="tag">${esc(a.category)}</span><span class="tag essence-tag">Essência</span><h3>${esc(a.name)}</h3></div><span>${esc(a.type || '')}</span></div>
          <p>${esc(a.summary)}</p>
          ${a.id === 'parry' ? '<div class="ability-special-rule"><strong>Moeda:</strong> Cara = anula o dano e gera 1 ação de Reação sem custo de P.V. · Coroa = recebe o dano completo com resistências/reduções.</div>' : ''}
          ${a.damage ? essenceDamageReminderHtml(a) : ''}
          ${a.damage ? abilityDamageFormulaHtml(a) : ''}
          ${abilityResultHtml(a)}
          <div class="ability-meta"><span>${esc(effectiveCostLabel(a))}</span>${a.cooldown ? `<span>Recarga: ${a.cooldown}</span>` : ''}${a.damage ? `<span>${esc(a.damage)}</span>` : ''}</div>
          ${(a.damage || abilitySpecialActionsHtml(a)) ? `<div class="ability-actions">${a.damage ? `<button class="secondary-btn small" data-action="roll-ability-damage" data-ability="${esc(a.id)}">Rolar dano</button>` : ''}${abilitySpecialActionsHtml(a)}</div>` : ''}
        </article>`).join('')}
      </section>`;
  }

  function renderInventory() {
    const items = state.data.inventory || [];
    const used = items.reduce((sum, item) => sum + num(item.space) * (num(item.quantity) || 1), 0);
    appEl.innerHTML = `
      <section class="section-heading"><div><span class="eyebrow">EQUIPAMENTO</span><h2>Inventário</h2></div><button class="primary-btn" data-action="add-item">Adicionar item</button></section>
      <section class="card inventory-card">
        <div class="inventory-head"><span>Item</span><span>Quantidade</span><span>Espaço</span><span></span></div>
        ${items.map((item, index) => `<div class="inventory-row">
          <input data-item-index="${index}" data-item-field="name" value="${esc(item.name)}">
          <input type="number" min="0" data-item-index="${index}" data-item-field="quantity" value="${esc(item.quantity)}">
          <input type="number" min="0" step="0.1" data-item-index="${index}" data-item-field="space" value="${num(item.space)}">
          <button class="icon-btn danger-text" data-action="remove-item" data-index="${index}" aria-label="Remover item">×</button>
        </div>`).join('')}
        <div class="inventory-footer"><span>Espaço utilizado</span><strong>${used}</strong></div>
      </section>`;
  }

  function renderEssence() {
    const labels = {
      true: 'Essência Verdadeira', offense: 'Ofensiva', defense: 'Defensiva', magic: 'Aptidão Mágica',
      broken: 'Essência Quebrada', annihilation: 'Aniquilação', shred: 'Retalhação', control: 'Controle'
    };
    const levels = state.data.essence?.levels || {};
    const stages = state.data.essence?.stages || {};
    ensureEssenceCombatState();
    const activeDefs = RPG.essenceActiveAbilities(state.data, state.rules);
    appEl.innerHTML = `
      <section class="section-heading"><div><span class="eyebrow">PROGRESSÃO</span><h2>Essência</h2></div><small>Passivas desbloqueadas afetam automaticamente os cálculos que têm regra inequívoca.</small></section>

      <section class="card essence-summary-card">
        <div class="card-title"><div><span class="eyebrow">EFEITOS ATIVOS</span><h3>Passivas do personagem</h3></div></div>
        ${essencePassivesHtml(false)}
      </section>

      <section class="card essence-summary-card">
        <div class="card-title"><div><span class="eyebrow">TÉCNICAS</span><h3>Habilidades da Essência</h3></div></div>
        <div class="essence-active-grid">
          ${activeDefs.map(def => {
            const activeEffect = activeEssenceEffect(def.id);
            const usedToday = num(state.data.essence?.dailyUses?.[def.id]);
            const effectiveCost = def.perTurnCost ? RPG.effectiveAbilityCost(def.perTurnCost, state.data) : null;
            return `<article class="essence-technique ${activeEffect ? 'active' : ''}">
              <div><span class="tag">${esc(def.path)}</span><strong>${esc(def.name)}</strong></div>
              <p>${esc(def.summary)}</p>
              ${def.defense ? `<small>Defesa atual: ${esc(def.defense)}</small>` : ''}
              ${effectiveCost ? `<small>Custo por turno: ${esc(RPG.formatCost(effectiveCost))}${RPG.essencePfDiscount(state.data) ? ' · -1 P.F já aplicado' : ''}</small>` : ''}
              ${def.usesPerDay ? `<small>Uso diário: ${usedToday}/${def.usesPerDay}</small>` : ''}
              ${activeEffect
                ? `<div class="essence-effect-status"><span>Ativa · ${num(activeEffect.turns)} turno${num(activeEffect.turns) === 1 ? '' : 's'}</span><button class="ghost-btn small" data-action="end-essence-effect" data-effect="${esc(def.id)}">Encerrar</button></div>`
                : `<button class="secondary-btn small" data-action="activate-essence-effect" data-effect="${esc(def.id)}" ${!state.combat.active || (def.usesPerDay && usedToday >= def.usesPerDay) ? 'disabled' : ''}>${state.combat.active ? 'Ativar' : 'Inicie um combate'}</button>`}
            </article>`;
          }).join('')}
        </div>
        ${RPG.essenceLevel(state.data, 'offense') >= 4 ? `<div class="daily-reset-row"><span>Liberação Condensada é limitada a 1 uso por dia.</span><button class="ghost-btn small" data-action="reset-essence-daily" data-effect="liberacao-condensada">Restaurar uso diário</button></div>` : ''}
      </section>

      <section class="essence-grid">
        ${Object.keys(labels).map(key => {
          const level = num(levels[key]);
          return `<article class="card essence-card">
            <div class="card-title"><h3>${esc(labels[key])}</h3><input type="number" min="0" max="10" data-essence-key="${key}" value="${level}"></div>
            <div class="stage-list">${(stages[key] || []).map((name, i) => `<div class="stage ${i + 1 <= level ? 'unlocked' : ''} ${i + 1 === level ? 'current' : ''}"><span>${i + 1}</span><p>${esc(name)}</p></div>`).join('')}</div>
          </article>`;
        }).join('')}
      </section>
      <section class="card note-card"><h3>Observações</h3><textarea data-path="essence.note" rows="18">${esc(state.data.essence?.note || '')}</textarea></section>`;
  }

  function renderKarma() {
    const k = state.data.karma || {};
    appEl.innerHTML = `
      <section class="karma-layout">
        <article class="card karma-card positive">
          <span class="eyebrow">KARMA POSITIVO</span>
          <div class="counter-large"><button data-action="karma-change" data-kind="positive" data-delta="-1">−</button><strong>${num(k.positive)}</strong><button data-action="karma-change" data-kind="positive" data-delta="1">＋</button></div>
        </article>
        <article class="card karma-card negative">
          <span class="eyebrow">KARMA NEGATIVO</span>
          <div class="counter-large"><button data-action="karma-change" data-kind="negative" data-delta="-1">−</button><strong>${num(k.negative)}</strong><button data-action="karma-change" data-kind="negative" data-delta="1">＋</button></div>
        </article>
      </section>
      <section class="card karma-notes">
        <label>Dado de Karma<input data-path="karma.die" value="${esc(k.die || 'd8')}"></label>
        <label>Frase / observação<textarea data-path="karma.note" rows="4">${esc(k.note || '')}</textarea></label>
      </section>`;
  }

  function renderArchive() {
    appEl.innerHTML = `
      <section class="section-heading"><div><span class="eyebrow">IMPORTADO DA PLANILHA</span><h2>Arquivo da ficha</h2></div><small>Textos longos preservados em blocos para consulta.</small></section>
      <section class="archive-list">
        ${(state.data.library || []).map((entry, i) => `<details class="card archive-card" ${i === 0 ? 'open' : ''}>
          <summary>${esc(entry.title)}</summary>
          <pre>${esc(entry.content || '')}</pre>
        </details>`).join('')}
      </section>`;
  }

  function render() {
    if (!state.data) return;
    document.querySelectorAll('#tabs button').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === state.activeTab));
    if (state.activeTab === 'sheet') renderSheet();
    if (state.activeTab === 'combat') renderCombat();
    if (state.activeTab === 'abilities') renderAbilities();
    if (state.activeTab === 'inventory') renderInventory();
    if (state.activeTab === 'essence') renderEssence();
    if (state.activeTab === 'karma') renderKarma();
    if (state.activeTab === 'archive') renderArchive();
  }

  function renderCharacterSelect() {
    characterSelect.innerHTML = state.characters.map(c => `<option value="${esc(c.slug)}" ${c.slug === state.character?.slug ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  }

  function applySnapshot(snapshot) {
    const textRepairs = RPG.repairMojibakeDeep(snapshot);
    state.system = snapshot.system;
    state.characters = snapshot.characters || [];
    state.character = snapshot.character;
    state.mode = snapshot.mode || 'remote';
    if (!state.character) throw new Error('Nenhuma ficha encontrada.');
    state.data = RPG.clone(state.character.data);
    const resourceModelUpdated = RPG.normalizeCharacterData(state.data);
    state.combat = RPG.clone(state.character.combat || {});
    state.rules = RPG.clone(state.system.rules || {});
    RPG.applySheetFormulas(state.data, state.rules);
    state.combat.cooldowns ||= {};
    state.combat.uses ||= {};
    state.combat.conditions ||= [];
    state.combat.rollHistory ||= [];
    state.combat.essenceEffects ||= {};
    state.combat.pendingTransformation ||= null;
    state.combat.transformationActivationTurns = Math.max(0, num(state.combat.transformationActivationTurns));
    ensureCombatExtensions();
    state.data.essence ||= { levels: {}, stages: {}, note: '' };
    state.data.essence.dailyUses ||= {};
    const abilityEssenceTagsUpdated = RPG.ensureAbilityTags(state.data);
    const specialAbilitiesUpdated = normalizeSpecialAbilities();
    let essenceLevelUpdated = false;
    if (state.character.slug === 'tatsumaki-shadowheart-gojo' && num(state.data.essence.levels?.true) !== 5) {
      state.data.essence.levels ||= {};
      state.data.essence.levels.true = 5;
      state.dirty = true;
      essenceLevelUpdated = true;
    }
    RPG.applySheetFormulas(state.data, state.rules);
    systemName.textContent = state.system.name || 'RPG';
    renderCharacterSelect();
    DB.updateUrlCharacter(state.character.slug);
    render();

    if (state.mode === 'local') {
      banner.classList.remove('hidden');
      banner.innerHTML = DB.remoteConfigured
        ? 'Este navegador ainda não tem a chave de acesso do Supabase. Abra uma vez o link privado completo; depois a chave fica lembrada neste navegador.'
        : 'Modo local de demonstração: os dados estão sendo salvos neste navegador. Configure o Supabase para sincronizar pela internet.';
      setSaveStatus('Modo local', 'local');
    } else {
      banner.classList.add('hidden');
      setSaveStatus('Conectado ao banco', 'saved');
    }

    if (resourceModelUpdated || textRepairs > 0 || essenceLevelUpdated || abilityEssenceTagsUpdated || specialAbilitiesUpdated) {
      state.dirty = true;
      clearTimeout(state.saveTimer);
      state.saveTimer = setTimeout(saveNow, 120);
      if (textRepairs > 0) notify(`Escrita corrigida automaticamente em ${textRepairs} campo${textRepairs === 1 ? '' : 's'}.`);
    }
  }

  async function loadCharacter(slug) {
    setSaveStatus('Carregando…', 'saving');
    try {
      if (state.dirty) await saveNow();
      const snapshot = await DB.getSnapshot(slug);
      applySnapshot(snapshot);
    } catch (error) {
      console.error(error);
      notify(`Não foi possível carregar: ${error.message}`, 'error');
      setSaveStatus('Erro de conexão', 'error');
    }
  }

  function valueFromInput(input) {
    if (input.type === 'checkbox') return input.checked;
    if (input.type === 'number') return input.value === '' ? 0 : Number(input.value);
    return input.value;
  }

  function openCheckDialog(label, modifier, formula, source = '', defaultAdvantage = 0) {
    const automaticAdvantage = Math.max(-2, Math.min(2, num(defaultAdvantage)));
    pendingTest = { label, modifier: Math.trunc(num(modifier)), formula, source, automaticAdvantage };
    testDialogTitle.textContent = label;
    testDialogFormula.textContent = `${formula}${automaticAdvantage ? ` · Transformação aplica ${automaticAdvantage > 0 ? 'vantagem' : 'desvantagem'} automaticamente.` : ''}`;
    const preferred = testDialog.querySelector(`input[name="testAdvantage"][value="${automaticAdvantage}"]`);
    const normal = testDialog.querySelector('input[name="testAdvantage"][value="0"]');
    if (preferred) preferred.checked = true;
    else if (normal) normal.checked = true;
    testResult.classList.add('hidden');
    testResult.innerHTML = '';
    if (!testDialog.open) testDialog.showModal();
  }

  function performPendingTest() {
    if (!pendingTest) return;
    const selected = testDialog.querySelector('input[name="testAdvantage"]:checked');
    const advantage = Math.max(-2, Math.min(2, num(selected?.value)));
    const roll = RPG.rollD20Check(pendingTest.modifier, advantage);
    const sign = pendingTest.modifier >= 0 ? '+' : '−';
    testResult.innerHTML = `
      <span class="test-result-label">${esc(pendingTest.label)}</span>
      <strong>${roll.result}</strong>
      <div class="test-result-breakdown">
        <span>Dados: ${roll.rolls.map(value => value === roll.chosen ? `<b>${value}</b>` : value).join(' · ')}</span>
        <span>Escolhido: ${roll.chosen}</span>
        <span>Modificador: ${sign}${Math.abs(pendingTest.modifier)}</span>
      </div>`;
    testResult.classList.remove('hidden');
    state.combat.rollHistory ||= [];
    state.combat.rollHistory.unshift({
      ...roll,
      label: pendingTest.label,
      source: pendingTest.source,
      expression: `${pendingTest.label}: ${roll.expression}`,
      at: new Date().toISOString()
    });
    state.combat.rollHistory = state.combat.rollHistory.slice(0, 30);
    markDirty();
    notify(`${pendingTest.label}: ${roll.result}`);
  }

  function spendResource(key, amount) {
    const resource = state.data.resources[key];
    const capacity = RPG.resourceCapacity(state.data, state.rules, key);
    resource.lost = Math.max(0, Math.min(capacity, num(resource.lost) + Math.max(0, num(amount))));
  }

  function healResource(key, amount) {
    const resource = state.data.resources[key];
    resource.lost = Math.max(0, num(resource.lost) - Math.max(0, num(amount)));
  }

  function changeTrueDamage(amount) {
    const resource = state.data.resources.ps;
    const permanentMax = RPG.resourceFormulaBase(state.data, state.rules, 'ps');
    resource.trueDamage = Math.max(0, Math.min(permanentMax, num(resource.trueDamage) + num(amount)));
    resource.lost = Math.min(num(resource.lost), RPG.resourceCapacity(state.data, state.rules, 'ps'));
  }

  function spendPv(pool, amount) {
    const resource = state.data.resources.pv;
    const poolMax = RPG.pvPoolMax(state.data, state.rules, pool);
    const key = pool === 'reaction' ? 'reactionLost' : 'attackLost';
    resource[key] = Math.max(0, Math.min(poolMax, num(resource[key]) + Math.max(0, num(amount))));
  }

  function healPv(pool, amount) {
    const resource = state.data.resources.pv;
    const key = pool === 'reaction' ? 'reactionLost' : 'attackLost';
    resource[key] = Math.max(0, num(resource[key]) - Math.max(0, num(amount)));
  }

  function spendAbility(ability, chaosAlternative = false) {
    ensureCombatExtensions();
    const cost = ability.cost || {};
    const chaosCost = chaosAlternative ? num(cost.chaosAlternative) : num(cost.chaos);
    if (chaosCost > num(state.combat.chaosPoints)) {
      notify('Pontos de Caos insuficientes.', 'error');
      return false;
    }

    let waiveReactionPv = false;
    if (!chaosAlternative) {
      const effectiveCost = RPG.effectiveAbilityCost(cost, state.data);
      const pfCost = Math.max(0, num(effectiveCost.pf));
      const pvCost = RPG.abilityPvCosts(effectiveCost);
      waiveReactionPv = ability.id !== 'parry' && pvCost.reaction > 0 && num(state.combat.freeReactionActions) > 0;
      if (pfCost > currentResource('pf')) {
        notify('P.F insuficiente para usar esta habilidade.', 'error');
        return false;
      }
      if (pvCost.attack > RPG.pvPoolCurrent(state.data, state.rules, 'attack')) {
        notify('P.V de Ataque insuficiente para usar esta habilidade.', 'error');
        return false;
      }
      if (!waiveReactionPv && pvCost.reaction > RPG.pvPoolCurrent(state.data, state.rules, 'reaction')) {
        notify('P.V de Reação insuficiente para usar esta habilidade.', 'error');
        return false;
      }
    }

    if (chaosCost) state.combat.chaosPoints -= chaosCost;
    if (!chaosAlternative) {
      const effectiveCost = RPG.effectiveAbilityCost(cost, state.data);
      if (num(effectiveCost.pf)) spendResource('pf', effectiveCost.pf);
      const pvCost = RPG.abilityPvCosts(effectiveCost);
      if (pvCost.attack) spendPv('attack', pvCost.attack);
      if (pvCost.reaction) {
        if (waiveReactionPv) {
          state.combat.freeReactionActions = Math.max(0, num(state.combat.freeReactionActions) - 1);
          notify(`Ação de Reação grátis consumida: ${pvCost.reaction} P.V de Reação não foram gastos.`);
        } else spendPv('reaction', pvCost.reaction);
      }
    }
    state.combat.cooldowns[ability.id] = num(ability.cooldown);
    state.combat.uses[ability.id] = usesFor(ability.id) + 1;
    return true;
  }

  function completePendingTransformation() {
    const id = state.combat.pendingTransformation;
    const profile = CHAOS_TRANSFORMATION_PROFILES[id];
    const t = (state.data.transformations || []).find(item => item.id === id);
    if (!profile || !t) { state.combat.pendingTransformation = null; return; }
    let turns = 1;
    try { turns = RPG.rollDiceExpression(t.duration || '1').result; } catch {}
    state.combat.pendingTransformation = null;
    state.combat.transformationActivationTurns = 0;
    state.combat.activeTransformation = id;
    state.combat.transformationTurns = turns;
    const tempPs = Math.max(0, num(profile.tempPs));
    if (tempPs) state.data.resources.ps.temporary = num(state.data.resources.ps.temporary) + tempPs;
    state.combat.transformationTempPs = tempPs;
    if (profile.startingChaosMinimum) state.combat.chaosPoints = Math.max(num(state.combat.chaosPoints), num(profile.startingChaosMinimum));
    notify(`${profile.name} concluída. Duração: ${turns} turno${turns === 1 ? '' : 's'}.`);
  }

  function tickCombat() {
    Object.keys(state.combat.cooldowns || {}).forEach(id => {
      state.combat.cooldowns[id] = Math.max(0, num(state.combat.cooldowns[id]) - 1);
    });
    if (state.combat.pendingTransformation) {
      state.combat.transformationActivationTurns = Math.max(0, num(state.combat.transformationActivationTurns) - 1);
      if (state.combat.transformationActivationTurns <= 0) completePendingTransformation();
    } else if (state.combat.transformationTurns > 0) {
      state.combat.transformationTurns -= 1;
      if (state.combat.transformationTurns <= 0) endTransformationState();
    }
    tickEssenceEffects();
  }

  function endTransformationState() {
    const temp = num(state.combat.transformationTempPs);
    if (temp > 0) state.data.resources.ps.temporary = Math.max(0, num(state.data.resources.ps.temporary) - temp);
    state.combat.activeTransformation = null;
    state.combat.pendingTransformation = null;
    state.combat.transformationActivationTurns = 0;
    state.combat.transformationTurns = 0;
    state.combat.transformationTempPs = 0;
  }

  function makeBlankCharacter(name) {
    const data = RPG.clone(state.data);
    data.identity = Object.fromEntries(Object.keys(data.identity || {}).map(key => [key, '']));
    data.identity.name = name;
    ['age','weight','height','classPoints','professionPoints','focusDice','bloodDice'].forEach(key => data.identity[key] = 0);
    Object.values(data.attributes || {}).forEach(attr => attr.parts = [{ label: 'Base', value: 0, enabled: true }]);
    Object.entries(data.resources || {}).forEach(([key, r]) => {
      r.lost = 0;
      r.temporary = 0;
      r.maxBonus = 0;
      if (key === 'ps') r.trueDamage = 0;
      if (key === 'pv') { r.attackLost = 0; r.reactionLost = 0; }
    });
    (data.skills || []).forEach(skill => { skill.level = 0; skill.points = 0; skill.proficient = false; });
    data.derived = {
      armorClass: { value: 10, parts: [
        { label: 'Padrão', value: 10 }, { label: 'Extras', value: 0 }, { label: 'Escudo', value: 0 },
        { label: 'Destreza', value: 0 }, { label: 'Armadura', value: 0 }
      ]},
      perception: 0, luck: 0, movement: 0, initiative: 0, criticalMargin: num(state.rules.criticalMargin || 20)
    };
    data.inventory = [];
    data.importantItems = [];
    data.abilities = [];
    data.postures = [];
    data.transformations = [];
    data.library = [];
    data.karma = { positive: 0, negative: 0, die: 'd8', note: '' };
    Object.keys(data.essence?.levels || {}).forEach(key => data.essence.levels[key] = 0);
    RPG.applySheetFormulas(data, state.rules);
    return data;
  }

  function freshCombat() {
    return { active:false, round:1, turn:1, chaosPoints:0, activePosture:null, activeTransformation:null, pendingTransformation:null, transformationActivationTurns:0, transformationTurns:0, transformationTempPs:0, freeReactionActions:0, abilityResults:{}, damageHistory:[], pendingDamageReductions:[], essenceEffects:{}, cooldowns:{}, uses:{}, conditions:[], notes:'', rollHistory:[] };
  }

  function openAttribute(abbr) {
    state.editingAttribute = abbr;
    const attr = state.data.attributes[abbr];
    document.getElementById('attributeDialogTitle').textContent = `${attr.name} · ${RPG.attributeTotal(attr)}`;
    const parts = document.getElementById('attributeParts');
    parts.innerHTML = (attr.parts || []).map((part, index) => `<div class="modifier-row">
      <input data-modifier-index="${index}" data-modifier-field="label" value="${esc(part.label)}" aria-label="Nome do modificador">
      <input type="number" data-modifier-index="${index}" data-modifier-field="value" value="${num(part.value)}" aria-label="Valor">
      <label class="toggle-mini"><input type="checkbox" data-modifier-index="${index}" data-modifier-field="enabled" ${part.enabled !== false ? 'checked' : ''}> ativo</label>
      <button type="button" class="icon-btn danger-text" data-action="remove-modifier" data-index="${index}">×</button>
    </div>`).join('');
    if (!attributeDialog.open) attributeDialog.showModal();
  }

  function fillSettingsDialog() {
    settingsDialog.querySelectorAll('[data-rule]').forEach(input => {
      const value = RPG.getPath(state.rules, input.dataset.rule);
      if (input.type === 'checkbox') input.checked = value !== false;
      else input.value = value ?? '';
    });
    settingsDialog.showModal();
  }

  async function saveRulesNow() {
    setSaveStatus('Salvando regras…', 'saving');
    try {
      await DB.saveRules(state.rules);
      state.system.rules = RPG.clone(state.rules);
      setSaveStatus(state.mode === 'remote' ? 'Regras salvas' : 'Regras salvas localmente', 'saved');
      render();
    } catch (error) {
      notify(`Erro nas regras: ${error.message}`, 'error');
      setSaveStatus('Falha ao salvar regras', 'error');
    }
  }

  function downloadJson() {
    const payload = { exportedAt: new Date().toISOString(), schemaVersion: 2, system: state.system, character: { slug: state.character.slug, name: state.character.name, data: state.data, combat: state.combat } };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${state.character.slug}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  document.getElementById('tabs').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-tab]');
    if (!button) return;
    state.activeTab = button.dataset.tab;
    render();
  });

  characterSelect.addEventListener('change', () => loadCharacter(characterSelect.value));

  document.getElementById('newCharacterBtn').addEventListener('click', () => {
    document.getElementById('newCharacterName').value = '';
    document.getElementById('newCharacterSlug').value = '';
    document.getElementById('duplicateCurrent').checked = false;
    newCharacterDialog.showModal();
  });

  document.getElementById('settingsBtn').addEventListener('click', fillSettingsDialog);
  document.getElementById('shareBtn').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); notify('Link da ficha copiado.'); }
    catch { notify('Não foi possível copiar automaticamente.', 'error'); }
  });
  document.getElementById('exportJsonBtn').addEventListener('click', downloadJson);
  document.getElementById('rollTestBtn').addEventListener('click', performPendingTest);
  testDialog.addEventListener('close', () => { pendingTest = null; });
  incomingDamage.addEventListener('input', updateDamagePreview);
  damageType.addEventListener('change', renderDamageProtections);
  damageOrder.addEventListener('change', updateDamagePreview);
  manualResistance.addEventListener('change', updateDamagePreview);
  manualReduction.addEventListener('input', updateDamagePreview);
  damageProtections.addEventListener('change', updateDamagePreview);
  applyDamageBtn.addEventListener('click', applyIncomingDamage);
  damageDialog.addEventListener('close', () => { pendingDamageContext = null; });

  document.getElementById('createCharacterBtn').addEventListener('click', async () => {
    const name = document.getElementById('newCharacterName').value.trim();
    if (!name) return notify('Informe o nome do personagem.', 'error');
    const slug = RPG.slugify(document.getElementById('newCharacterSlug').value.trim() || name);
    const duplicate = document.getElementById('duplicateCurrent').checked;
    const data = duplicate ? RPG.clone(state.data) : makeBlankCharacter(name);
    data.identity.name = name;
    const combat = freshCombat();
    try {
      await DB.createCharacter(slug, name, data, combat);
      newCharacterDialog.close();
      await loadCharacter(slug);
      notify('Nova ficha criada.');
    } catch (error) { notify(error.message, 'error'); }
  });

  document.getElementById('addModifierBtn').addEventListener('click', () => {
    const attr = state.data.attributes[state.editingAttribute];
    attr.parts.push({ label: 'Novo modificador', value: 0, enabled: true });
    markDirty();
    openAttribute(state.editingAttribute);
  });

  document.getElementById('attributeParts').addEventListener('input', (event) => {
    const input = event.target.closest('[data-modifier-index]');
    if (!input) return;
    const part = state.data.attributes[state.editingAttribute].parts[Number(input.dataset.modifierIndex)];
    part[input.dataset.modifierField] = valueFromInput(input);
    document.getElementById('attributeDialogTitle').textContent = `${state.data.attributes[state.editingAttribute].name} · ${RPG.attributeTotal(state.data.attributes[state.editingAttribute])}`;
    markDirty();
  });
  document.getElementById('attributeParts').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action="remove-modifier"]');
    if (!btn) return;
    state.data.attributes[state.editingAttribute].parts.splice(Number(btn.dataset.index), 1);
    markDirty();
    openAttribute(state.editingAttribute);
  });
  attributeDialog.addEventListener('close', () => { RPG.applySheetFormulas(state.data, state.rules); render(); });

  settingsDialog.addEventListener('input', (event) => {
    const input = event.target.closest('[data-rule]');
    if (!input) return;
    RPG.setPath(state.rules, input.dataset.rule, valueFromInput(input));
    clearTimeout(settingsDialog.saveTimer);
    settingsDialog.saveTimer = setTimeout(saveRulesNow, 500);
  });

  appEl.addEventListener('input', (event) => {
    const input = event.target;
    if (input.dataset.path) {
      RPG.setPath(state.data, input.dataset.path, valueFromInput(input));
      markDirty();
      if (input.dataset.path === 'identity.name') renderCharacterSelect();
      return;
    }
    if (input.dataset.skillIndex !== undefined) {
      const skill = state.data.skills[Number(input.dataset.skillIndex)];
      skill[input.dataset.skillField] = valueFromInput(input);
      markDirty();
      return;
    }
    if (input.dataset.armorIndex !== undefined) {
      state.data.derived.armorClass.parts[Number(input.dataset.armorIndex)].value = valueFromInput(input);
      markDirty();
      return;
    }
    if (input.dataset.itemIndex !== undefined) {
      state.data.inventory[Number(input.dataset.itemIndex)][input.dataset.itemField] = valueFromInput(input);
      markDirty();
      return;
    }
    if (input.dataset.essenceKey) {
      state.data.essence.levels[input.dataset.essenceKey] = Math.max(0, Math.min(10, valueFromInput(input)));
      markDirty();
      renderEssence();
      return;
    }
    if (input.dataset.combatPath) {
      RPG.setPath(state.combat, input.dataset.combatPath, valueFromInput(input));
      markDirty(); renderCombat();
      return;
    }
    if (input.id === 'abilitySearch') {
      const q = input.value.toLowerCase();
      document.querySelectorAll('.searchable').forEach(card => card.classList.toggle('filtered-out', q && !card.dataset.search.includes(q)));
    }
  });

  appEl.addEventListener('change', (event) => {
    const input = event.target;
    if (input.type === 'checkbox' && input.dataset.skillIndex !== undefined) {
      const skill = state.data.skills[Number(input.dataset.skillIndex)];
      skill[input.dataset.skillField] = input.checked;
      markDirty(); renderSheet();
    }
    if (input.dataset.combatPath) {
      RPG.setPath(state.combat, input.dataset.combatPath, input.value || null);
      markDirty(); renderCombat();
      return;
    }

    if (input.dataset.path && (
      input.dataset.path === 'identity.focusDice' ||
      input.dataset.path === 'identity.bloodDice' ||
      input.dataset.path.startsWith('resources.')
    )) {
      RPG.applySheetFormulas(state.data, state.rules);
      renderSheet();
    }
  });

  appEl.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'edit-attribute') return openAttribute(btn.dataset.attribute);
    if (action === 'roll-attribute') {
      const abbr = btn.dataset.attribute;
      const attr = state.data.attributes?.[abbr];
      if (!attr) return;
      const modifier = RPG.eighth(state.data, state.rules, abbr);
      const source = `attribute:${abbr}`;
      openCheckDialog(`${attr.name} (${abbr})`, modifier, `1d20 + ⅛ do atributo = 1d20 + ${modifier}`, source, transformationTestAdvantage(source));
      return;
    }
    if (action === 'roll-skill') {
      const index = Number(btn.dataset.skillIndex);
      const skill = state.data.skills?.[index];
      if (!skill) return;
      const baseModifier = RPG.skillTotal(skill, state.data, state.rules);
      const transformationBonus = transformationSkillBonus(skill.name);
      const modifier = baseModifier + transformationBonus;
      const source = `skill:${index}`;
      openCheckDialog(
        skill.name,
        modifier,
        `1d20 + valor final da perícia = 1d20 + ${baseModifier}${transformationBonus ? ` + ${transformationBonus} (${activeTransformationProfile()?.name})` : ''}`,
        source,
        transformationTestAdvantage(source)
      );
      return;
    }
    if (action === 'take-damage') { openDamageDialog({ source: 'Dano recebido' }); return; }
    if (action === 'roll-ability-damage') {
      const ability = state.data.abilities.find(a => a.id === btn.dataset.ability);
      if (ability) rollAbilityDamage(ability);
      return;
    }
    if (action === 'roll-ability-special') {
      const ability = state.data.abilities.find(a => a.id === btn.dataset.ability);
      if (ability) rollAbilitySpecial(ability, btn.dataset.special);
      return;
    }
    if (action === 'resource-change') { spendResource(btn.dataset.resource, btn.dataset.delta); markDirty(); return renderCombat(); }
    if (action === 'resource-heal') { healResource(btn.dataset.resource, btn.dataset.delta); markDirty(); return renderCombat(); }
    if (action === 'true-damage-change') { changeTrueDamage(btn.dataset.delta); markDirty(); return renderCombat(); }
    if (action === 'pv-spend') { spendPv(btn.dataset.pool, btn.dataset.delta); markDirty(); return renderCombat(); }
    if (action === 'pv-heal') { healPv(btn.dataset.pool, btn.dataset.delta); markDirty(); return renderCombat(); }
    if (action === 'chaos-change') { state.combat.chaosPoints = Math.max(0, num(state.combat.chaosPoints) + num(btn.dataset.delta)); markDirty(); return renderCombat(); }
    if (action === 'transformation-hit-chaos') {
      const amount = Math.max(1, num(activeTransformationProfile()?.chaosOnAbilityHit));
      state.combat.chaosPoints = Math.max(0, num(state.combat.chaosPoints) + amount);
      markDirty(); renderCombat(); notify(`Acerto confirmado: +${amount} Ponto de Caos.`); return;
    }
    if (action === 'karma-change') { const key = btn.dataset.kind; state.data.karma[key] = Math.max(0, num(state.data.karma[key]) + num(btn.dataset.delta)); markDirty(); return renderKarma(); }

    if (action === 'start-combat') {
      if (state.combat.activeTransformation || state.combat.pendingTransformation) endTransformationState();
      state.combat = { ...freshCombat(), active: true, rollHistory: state.combat.rollHistory || [] };
      markDirty(); renderCombat(); return;
    }
    if (action === 'end-combat') {
      if (!confirm('Encerrar o combate? Recargas, condições, transformações e efeitos ativos serão limpos. Todos os P.V serão restaurados; P.S e P.F gastos permanecem.')) return;
      if (state.combat.activeTransformation || state.combat.pendingTransformation) endTransformationState();
      restoreAllPv(false);
      const history = state.combat.rollHistory || [];
      state.combat = { ...freshCombat(), active: false, rollHistory: history };
      markDirty(); renderCombat(); notify('Combate encerrado. Todos os P.V foram restaurados.'); return;
    }
    if (action === 'next-turn') { state.combat.freeReactionActions = 0; state.combat.turn = num(state.combat.turn) + 1; tickCombat(); markDirty(); renderCombat(); return; }
    if (action === 'next-round') {
      restoreAllPv(false);
      state.combat.freeReactionActions = 0;
      state.combat.round = num(state.combat.round) + 1;
      state.combat.turn = 1;
      tickCombat();
      markDirty();
      renderCombat();
      notify('Nova rodada: todos os P.V foram restaurados.');
      return;
    }

    if (action === 'activate-essence-effect') {
      if (activateEssenceEffect(btn.dataset.effect)) { markDirty(); render(); }
      return;
    }
    if (action === 'end-essence-effect') {
      const def = essenceDefinition(btn.dataset.effect);
      endEssenceEffect(btn.dataset.effect, `${def?.name || 'Efeito'} encerrada.`);
      markDirty(); render(); return;
    }
    if (action === 'reset-essence-daily') {
      ensureEssenceCombatState();
      state.data.essence.dailyUses[btn.dataset.effect] = 0;
      markDirty(); renderEssence(); notify('Uso diário restaurado.');
      return;
    }

    if (action === 'use-ability' || action === 'use-ability-chaos') {
      const ability = state.data.abilities.find(a => a.id === btn.dataset.ability);
      if (!ability) return;
      if (spendAbility(ability, action === 'use-ability-chaos')) {
        if (ability.id === 'parry') rollParryOutcome(ability);
        markDirty();
        renderCombat();
        if (ability.id !== 'parry') notify(`${ability.name} usada.`);
      }
      return;
    }
    if (action === 'clear-cooldown') { state.combat.cooldowns[btn.dataset.ability] = 0; markDirty(); renderCombat(); return; }

    if (action === 'activate-transformation') {
      const t = state.data.transformations.find(item => item.id === btn.dataset.transformation);
      const profile = CHAOS_TRANSFORMATION_PROFILES[t?.id];
      if (!t || !profile) return;
      if (!state.combat.active) { notify('Inicie o combate antes de ativar uma transformação.', 'error'); return; }
      if (state.combat.activeTransformation || state.combat.pendingTransformation) { notify('Já existe uma transformação ativa ou em ativação.', 'error'); return; }
      if (profile.activation.consumeAttack) spendPv('attack', RPG.pvPoolCurrent(state.data, state.rules, 'attack'));
      if (profile.activation.consumeReaction) spendPv('reaction', RPG.pvPoolCurrent(state.data, state.rules, 'reaction'));
      state.combat.pendingTransformation = t.id;
      state.combat.transformationActivationTurns = 1;
      notify(`${profile.name}: ativação iniciada. ${profile.activation.text}`);
      markDirty(); renderCombat(); return;
    }
    if (action === 'end-transformation') { endTransformationState(); markDirty(); renderCombat(); return; }

    if (action === 'add-condition') {
      const name = prompt('Nome da condição, buff ou debuff:');
      if (name?.trim()) { state.combat.conditions.push(name.trim()); markDirty(); renderCombat(); }
      return;
    }
    if (action === 'remove-condition') { state.combat.conditions.splice(Number(btn.dataset.index), 1); markDirty(); renderCombat(); return; }

    if (action === 'roll-dice' || action === 'quick-die') {
      const input = document.getElementById('diceExpression');
      const expr = action === 'quick-die' ? btn.dataset.die : input?.value;
      try {
        const roll = RPG.rollDiceExpression(expr);
        state.combat.rollHistory.unshift({ ...roll, at: new Date().toISOString() });
        state.combat.rollHistory = state.combat.rollHistory.slice(0, 30);
        markDirty(); renderCombat(); notify(`${roll.expression} = ${roll.result}`);
      } catch (error) { notify(error.message, 'error'); }
      return;
    }

    if (action === 'add-item') {
      state.data.inventory.push({ id: crypto.randomUUID?.() || String(Date.now()), name: 'Novo item', quantity: 1, space: 0, notes: '' });
      markDirty(); renderInventory(); return;
    }
    if (action === 'remove-item') { state.data.inventory.splice(Number(btn.dataset.index), 1); markDirty(); renderInventory(); return; }
  });

  window.addEventListener('beforeunload', () => { if (state.dirty) saveNow(); });

  (async function init() {
    try {
      const snapshot = await DB.getSnapshot();
      applySnapshot(snapshot);
    } catch (error) {
      console.error(error);
      appEl.innerHTML = `<div class="error-card"><h2>Não foi possível abrir a ficha</h2><p>${esc(error.message)}</p><p>Se estiver usando o banco, confira a URL do Supabase, a chave pública e a chave de acesso presente no link.</p></div>`;
      setSaveStatus('Erro', 'error');
    }
  })();
})();
