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

  function attributeTotal(attribute) {
    return (attribute?.parts || []).reduce((sum, part) => {
      if (part.enabled === false) return sum;
      return sum + (Number(part.value) || 0);
    }, 0);
  }

  function fraction(value, divisor) {
    const safeDivisor = Math.max(1, Number(divisor) || 1);
    return Math.floor((Number(value) || 0) / safeDivisor);
  }

  function quarter(data, rules, abbr) {
    return fraction(attributeTotal(data.attributes?.[abbr]), rules.attributeQuarterDivisor || 4);
  }

  function eighth(data, rules, abbr) {
    return fraction(attributeTotal(data.attributes?.[abbr]), rules.attributeEighthDivisor || 8);
  }

  function skillTotal(skill, data, rules) {
    const config = rules.skill || {};
    const attribute = attributeTotal(data.attributes?.[skill.attribute]);
    const base = fraction(attribute, rules.attributeEighthDivisor || 8);
    let total = base;
    if (config.includeLevel !== false) total += Number(skill.level) || 0;
    if (config.includePoints !== false) total += Number(skill.points) || 0;
    if (skill.proficient && config.proficiencyAddsSameFraction !== false) total += base;
    return total;
  }

  function resourceTrueDamage(resource, key = '') {
    return key === 'ps' ? Math.max(0, Number(resource?.trueDamage) || 0) : 0;
  }

  function resourceCoreMax(resource, key = '') {
    const baseMax = Math.max(0, Number(resource?.max) || 0);
    return Math.max(0, baseMax - resourceTrueDamage(resource, key));
  }

  function resourceCapacity(resource, key = '') {
    const temporary = Math.max(0, Number(resource?.temporary) || 0);
    return resourceCoreMax(resource, key) + temporary;
  }

  function resourceCurrent(resource, key = '') {
    const lost = Math.max(0, Number(resource?.lost) || 0);
    return Math.max(0, resourceCapacity(resource, key) - lost);
  }

  function splitPv(total) {
    const safeTotal = Math.max(0, Math.floor(Number(total) || 0));
    return {
      attack: Math.floor(safeTotal / 2),
      reaction: Math.ceil(safeTotal / 2)
    };
  }

  function pvPoolCurrent(resource, pool) {
    const split = splitPv(resource?.max);
    const max = pool === 'reaction' ? split.reaction : split.attack;
    const lostKey = pool === 'reaction' ? 'reactionLost' : 'attackLost';
    return Math.max(0, max - Math.max(0, Number(resource?.[lostKey]) || 0));
  }

  function abilityPvCosts(cost = {}) {
    return {
      attack: Math.max(0, Number(cost.pvAttack) || 0) + Math.max(0, Number(cost.pv) || 0),
      reaction: Math.max(0, Number(cost.pvReaction) || 0) + Math.max(0, Number(cost.pvDefense) || 0)
    };
  }

  function normalizeCharacterData(data) {
    let changed = false;
    data.resources ||= {};

    const ps = data.resources.ps ||= { label: 'P.S', max: 0, lost: 0, temporary: 0 };
    if (!Object.prototype.hasOwnProperty.call(ps, 'trueDamage')) {
      ps.trueDamage = 0;
      changed = true;
    }

    const pf = data.resources.pf ||= { label: 'P.F', max: 0, lost: 0, temporary: 0 };
    if (!Object.prototype.hasOwnProperty.call(pf, 'temporary')) {
      pf.temporary = 0;
      changed = true;
    }

    const pv = data.resources.pv ||= { label: 'P.V', max: 0 };
    if (!Object.prototype.hasOwnProperty.call(pv, 'attackLost')) {
      pv.attackLost = Math.max(0, Number(pv.lost) || 0);
      changed = true;
    }
    if (!Object.prototype.hasOwnProperty.call(pv, 'reactionLost')) {
      pv.reactionLost = 0;
      changed = true;
    }
    if (Number(pv.lost) !== 0) {
      pv.lost = 0;
      changed = true;
    }

    (data.abilities || []).forEach((ability) => {
      if (!ability?.cost) return;
      const cost = ability.cost;
      if (Number(cost.pv) > 0) {
        cost.pvAttack = (Number(cost.pvAttack) || 0) + Number(cost.pv);
        delete cost.pv;
        changed = true;
      }
      if (Number(cost.pvDefense) > 0) {
        cost.pvReaction = (Number(cost.pvReaction) || 0) + Number(cost.pvDefense);
        delete cost.pvDefense;
        changed = true;
      }
    });

    if ((Number(data.schemaVersion) || 1) < 2) {
      data.schemaVersion = 2;
      changed = true;
    }
    return changed;
  }

  function armorClass(data) {
    const parts = data.derived?.armorClass?.parts;
    if (!Array.isArray(parts)) return Number(data.derived?.armorClass?.value) || 0;
    return parts.reduce((sum, part) => sum + (Number(part.value) || 0), 0);
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
      const count = Math.min(100, Math.max(1, Number(countText || 1)));
      const sides = Math.min(100000, Math.max(2, Number(sidesText)));
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
      .filter(([, value]) => Number(value) > 0)
      .map(([key, value]) => `${value} ${labels[key] || key}`)
      .join(' • ') || 'Sem custo registrado';
  }

  window.RPG = {
    clone, getPath, setPath, attributeTotal, fraction, quarter, eighth,
    skillTotal, resourceTrueDamage, resourceCoreMax, resourceCapacity, resourceCurrent,
    splitPv, pvPoolCurrent, abilityPvCosts, normalizeCharacterData,
    armorClass, slugify, rollDiceExpression, formatCost
  };
})();
