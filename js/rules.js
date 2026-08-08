(function () {
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function getPath(object, path, fallback = undefined) {
    const result = path.split('.').reduce((acc, key) => acc?.[key], object);
    return result === undefined ? fallback : result;
  }

  function setPath(object, path, value) {
    const parts = path.split('.');
    let cursor = object;
    parts.slice(0, -1).forEach((key) => {
      if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
      cursor = cursor[key];
    });
    cursor[parts.at(-1)] = value;
  }

  function number(value) {
    return Number(value) || 0;
  }

  function attributeTotal(attribute) {
    return (attribute?.parts || []).reduce((sum, part) => {
      if (part.enabled === false) return sum;
      return sum + number(part.value);
    }, 0);
  }

  function fraction(value, divisor) {
    const safeDivisor = Math.max(1, number(divisor) || 1);
    return Math.floor(number(value) / safeDivisor);
  }

  function quarter(data, rules, abbr) {
    return fraction(attributeTotal(data.attributes?.[abbr]), rules?.attributeQuarterDivisor || 4);
  }

  function eighth(data, rules, abbr) {
    return fraction(attributeTotal(data.attributes?.[abbr]), rules?.attributeEighthDivisor || 8);
  }

  // Formula original da planilha:
  // Total = 1/8 do atributo + Nivel + (1/8 novamente quando Pro. = verdadeiro).
  // A coluna "Pontos" existe na ficha, mas nao entra na formula original do Total.
  function skillTotal(skill, data, rules) {
    const config = rules?.skill || {};
    const base = eighth(data, rules, skill.attribute);
    let total = base;
    if (config.includeLevel !== false) total += number(skill.level);
    if (skill.proficient && config.proficiencyAddsSameFraction !== false) total += base;
    if (config.includePoints === true) total += number(skill.points);
    return total;
  }

  function resourceFormulaBase(data, rules, key) {
    const bonus = Math.max(0, number(data.resources?.[key]?.maxBonus));

    if (key === 'ps') {
      // Excel Y7:
      // (10 + 1/4 FORT + 1/8 FORT + Dados de Sangue) + Temporario - Perdidos + 10
      return Math.max(
        0,
        20
        + quarter(data, rules, 'FORT')
        + eighth(data, rules, 'FORT')
        + number(data.identity?.bloodDice)
        + bonus
      );
    }

    if (key === 'pf') {
      // Excel Y17:
      // 10 + Dados de Foco + MAX(1/8 SAB,1/8 INT) + MAX(1/4 SAB,1/4 INT) - Perdidos
      // A pedido do usuario, P.F Temporario tambem e somado depois ao valor disponivel.
      return Math.max(
        0,
        10
        + number(data.identity?.focusDice)
        + Math.max(eighth(data, rules, 'SAB'), eighth(data, rules, 'INT'))
        + Math.max(quarter(data, rules, 'SAB'), quarter(data, rules, 'INT'))
        + bonus
      );
    }

    if (key === 'pv') {
      // Excel Y12:
      // INT(MAX(1/8 FOR,1/8 DES)) + 1 + 1
      return Math.max(
        0,
        Math.floor(Math.max(eighth(data, rules, 'FOR'), eighth(data, rules, 'DES')))
        + 2
        + bonus
      );
    }

    return Math.max(0, number(data.resources?.[key]?.max) + bonus);
  }

  function resourceTrueDamage(data, key = '') {
    return key === 'ps' ? Math.max(0, number(data.resources?.ps?.trueDamage)) : 0;
  }

  function resourceCoreMax(data, rules, key = '') {
    return Math.max(0, resourceFormulaBase(data, rules, key) - resourceTrueDamage(data, key));
  }

  function resourceCapacity(data, rules, key = '') {
    const temporary = key === 'pv' ? 0 : Math.max(0, number(data.resources?.[key]?.temporary));
    return Math.max(0, resourceCoreMax(data, rules, key) + temporary);
  }

  function resourceCurrent(data, rules, key = '') {
    const lost = Math.max(0, number(data.resources?.[key]?.lost));
    return Math.max(0, resourceCapacity(data, rules, key) - lost);
  }

  function splitPv(total) {
    const safeTotal = Math.max(0, Math.floor(number(total)));
    return {
      attack: Math.floor(safeTotal / 2),
      reaction: Math.ceil(safeTotal / 2)
    };
  }

  function pvTotalMax(data, rules) {
    return Math.max(0, Math.floor(resourceFormulaBase(data, rules, 'pv')));
  }

  function pvPoolMax(data, rules, pool) {
    const split = splitPv(pvTotalMax(data, rules));
    return pool === 'reaction' ? split.reaction : split.attack;
  }

  function pvPoolCurrent(data, rules, pool) {
    const resource = data.resources?.pv || {};
    const max = pvPoolMax(data, rules, pool);
    const lostKey = pool === 'reaction' ? 'reactionLost' : 'attackLost';
    return Math.max(0, max - Math.max(0, number(resource[lostKey])));
  }

  function abilityPvCosts(cost = {}) {
    return {
      attack: Math.max(0, number(cost.pvAttack)) + Math.max(0, number(cost.pv)),
      reaction: Math.max(0, number(cost.pvReaction)) + Math.max(0, number(cost.pvDefense))
    };
  }

  function perception(data) {
    // Excel Z26 = 8 + INT(Destreza / 2)
    return 8 + Math.floor(attributeTotal(data.attributes?.DES) / 2);
  }

  function luck(data, rules) {
    // Excel AD26 = INT(1/4 da Destreza)
    return quarter(data, rules, 'DES');
  }

  function armorClass(data, rules) {
    // Excel Q24 = SOMA(Extras, Padrao, Escudo, Destreza, Armadura)
    // A parcela Destreza e sempre 1/4 de DES.
    const parts = data.derived?.armorClass?.parts;
    if (!Array.isArray(parts)) {
      return 10 + quarter(data, rules, 'DES');
    }
    return parts.reduce((sum, part) => {
      const label = String(part?.label || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (label === 'destreza') return sum + quarter(data, rules, 'DES');
      return sum + number(part?.value);
    }, 0);
  }

  function applySheetFormulas(data, rules) {
    if (!data || typeof data !== 'object') return data;
    data.derived ||= {};
    data.derived.perception = perception(data);
    data.derived.luck = luck(data, rules);
    data.derived.armorClass ||= {};
    data.derived.armorClass.value = armorClass(data, rules);

    const armorParts = data.derived.armorClass.parts;
    if (Array.isArray(armorParts)) {
      const dexPart = armorParts.find(part => String(part?.label || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === 'destreza');
      if (dexPart) dexPart.value = quarter(data, rules, 'DES');
    }

    data.resources ||= {};
    ['ps', 'pf', 'pv'].forEach(key => {
      data.resources[key] ||= { label: key.toUpperCase() };
      data.resources[key].formulaBase = resourceFormulaBase(data, rules, key);
    });
    data.resources.pv.formulaAttack = pvPoolMax(data, rules, 'attack');
    data.resources.pv.formulaReaction = pvPoolMax(data, rules, 'reaction');
    return data;
  }

  function normalizeCharacterData(data) {
    let changed = false;
    data.resources ||= {};

    const ps = data.resources.ps ||= { label: 'P.S', lost: 0, temporary: 0 };
    if (!Object.prototype.hasOwnProperty.call(ps, 'trueDamage')) { ps.trueDamage = 0; changed = true; }
    if (!Object.prototype.hasOwnProperty.call(ps, 'maxBonus')) { ps.maxBonus = 0; changed = true; }

    const pf = data.resources.pf ||= { label: 'P.F', lost: 0, temporary: 0 };
    if (!Object.prototype.hasOwnProperty.call(pf, 'temporary')) { pf.temporary = 0; changed = true; }
    if (!Object.prototype.hasOwnProperty.call(pf, 'maxBonus')) { pf.maxBonus = 0; changed = true; }

    const pv = data.resources.pv ||= { label: 'P.V' };
    if (!Object.prototype.hasOwnProperty.call(pv, 'maxBonus')) { pv.maxBonus = 0; changed = true; }
    if (!Object.prototype.hasOwnProperty.call(pv, 'attackLost')) {
      pv.attackLost = Math.max(0, number(pv.lost));
      changed = true;
    }
    if (!Object.prototype.hasOwnProperty.call(pv, 'reactionLost')) { pv.reactionLost = 0; changed = true; }
    if (number(pv.lost) !== 0) { pv.lost = 0; changed = true; }

    (data.abilities || []).forEach((ability) => {
      if (!ability?.cost || typeof ability.cost !== 'object') return;
      const cost = ability.cost;
      if (number(cost.pv) > 0) {
        cost.pvAttack = number(cost.pvAttack) + number(cost.pv);
        delete cost.pv;
        changed = true;
      }
      if (number(cost.pvDefense) > 0) {
        cost.pvReaction = number(cost.pvReaction) + number(cost.pvDefense);
        delete cost.pvDefense;
        changed = true;
      }
    });

    if ((number(data.schemaVersion) || 1) < 3) {
      data.schemaVersion = 3;
      changed = true;
    }
    return changed;
  }

  function slugify(text) {
    return String(text || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || `personagem-${Date.now()}`;
  }

  function rollDiceExpression(expression) {
    const original = String(expression || '').trim();
    if (!original) throw new Error('Digite uma expressão, por exemplo 3d8+14.');
    let work = original.toLowerCase().replace(/\s+/g, '');
    if (!/^[0-9d+\-*/().]+$/.test(work)) throw new Error('A expressão contém caracteres não permitidos.');

    const details = [];
    work = work.replace(/(\d*)d(\d+)/g, (_, countText, sidesText) => {
      const count = Math.min(100, Math.max(1, number(countText || 1)));
      const sides = Math.min(100000, Math.max(2, number(sidesText)));
      const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
      details.push(`${count}d${sides}: [${rolls.join(', ')}]`);
      return `(${rolls.reduce((a, b) => a + b, 0)})`;
    });

    if (!/^[0-9+\-*/().]+$/.test(work)) throw new Error('Não foi possível interpretar a expressão.');
    const result = Function(`"use strict"; return (${work});`)();
    if (!Number.isFinite(result)) throw new Error('Resultado inválido.');
    return { expression: original, result, details };
  }

  function formatCost(cost = {}) {
    const labels = {
      pf: 'P.F', pv: 'P.V Ataque', pvAttack: 'P.V Ataque', pvReaction: 'P.V Reação',
      pvDefense: 'P.V Reação', chaos: 'Caos', chaosAlternative: 'Caos (alternativo)'
    };
    return Object.entries(cost)
      .filter(([, value]) => number(value) > 0)
      .map(([key, value]) => `${value} ${labels[key] || key}`)
      .join(' • ') || 'Sem custo registrado';
  }

  window.RPG = {
    clone, getPath, setPath, attributeTotal, fraction, quarter, eighth,
    skillTotal, resourceFormulaBase, resourceTrueDamage, resourceCoreMax,
    resourceCapacity, resourceCurrent, splitPv, pvTotalMax, pvPoolMax,
    pvPoolCurrent, abilityPvCosts, perception, luck, armorClass,
    applySheetFormulas, normalizeCharacterData,
    slugify, rollDiceExpression, formatCost
  };
})();
