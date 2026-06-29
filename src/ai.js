import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPresetPromptContext } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const promptsPath = path.join(rootDir, 'nutrition_hybrid_m0', 'prompts.md');

let estimationCallCount = 0;
let weightCallCount = 0;
let lastRawAiResponse = null;
let lastWeightRawContent = null;
let lastCloseDayRawContent = null;

export function getAiStats() {
  return {
    estimation_call_count: estimationCallCount,
    weight_call_count: weightCallCount,
  };
}

export function getLastRawAiResponse() {
  return lastRawAiResponse;
}

export function getLastCloseDayRawContent() {
  return lastCloseDayRawContent;
}

export function resetAiStats() {
  estimationCallCount = 0;
  weightCallCount = 0;
  lastRawAiResponse = null;
  lastWeightRawContent = null;
  lastCloseDayRawContent = null;
}

export async function estimateMisses({ misses, date }) {
  if (!Array.isArray(misses) || misses.length === 0) {
    return { items: [] };
  }

  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.AI_MODEL || 'llama-3.3-70b-versatile';
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is required for AI estimation');
  }

  const systemPrompt = buildPromptWithExistingPresets(readPrompt('Estimation'));
  const payload = {
    misses,
    context: {
      date,
      locale: 'India',
      known_foods_were_already_resolved: true,
    },
  };

  estimationCallCount += 1;
  console.log(`AI estimation call #${estimationCallCount} for ${misses.length} unresolved chunk(s)`);

  const { data, content } = await requestGroqChatCompletion({
    apiKey,
    model,
    systemPrompt,
    payload,
  });
  lastRawAiResponse = data;

  return normalizeEstimatedResponse(parseStrictJson(content));
}

export async function estimatePortionWeight({ chunk, foodName, qty, unit, presetName }) {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.AI_MODEL || 'llama-3.3-70b-versatile';
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is required for AI weight estimation');
  }

  const systemPrompt = buildPromptWithExistingPresets(readPrompt('Weight-Only'));
  const payload = {
    chunk,
    food_name: foodName,
    qty,
    unit,
    preset_name: presetName,
    locale: 'India',
  };

  weightCallCount += 1;
  console.log(`AI weight call #${weightCallCount} for ambiguous chunk: ${chunk}`);

  const { content } = await requestGroqChatCompletion({
    apiKey,
    model,
    systemPrompt,
    payload,
  });

  lastWeightRawContent = content;
  return parseStrictJson(content);
}

export async function closeDayAnalysis({ date, entries, totals }) {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.AI_MODEL || 'llama-3.3-70b-versatile';
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is required for AI close-day analysis');
  }

  const systemPrompt = readPrompt('Day-Close');
  const payload = {
    date,
    totals,
    entries,
  };

  const { content } = await requestGroqChatCompletion({
    apiKey,
    model,
    systemPrompt,
    payload,
  });

  lastCloseDayRawContent = content;
  return {
    rawContent: content,
    parsed: parseStrictJson(content),
  };
}

export function parseStrictJson(raw) {
  const sanitized = stripJsonFences(raw);
  return JSON.parse(sanitized);
}

export function buildPromptWithExistingPresets(basePrompt) {
  const presets = getPresetPromptContext();
  const compactPresetJson = JSON.stringify(presets);

  return `${basePrompt}

EXISTING PRESETS
${compactPresetJson}

Use EXISTING PRESETS to anchor basis units and aliases. Never invent duplicate preset names when an existing preset already covers the food. If an unresolved chunk appears to describe an existing preset, reuse that existing preset name and basis unit rather than creating a new one.`;
}

function stripJsonFences(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    return trimmed
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }
  return trimmed;
}

function readPrompt(sectionName) {
  const content = fs.readFileSync(promptsPath, 'utf8');
  const match = content.match(new RegExp(`## ${sectionName} Call System Prompt[\\s\\S]*?\\\`\\\`\\\`text\\n([\\s\\S]*?)\\n\\\`\\\`\\\``));
  if (!match) {
    throw new Error(`${sectionName} prompt not found in prompts.md`);
  }
  return match[1];
}

async function requestGroqChatCompletion({ apiKey, model, systemPrompt, payload }) {
  const endpoint = process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1/chat/completions';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(payload) },
      ],
      temperature: 0,
    }),
  });

  if (!response.ok) {
    throw new Error(`AI request failed with status ${response.status}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('AI response did not contain message content');
  }

  return { data, content };
}

function normalizeEstimatedResponse(parsed) {
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  return {
    ...parsed,
    items: items.map(normalizeEstimatedItem).filter(Boolean),
  };
}

function normalizeEstimatedItem(item) {
  if (!item || typeof item.input !== 'string') return null;

  const inputFoodName = extractFoodName(item.input);
  const normalizedPresetName = String(item.preset?.name || item.name || inputFoodName)
    .trim()
    .toLowerCase();
  const aliases = normalizeAliases(inputFoodName, item.preset?.aliases);

  return {
    ...item,
    name: String(item.name || normalizedPresetName).trim().toLowerCase(),
    preset: item.preset ? {
      ...item.preset,
      name: normalizedPresetName,
      aliases,
    } : item.preset,
  };
}

function normalizeAliases(inputFoodName, aliases) {
  const normalizedInput = inputFoodName.trim().toLowerCase();
  const seen = new Set();
  const normalized = [];

  if (normalizedInput) {
    normalized.push(normalizedInput);
    seen.add(normalizedInput);
  }

  const rawAliases = Array.isArray(aliases) ? aliases : [];
  for (const alias of rawAliases) {
    const cleaned = String(alias || '').trim().toLowerCase();
    if (!cleaned || seen.has(cleaned)) continue;
    normalized.push(cleaned);
    seen.add(cleaned);
  }

  return normalized;
}

function extractFoodName(rawInput) {
  const text = String(rawInput || '').trim().replace(/\s+/g, ' ');
  const compact = text.match(/^(\d+(?:\.\d+)?)(kg|g|gm|gms|grams?|ml|l)\b\s*(.+)$/i);
  if (compact) return compact[3].trim().toLowerCase();

  const parts = text.split(' ');
  if (parts.length >= 3 && isQuantityToken(parts[0]) && isUnitToken(parts[1])) {
    return parts.slice(2).join(' ').trim().toLowerCase();
  }
  if (parts.length >= 2 && isQuantityToken(parts[0])) {
    return parts.slice(1).join(' ').trim().toLowerCase();
  }
  return text.toLowerCase();
}

function isQuantityToken(token) {
  const cleaned = String(token || '').toLowerCase();
  return /^\d+(?:\.\d+)?$/.test(cleaned) || NUMBER_WORDS.has(cleaned);
}

function isUnitToken(token) {
  return UNIT_WORDS.has(String(token || '').toLowerCase());
}

const NUMBER_WORDS = new Set([
  'a',
  'an',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'half',
  'quarter',
]);

const UNIT_WORDS = new Set([
  'g',
  'gm',
  'gms',
  'gram',
  'grams',
  'kg',
  'ml',
  'l',
  'katori',
  'bowl',
  'plate',
  'serving',
  'scoop',
  'scoops',
  'bar',
  'bars',
  'egg',
  'eggs',
  'white',
  'roti',
  'rotis',
  'chilla',
  'chillas',
  'medium',
  'pcs',
  'pc',
  'piece',
  'pieces',
  'slice',
  'slices',
  'handful',
  'handfuls',
  'small',
  'large',
  'bite',
  'bites',
  'portion',
  'portions',
  'stick',
  'sticks',
]);
