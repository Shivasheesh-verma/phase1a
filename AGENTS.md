PROJECT: Phase 1A — personal nutrition tracker. Single user (me). Never to be published.

STACK (do not substitute):
- Backend: Node + Express + better-sqlite3. One service.
- DB: SQLite, single file ./data/nutrition.db. No Postgres, no ORM.
- Frontend: vanilla HTML/CSS/JS PWA. No framework, no build step.
- AI: one API call via fetch. Model configurable in one env var.

HARD RULES:
1. Tier 1 CLEAN quantities are deterministic: known food + clean unit (g, ml,
   katori, bowl, roti, chilla, scoop, bar, egg, serving, medium, cup, plate)
   must resolve by preset arithmetic with zero AI.
2. Tier 2 AMBIGUOUS quantities are weight-only AI: known food + informal unit
   (pcs, pieces, pc, slice, slices, handful, small, large, bite, bites, portion,
   stick, sticks) asks AI only for estimated grams, then scales trusted preset
   macros. Do not ask AI for macros.
3. Tier 3 UNKNOWN foods are full macro AI: food not matched in presets goes to
   the full estimation prompt and may be saved as an ai preset.
4. The Phase 1A spec text goes verbatim into the AI system prompt. Do not rewrite it.
5. AI must return strict JSON. Strip ```json code fences before parsing. Wrap
   parsing in try/catch.
6. 'unverified' source rows are my responsibility — never invent label values.
7. Build only the milestone I ask for. Do not scaffold ahead. Stop and show me
   the verification result at the end of each milestone.
