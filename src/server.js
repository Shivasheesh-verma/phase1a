import './env.js';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDayAnalysis, estimateMisses, estimatePortionWeight, getAiStats, getLastCloseDayRawContent, getLastRawAiResponse } from './ai.js';
import { deleteEntryById, getDailySummaries, getDailySummary, getDayEntries, getDayTotals, getEntryById, initDb, insertAiPreset, insertEntry, updateEntry, upsertDailySummary } from './db.js';
import { resolveEntry } from './resolver.js';

initDb();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', 'public');
const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  return next();
});
app.use(express.json());
app.use(express.static(publicDir));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/log', async (req, res) => {
  const rawText = typeof req.body?.raw_text === 'string' ? req.body.raw_text.trim() : '';
  const date = typeof req.body?.date === 'string' && req.body.date.trim()
    ? req.body.date.trim()
    : todayLocalDate();

  if (!rawText) {
    return res.status(400).json({ error: 'raw_text is required' });
  }

  const resolution = await resolveLoggedEntry({ rawText, date });
  const ts = new Date().toISOString();
  const entryId = insertEntry({
    date,
    ts,
    rawText,
    resolved: resolution.resolved,
    totals: resolution.totals,
    needsReview: resolution.needsReview,
  });

  return res.status(201).json({
    entry: {
      id: Number(entryId),
      date,
      ts,
      raw_text: rawText,
      resolved: resolution.resolved,
      totals: resolution.totals,
      ...resolution.totals,
      needs_review: resolution.needsReview,
    },
    running_totals: getDayTotals(date),
    unresolved: resolution.unresolved,
    ai_stats: getAiStats(),
  });
});

app.patch('/entry/:id', async (req, res) => {
  const id = Number(req.params.id);
  const rawText = typeof req.body?.raw_text === 'string' ? req.body.raw_text.trim() : '';
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'invalid_entry_id' });
  }
  if (!rawText) {
    return res.status(400).json({ error: 'raw_text is required' });
  }

  const existing = getEntryById(id);
  if (!existing) {
    return res.status(404).json({ error: 'entry_not_found' });
  }

  const resolution = await resolveLoggedEntry({ rawText, date: existing.date });
  updateEntry({
    id,
    rawText,
    resolved: resolution.resolved,
    totals: resolution.totals,
    needsReview: resolution.needsReview,
  });

  const updated = getEntryById(id);
  return res.json({
    entry: updated,
    running_totals: getDayTotals(existing.date),
    unresolved: resolution.unresolved,
    ai_stats: getAiStats(),
  });
});

app.delete('/entry/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'invalid_entry_id' });
  }

  const existing = getEntryById(id);
  if (!existing) {
    return res.status(404).json({ error: 'entry_not_found' });
  }

  deleteEntryById(id);
  return res.json({
    id,
    date: existing.date,
    running_totals: getDayTotals(existing.date),
  });
});

app.get('/day/:date', (req, res) => {
  const date = req.params.date;
  res.json({
    date,
    entries: getDayEntries(date),
    running_totals: getDayTotals(date),
  });
});

app.get('/today', (_req, res) => {
  const date = todayLocalDate();
  res.json({
    date,
    entries: getDayEntries(date),
    running_totals: getDayTotals(date),
  });
});

app.get('/days', (_req, res) => {
  res.json({
    days: getDailySummaries(),
  });
});

app.post('/close-day', async (req, res) => {
  const date = typeof req.body?.date === 'string' && req.body.date.trim()
    ? req.body.date.trim()
    : todayLocalDate();
  const entries = getDayEntries(date);
  const totals = getDayTotals(date);

  try {
    const { rawContent, parsed } = await closeDayAnalysis({ date, entries, totals });
    upsertDailySummary({
      date,
      totals: parsed?.totals ?? totals,
      adherenceScore: parsed?.adherence_score,
      qualityScore: parsed?.quality_score,
      analysisMd: parsed?.analysis_md,
      suggestions: parsed?.suggestions,
    });

    return res.json({
      date,
      summary: getDailySummary(date),
      raw_content: rawContent,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return res.status(500).json({
        error: 'close_day_parse_failed',
        raw_response: getLastCloseDayRawContent(),
      });
    }

    return res.status(500).json({
      error: 'close_day_failed',
      message: error.message,
    });
  }
});

app.get('/summary/:date', (req, res) => {
  const summary = getDailySummary(req.params.date);
  if (!summary) {
    return res.status(404).json({ error: 'summary_not_found' });
  }
  return res.json(summary);
});

app.get('/history', (_req, res) => {
  res.sendFile(path.join(publicDir, 'history.html'));
});

app.get('/debug/ai-stats', (_req, res) => {
  res.json(getAiStats());
});

app.get('/debug/ai-last-response', (_req, res) => {
  res.json(getLastRawAiResponse());
});

app.get('/debug/close-day-last-content', (_req, res) => {
  res.json({ raw_content: getLastCloseDayRawContent() });
});

app.get('/debug/resolve', (req, res) => {
  const rawText = typeof req.query.raw_text === 'string' ? req.query.raw_text : '';
  res.json(resolveEntry(rawText));
});

const server = http.createServer(app);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Nutrition tracker listening on http://localhost:${PORT}`);
});

function todayLocalDate() {
  return new Date().toLocaleDateString('en-CA');
}

async function resolveLoggedEntry({ rawText, date }) {
  const result = resolveEntry(rawText);
  let aiItems = [];
  let weightItems = [];
  const weightUnresolved = [];
  let unresolved = result.unresolved;

  if (result.ambiguous.length > 0) {
    for (const item of result.ambiguous) {
      try {
        const weight = await estimatePortionWeight({
          chunk: item.chunk,
          foodName: item.parsed.name,
          qty: item.parsed.qty,
          unit: item.parsed.unit,
          presetName: item.preset.name,
        });
        weightItems.push(scalePresetByEstimatedWeight(item, weight));
      } catch (error) {
        console.error(`AI weight estimation failed: ${error.message}`);
        weightUnresolved.push({ chunk: item.chunk, reason: 'weight_estimation_failed' });
      }
    }
  }

  if (result.unresolved.length > 0) {
    try {
      const aiResponse = await estimateMisses({
        misses: result.unresolved.map((item) => item.chunk),
        date,
      });

      aiItems = normalizeAiItems(aiResponse?.items);
      unresolved = [...filterResolvedUnresolved(result.unresolved, aiItems), ...weightUnresolved];

      for (const item of aiItems) {
        if (item.save_as_preset && item.preset) {
          insertAiPreset(item.preset);
        }
      }
    } catch (error) {
      console.error(`AI estimation failed: ${error.message}`);
      aiItems = [];
      unresolved = [...result.unresolved, ...weightUnresolved];
    }
  } else {
    unresolved = weightUnresolved;
  }

  const resolved = [...result.resolved, ...weightItems, ...aiItems];
  const totals = sumMacros(resolved);
  const needsReview = unresolved.length > 0 ? 1 : 0;

  return {
    resolved,
    totals,
    unresolved,
    needsReview,
  };
}

function normalizeAiItems(items) {
  if (!Array.isArray(items)) return [];

  return items
    .filter((item) => item && typeof item.input === 'string')
    .map((item) => ({
      input: item.input,
      name: item.name,
      matched_term: 'ai_estimate',
      match_score: 1,
      qty: Number(item.qty) || 0,
      unit: item.unit,
      basis_qty: item.preset?.basis_qty ?? (Number(item.qty) || 1),
      basis_unit: item.preset?.basis_unit ?? item.unit,
      source: 'ai',
      confidence: item.confidence,
      margin_note: item.margin_note,
      save_as_preset: Boolean(item.save_as_preset),
      preset: item.preset ?? null,
      cal: round(item.cal),
      protein: round(item.protein),
      carb: round(item.carb),
      fat: round(item.fat),
      fibre: round(item.fibre),
    }))
    .filter((item) => item.name && item.qty > 0);
}

function scalePresetByEstimatedWeight(item, weight) {
  const estGrams = Number(weight?.est_grams);
  if (!Number.isFinite(estGrams) || estGrams <= 0) {
    throw new Error('Weight response did not include positive est_grams');
  }

  const basisUnit = String(item.preset.basis_unit || '').toLowerCase();
  const factor = basisUnit === 'kg'
    ? (estGrams / 1000) / item.preset.basis_qty
    : estGrams / item.preset.basis_qty;

  if (basisUnit !== 'g' && basisUnit !== 'kg') {
    throw new Error(`Cannot scale ${item.preset.name} by grams from basis unit ${item.preset.basis_unit}`);
  }

  return {
    input: item.chunk,
    name: item.preset.name,
    matched_term: item.matchedTerm,
    match_score: Math.round(item.matchScore * 100) / 100,
    qty: item.parsed.qty,
    unit: item.parsed.unit,
    basis_qty: item.preset.basis_qty,
    basis_unit: item.preset.basis_unit,
    source: item.preset.source,
    tier: 'tier2_weight_ai',
    est_grams: round(estGrams),
    weight_confidence: weight?.confidence,
    weight_note: weight?.note || '',
    cal: round(item.preset.cal * factor),
    protein: round(item.preset.protein * factor),
    carb: round(item.preset.carb * factor),
    fat: round(item.preset.fat * factor),
    fibre: round(item.preset.fibre * factor),
  };
}

function filterResolvedUnresolved(unresolved, aiItems) {
  const resolvedInputs = new Set(aiItems.map((item) => item.input));
  return unresolved.filter((item) => !resolvedInputs.has(item.chunk));
}

function sumMacros(items) {
  return items.reduce((acc, item) => ({
    cal: round(acc.cal + (Number(item.cal) || 0)),
    protein: round(acc.protein + (Number(item.protein) || 0)),
    carb: round(acc.carb + (Number(item.carb) || 0)),
    fat: round(acc.fat + (Number(item.fat) || 0)),
    fibre: round(acc.fibre + (Number(item.fibre) || 0)),
  }), { cal: 0, protein: 0, carb: 0, fat: 0, fibre: 0 });
}

function round(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}
