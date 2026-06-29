import assert from 'node:assert/strict';
import { buildPromptWithExistingPresets } from '../src/ai.js';
import { getPresetPromptContext, initDb, replacePresetsFromSeed } from '../src/db.js';
import { resolveEntry } from '../src/resolver.js';

initDb();
replacePresetsFromSeed();

const result = resolveEntry('200g chicken breast, 2 besan chilla, half katori dal');

assert.deepEqual(result.unresolved, []);

const byName = new Map(result.resolved.map((item) => [item.name, item]));

assert.equal(byName.get('chicken cooked')?.matched_term, 'chicken breast');
assert.equal(byName.get('chicken cooked')?.cal, 390);
assert.equal(byName.get('chicken cooked')?.protein, 54);
assert.equal(byName.get('chicken cooked')?.carb, 0);
assert.equal(byName.get('chicken cooked')?.fat, 18);
assert.equal(byName.get('chicken cooked')?.fibre, 0);

assert.equal(byName.get('besan chilla')?.matched_term, 'besan chilla');
assert.equal(byName.get('besan chilla')?.cal, 290);
assert.equal(byName.get('besan chilla')?.protein, 14.6);

assert.equal(byName.get('dal cooked')?.matched_term, 'dal cooked');
assert.equal(byName.get('dal cooked')?.cal, 60);
assert.equal(byName.get('dal cooked')?.protein, 3.5);

assert.equal(result.totals.cal, 740);
assert.equal(result.totals.protein, 72.1);
assert.ok(result.totals.cal > 0);
assert.ok(result.totals.protein > 0);
assert.ok(result.resolved.every((item) => item.cal > 0 || item.protein > 0));

const soyaResult = resolveEntry('soya chilli');
assert.equal(soyaResult.unresolved.length, 0);
assert.equal(soyaResult.resolved[0]?.cal, 300);
assert.equal(soyaResult.resolved[0]?.protein, 30);
assert.equal(soyaResult.totals.cal, 300);
assert.equal(soyaResult.totals.protein, 30);

const ambiguousResult = resolveEntry('2 pcs chicken tikka');
assert.equal(ambiguousResult.resolved.length, 0);
assert.equal(ambiguousResult.unresolved.length, 0);
assert.equal(ambiguousResult.ambiguous.length, 1);
assert.equal(ambiguousResult.ambiguous[0].preset.name, 'chicken tikka');
assert.equal(ambiguousResult.ambiguous[0].parsed.qty, 2);
assert.equal(ambiguousResult.ambiguous[0].parsed.unit, 'pcs');

const presetPromptContext = getPresetPromptContext();
assert.ok(presetPromptContext.length >= 28);
assert.ok(presetPromptContext.every((row) => 'name' in row && 'aliases' in row && 'basis_qty' in row && 'basis_unit' in row));
assert.ok(presetPromptContext.every((row) => !('cal' in row) && !('protein' in row) && !('carb' in row) && !('fat' in row) && !('fibre' in row)));

const aiPrompt = buildPromptWithExistingPresets('Base prompt');
assert.match(aiPrompt, /EXISTING PRESETS/);
assert.match(aiPrompt, /"basis_unit":"g"/);
assert.doesNotMatch(aiPrompt, /"protein":/);

console.log('resolver deterministic macro test passed');
