import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const dbPath = path.join(dataDir, 'nutrition.db');
const seedPath = path.join(rootDir, 'nutrition_hybrid_m0', 'seed_presets.sql');

fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const schema = `
CREATE TABLE IF NOT EXISTS presets (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  aliases TEXT,
  basis_qty REAL, basis_unit TEXT,
  cal REAL, protein REAL, carb REAL, fat REAL, fibre REAL,
  source TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY,
  date TEXT, ts TEXT,
  raw_text TEXT,
  resolved TEXT,
  cal REAL, protein REAL, carb REAL, fat REAL, fibre REAL,
  needs_review INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daily_summaries (
  date TEXT PRIMARY KEY,
  cal REAL, protein REAL, carb REAL, fat REAL, fibre REAL,
  adherence_score INTEGER, quality_score INTEGER,
  analysis_md TEXT, suggestions TEXT,
  created_at TEXT
);
`;

export function initDb() {
  db.exec(schema);
  const presetCount = db.prepare('SELECT COUNT(*) AS count FROM presets').get().count;
  if (presetCount === 0) {
    db.exec(fs.readFileSync(seedPath, 'utf8'));
  }
}

export function getPresets() {
  return db.prepare('SELECT * FROM presets ORDER BY id').all().map((preset) => ({
    ...preset,
    aliasList: parseAliases(preset.aliases),
  }));
}

export function getPresetPromptContext() {
  return db.prepare(`
    SELECT name, aliases, basis_qty, basis_unit
    FROM presets
    ORDER BY id
  `).all().map((preset) => ({
    name: preset.name,
    aliases: parseAliases(preset.aliases),
    basis_qty: preset.basis_qty,
    basis_unit: preset.basis_unit,
  }));
}

export function replacePresetsFromSeed() {
  const seedSql = fs.readFileSync(seedPath, 'utf8');
  const reload = db.transaction(() => {
    db.prepare('DELETE FROM presets').run();
    db.exec(seedSql);
  });
  reload();
}

export function getDayTotals(date) {
  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(cal), 0) AS cal,
      COALESCE(SUM(protein), 0) AS protein,
      COALESCE(SUM(carb), 0) AS carb,
      COALESCE(SUM(fat), 0) AS fat,
      COALESCE(SUM(fibre), 0) AS fibre
    FROM entries
    WHERE date = ?
  `).get(date);

  return roundMacros(totals);
}

export function getDayEntries(date) {
  return db.prepare('SELECT * FROM entries WHERE date = ? ORDER BY ts, id').all(date).map((entry) => ({
    ...entry,
    resolved: JSON.parse(entry.resolved || '[]'),
  }));
}

export function getEntryById(id) {
  const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
  if (!entry) return null;
  return {
    ...entry,
    resolved: JSON.parse(entry.resolved || '[]'),
  };
}

export function getDailySummary(date) {
  const row = db.prepare('SELECT * FROM daily_summaries WHERE date = ?').get(date);
  if (!row) return null;
  return {
    ...row,
    suggestions: parseJsonText(row.suggestions, []),
  };
}

export function getDailySummaries() {
  return db.prepare('SELECT * FROM daily_summaries ORDER BY date DESC').all().map((row) => ({
    ...row,
    suggestions: parseJsonText(row.suggestions, []),
  }));
}

export function insertEntry({ date, ts, rawText, resolved, totals, needsReview }) {
  const stmt = db.prepare(`
    INSERT INTO entries
      (date, ts, raw_text, resolved, cal, protein, carb, fat, fibre, needs_review)
    VALUES
      (@date, @ts, @rawText, @resolved, @cal, @protein, @carb, @fat, @fibre, @needsReview)
  `);

  const result = stmt.run({
    date,
    ts,
    rawText,
    resolved: JSON.stringify(resolved),
    cal: totals.cal,
    protein: totals.protein,
    carb: totals.carb,
    fat: totals.fat,
    fibre: totals.fibre,
    needsReview,
  });

  return result.lastInsertRowid;
}

export function updateEntry({ id, rawText, resolved, totals, needsReview }) {
  db.prepare(`
    UPDATE entries
    SET raw_text = @rawText,
        resolved = @resolved,
        cal = @cal,
        protein = @protein,
        carb = @carb,
        fat = @fat,
        fibre = @fibre,
        needs_review = @needsReview
    WHERE id = @id
  `).run({
    id,
    rawText,
    resolved: JSON.stringify(resolved),
    cal: totals.cal,
    protein: totals.protein,
    carb: totals.carb,
    fat: totals.fat,
    fibre: totals.fibre,
    needsReview,
  });
}

export function deleteEntryById(id) {
  return db.prepare('DELETE FROM entries WHERE id = ?').run(id);
}

export function insertAiPreset(preset) {
  const existing = db.prepare('SELECT id FROM presets WHERE lower(name) = lower(?)').get(preset.name);
  const nextAliases = Array.isArray(preset.aliases) ? preset.aliases : [];

  if (existing) {
    const current = db.prepare('SELECT aliases FROM presets WHERE id = ?').get(existing.id);
    const aliases = JSON.stringify(mergeAliases(nextAliases, parseAliases(current?.aliases)));
    db.prepare(`
      UPDATE presets
      SET aliases = @aliases,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = @id
    `).run({
      id: existing.id,
      aliases,
    });
    return;
  }

  const aliases = JSON.stringify(nextAliases);
  db.prepare(`
    INSERT INTO presets
      (name, aliases, basis_qty, basis_unit, cal, protein, carb, fat, fibre, source)
    VALUES
      (@name, @aliases, @basis_qty, @basis_unit, @cal, @protein, @carb, @fat, @fibre, 'ai')
  `).run({
    name: preset.name,
    aliases,
    basis_qty: preset.basis_qty,
    basis_unit: preset.basis_unit,
    cal: preset.cal,
    protein: preset.protein,
    carb: preset.carb,
    fat: preset.fat,
    fibre: preset.fibre,
  });
}

export function upsertDailySummary({ date, totals, adherenceScore, qualityScore, analysisMd, suggestions }) {
  db.prepare(`
    INSERT OR REPLACE INTO daily_summaries
      (date, cal, protein, carb, fat, fibre, adherence_score, quality_score, analysis_md, suggestions, created_at)
    VALUES
      (@date, @cal, @protein, @carb, @fat, @fibre, @adherenceScore, @qualityScore, @analysisMd, @suggestions, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  `).run({
    date,
    cal: totals.cal,
    protein: totals.protein,
    carb: totals.carb,
    fat: totals.fat,
    fibre: totals.fibre,
    adherenceScore,
    qualityScore,
    analysisMd,
    suggestions: JSON.stringify(Array.isArray(suggestions) ? suggestions : []),
  });
}

export function roundMacros(macros) {
  return {
    cal: round(macros.cal),
    protein: round(macros.protein),
    carb: round(macros.carb),
    fat: round(macros.fat),
    fibre: round(macros.fibre),
  };
}

function round(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function parseAliases(aliases) {
  if (!aliases) return [];
  try {
    const parsed = JSON.parse(aliases);
    return Array.isArray(parsed) ? parsed.filter((alias) => typeof alias === 'string') : [];
  } catch {
    return [];
  }
}

function mergeAliases(primaryAliases, existingAliases) {
  const merged = [];
  const seen = new Set();

  for (const alias of [...primaryAliases, ...existingAliases]) {
    const cleaned = String(alias || '').trim().toLowerCase();
    if (!cleaned || seen.has(cleaned)) continue;
    merged.push(cleaned);
    seen.add(cleaned);
  }

  return merged;
}

function parseJsonText(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
