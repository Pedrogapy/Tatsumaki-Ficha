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

  function resourceCurrent(resource) {
    const max = Number(resource?.max) || 0;
    const temporary = Number(resource?.temporary) || 0;
    const lost = Number(resource?.lost) || 0;
    return Math.max(0, max + temporary - lost);
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
      pf: 'P.F', pv: 'P.V', pvAttack: 'P.V Ataque', pvReaction: 'P.V Reação',
      pvDefense: 'P.V Defesa', chaos: 'Caos', chaosAlternative: 'Caos (alternativo)'
    };
    return Object.entries(cost)
      .filter(([, value]) => Number(value) > 0)
      .map(([key, value]) => `${value} ${labels[key] || key}`)
      .join(' • ') || 'Sem custo registrado';
  }

  window.RPG = {
    clone, getPath, setPath, attributeTotal, fraction, quarter, eighth,
    skillTotal, resourceCurrent, armorClass, slugify, rollDiceExpression, formatCost
  };
})();
