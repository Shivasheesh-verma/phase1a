import { getPresets, roundMacros } from './db.js';

const NUMBER_WORDS = new Map([
  ['zero', 0],
  ['a', 1],
  ['an', 1],
  ['one', 1],
  ['two', 2],
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['six', 6],
  ['seven', 7],
  ['eight', 8],
  ['nine', 9],
  ['ten', 10],
  ['half', 0.5],
  ['quarter', 0.25],
]);

const UNIT_ALIASES = new Map([
  ['g', 'g'],
  ['gm', 'g'],
  ['gms', 'g'],
  ['gram', 'g'],
  ['grams', 'g'],
  ['kg', 'kg'],
  ['ml', 'ml'],
  ['l', 'l'],
  ['katori', 'katori'],
  ['bowl', 'bowl'],
  ['cup', 'cup'],
  ['cups', 'cup'],
  ['plate', 'plate'],
  ['serving', 'serving'],
  ['scoop', 'scoop'],
  ['scoops', 'scoop'],
  ['bar', 'bar'],
  ['bars', 'bar'],
  ['egg', 'egg'],
  ['eggs', 'egg'],
  ['chilla', 'chilla'],
  ['chillas', 'chilla'],
  ['roti', 'roti'],
  ['rotis', 'roti'],
  ['apple', 'apple'],
  ['apples', 'apple'],
  ['carrot', 'carrot'],
  ['carrots', 'carrot'],
  ['medium', 'medium'],
]);

const AMBIGUOUS_UNIT_ALIASES = new Map([
  ['pcs', 'pcs'],
  ['pc', 'pcs'],
  ['piece', 'pcs'],
  ['pieces', 'pcs'],
  ['slice', 'slice'],
  ['slices', 'slice'],
  ['handful', 'handful'],
  ['handfuls', 'handful'],
  ['small', 'small'],
  ['large', 'large'],
  ['bite', 'bite'],
  ['bites', 'bite'],
  ['portion', 'portion'],
  ['portions', 'portion'],
  ['stick', 'stick'],
  ['sticks', 'stick'],
]);

const STOP_WORDS = new Set(['cooked', 'fresh', 'plain']);

export function resolveEntry(rawText) {
  const chunks = splitChunks(rawText);
  const presets = getPresets();
  const resolved = [];
  const ambiguous = [];
  const unresolved = [];

  for (const chunk of chunks) {
    const parsed = parseChunk(chunk);
    if (!parsed) {
      unresolved.push({ chunk, reason: 'quantity_not_parsed' });
      continue;
    }

    const match = fuzzyMatch(parsed.name, presets);
    if (!match) {
      unresolved.push({ chunk, reason: 'no_preset_match' });
      continue;
    }

    if (parsed.quantityTier === 'ambiguous') {
      ambiguous.push({
        chunk,
        reason: 'ambiguous_quantity_unit',
        parsed,
        preset: match.preset,
        matchedTerm: match.matchedTerm,
        matchScore: match.score,
      });
      continue;
    }

    if (!canScale(parsed, match.preset)) {
      unresolved.push({ chunk, reason: 'quantity_unit_not_scalable' });
      continue;
    }

    resolved.push(scalePreset(chunk, parsed, match.preset, match.matchedTerm, match.score));
  }

  const totals = sumResolved(resolved);
  return {
    chunks,
    resolved,
    ambiguous,
    unresolved,
    totals,
  };
}

function splitChunks(rawText) {
  return String(rawText || '')
    .split(/\s*(?:,|\band\b)\s*/i)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

export function parseChunk(chunk) {
  const text = normalizeSpaces(chunk);
  const compact = text.match(/^(\d+(?:\.\d+)?)(kg|g|gm|gms|grams?|ml|l)\b\s*(.+)$/i);
  if (compact) {
    return normalizeParsed({
      qty: Number(compact[1]),
      unit: compact[2],
      quantityTier: 'clean',
      name: compact[3],
    });
  }

  const parts = text.split(' ');
  if (parts.length < 1) return null;

  const firstQty = parseQtyToken(parts[0]);
  if (firstQty == null) {
    return normalizeParsed({
      qty: 1,
      unit: null,
      quantityTier: 'clean',
      name: text,
    });
  }

  if (parts.length >= 3 && isUnit(parts[1])) {
    return normalizeParsed({
      qty: firstQty,
      unit: parts[1],
      quantityTier: 'clean',
      name: parts.slice(2).join(' '),
    });
  }

  if (parts.length >= 3 && isAmbiguousUnit(parts[1])) {
    return normalizeParsed({
      qty: firstQty,
      unit: parts[1],
      quantityTier: 'ambiguous',
      name: parts.slice(2).join(' '),
    });
  }

  return normalizeParsed({
    qty: firstQty,
    unit: null,
    quantityTier: 'clean',
    name: parts.slice(1).join(' '),
  });
}

function normalizeParsed(parsed) {
  const unit = parsed.unit ? normalizeUnit(parsed.unit) : null;
  return {
    qty: parsed.qty,
    unit,
    quantityTier: parsed.quantityTier || 'clean',
    name: normalizeSpaces(parsed.name),
  };
}

function parseQtyToken(token) {
  const cleaned = token.toLowerCase();
  if (/^\d+(?:\.\d+)?$/.test(cleaned)) return Number(cleaned);
  return NUMBER_WORDS.has(cleaned) ? NUMBER_WORDS.get(cleaned) : null;
}

function isUnit(token) {
  return UNIT_ALIASES.has(token.toLowerCase());
}

function isAmbiguousUnit(token) {
  return AMBIGUOUS_UNIT_ALIASES.has(token.toLowerCase());
}

function normalizeUnit(unit) {
  const cleaned = unit.toLowerCase();
  return UNIT_ALIASES.get(cleaned) || AMBIGUOUS_UNIT_ALIASES.get(cleaned) || cleaned;
}

function fuzzyMatch(name, presets) {
  const query = normalizeFoodName(name);
  if (!query) return null;

  for (const preset of presets) {
    const terms = [preset.name, ...preset.aliasList];
    for (const term of terms) {
      if (query === normalizeFoodName(term)) {
        return { preset, matchedTerm: term, score: 1 };
      }
    }
  }

  let best = null;
  for (const preset of presets) {
    const terms = [preset.name, ...preset.aliasList];
    for (const term of terms) {
      const candidate = normalizeFoodName(term);
      const score = scoreMatch(query, candidate);
      if (!best || score > best.score) {
        best = { preset, matchedTerm: term, score };
      }
    }
  }

  return best && best.score >= 0.72 ? best : null;
}

function scoreMatch(query, candidate) {
  if (!candidate) return 0;
  if (query === candidate) return 1;

  const queryTokens = query.split(' ').filter(Boolean);
  const candidateTokens = candidate.split(' ').filter(Boolean);

  if (candidate.includes(query)) return 0.92;
  if (query.includes(candidate) && candidateTokens.length > 1) return 0.92;

  const candidateTokenSet = new Set(candidateTokens);
  const overlap = queryTokens.filter((token) => candidateTokenSet.has(token)).length;
  const tokenScore = overlap / Math.max(queryTokens.length, candidateTokens.length);
  const distanceScore = 1 - levenshtein(query, candidate) / Math.max(query.length, candidate.length);
  const overlapWeight = overlap / Math.max(queryTokens.length, 1);

  return Math.max(tokenScore, distanceScore * overlapWeight);
}

function canScale(parsed, preset) {
  if (!Number.isFinite(parsed.qty) || parsed.qty <= 0) return false;
  if (!Number.isFinite(preset.basis_qty) || preset.basis_qty <= 0) return false;
  if (!parsed.unit) return true;

  const basisUnit = normalizeUnit(preset.basis_unit || '');
  if (parsed.unit === basisUnit) return true;
  if (parsed.unit === 'kg' && basisUnit === 'g') return true;
  return false;
}

function scalePreset(chunk, parsed, preset, matchedTerm, matchScore) {
  const qty = parsed.unit === 'kg' && normalizeUnit(preset.basis_unit || '') === 'g'
    ? parsed.qty * 1000
    : parsed.qty;
  const factor = qty / preset.basis_qty;
  const macros = roundMacros({
    cal: preset.cal * factor,
    protein: preset.protein * factor,
    carb: preset.carb * factor,
    fat: preset.fat * factor,
    fibre: preset.fibre * factor,
  });

  return {
    input: chunk,
    name: preset.name,
    matched_term: matchedTerm,
    match_score: Math.round(matchScore * 100) / 100,
    qty: parsed.qty,
    unit: parsed.unit || preset.basis_unit,
    basis_qty: preset.basis_qty,
    basis_unit: preset.basis_unit,
    source: preset.source,
    ...macros,
  };
}

function sumResolved(items) {
  return roundMacros(items.reduce((acc, item) => {
    acc.cal += item.cal;
    acc.protein += item.protein;
    acc.carb += item.carb;
    acc.fat += item.fat;
    acc.fibre += item.fibre;
    return acc;
  }, { cal: 0, protein: 0, carb: 0, fat: 0, fibre: 0 }));
}

function normalizeFoodName(value) {
  return normalizeSpaces(String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' '))
    .split(' ')
    .filter((token) => token && !STOP_WORDS.has(token))
    .join(' ');
}

function normalizeSpaces(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function levenshtein(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 0; i < a.length; i += 1) {
    let last = i;
    previous[0] = i + 1;
    for (let j = 0; j < b.length; j += 1) {
      const old = previous[j + 1];
      previous[j + 1] = a[i] === b[j]
        ? last
        : Math.min(last + 1, previous[j] + 1, previous[j + 1] + 1);
      last = old;
    }
  }
  return previous[b.length];
}
