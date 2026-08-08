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

  const CP1252_REVERSE = new Map([
    [0x20AC,0x80],[0x201A,0x82],[0x0192,0x83],[0x201E,0x84],[0x2026,0x85],[0x2020,0x86],[0x2021,0x87],
    [0x02C6,0x88],[0x2030,0x89],[0x0160,0x8A],[0x2039,0x8B],[0x0152,0x8C],[0x017D,0x8E],[0x2018,0x91],
    [0x2019,0x92],[0x201C,0x93],[0x201D,0x94],[0x2022,0x95],[0x2013,0x96],[0x2014,0x97],[0x02DC,0x98],
    [0x2122,0x99],[0x0161,0x9A],[0x203A,0x9B],[0x0153,0x9C],[0x017E,0x9E],[0x0178,0x9F]
  ]);
  const MOJIBAKE_PATTERN = /(?:Ã[\u00A0-\u00BF]|Â[\u00A0-\u00BF]|â[€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ])/;

  function repairMojibakeString(input) {
    let value = String(input ?? '');
    for (let pass = 0; pass < 3 && MOJIBAKE_PATTERN.test(value); pass += 1) {
      const bytes = [];
      let convertible = true;
      for (const ch of value) {
        const cp = ch.codePointAt(0);
        if (cp <= 0xFF) bytes.push(cp);
        else if (CP1252_REVERSE.has(cp)) bytes.push(CP1252_REVERSE.get(cp));
        else { convertible = false; break; }
      }
      if (!convertible) break;
      try {
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
        if (!decoded || decoded === value) break;
        value = decoded;
      } catch { break; }
    }
    return value;
  }

  function repairMojibakeDeep(root) {
    let changes = 0;
    const walk = (value) => {
      if (typeof value === 'string') {
        const repaired = repairMojibakeString(value);
        if (repaired !== value) changes += 1;
        return repaired;
      }
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i += 1) value[i] = walk(value[i]);
        return value;
      }
      if (value && typeof value === 'object') {
        Object.keys(value).forEach(key => { value[key] = walk(value[key]); });
      }
      return value;
    };
    walk(root);
    return changes;
  }

  function rollD20Check(modifier = 0, advantageLevel = 0) {
    const mod = Math.trunc(number(modifier));
    const advantage = Math.max(-2, Math.min(2, Math.trunc(number(advantageLevel))));
    const count = 1 + Math.abs(advantage);
    const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * 20));
    const chosen = advantage > 0 ? Math.max(...rolls) : advantage < 0 ? Math.min(...rolls) : rolls[0];
    const result = chosen + mod;
    const mode = advantage === 2 ? '2 vantagens' : advantage === 1 ? '1 vantagem' : advantage === -1 ? '1 desvantagem' : advantage === -2 ? '2 desvantagens' : 'normal';
    return {
      expression: `1d20 ${mod >= 0 ? '+' : '−'} ${Math.abs(mod)} (${mode})`,
      result,
      rolls,
      chosen,
      modifier: mod,
      advantage,
      details: [`d20: [${rolls.join(', ')}]`, `Escolhido: ${chosen}`, `Modificador: ${mod >= 0 ? '+' : ''}${mod}`, `Modo: ${mode}`]
    };
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
    applySheetFormulas, normalizeCharacterData, repairMojibakeString, repairMojibakeDeep,
    slugify, rollDiceExpression, rollD20Check, formatCost
  };
})();
