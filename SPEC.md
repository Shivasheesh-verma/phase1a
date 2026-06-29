# Phase 1A Nutrition Tracker Spec

## Schema

```sql
CREATE TABLE presets (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  aliases TEXT,
  basis_qty REAL, basis_unit TEXT,
  cal REAL, protein REAL, carb REAL, fat REAL, fibre REAL,
  source TEXT,
  updated_at TEXT
);

CREATE TABLE entries (
  id INTEGER PRIMARY KEY,
  date TEXT, ts TEXT,
  raw_text TEXT,
  resolved TEXT,
  cal REAL, protein REAL, carb REAL, fat REAL, fibre REAL,
  needs_review INTEGER DEFAULT 0
);

CREATE TABLE daily_summaries (
  date TEXT PRIMARY KEY,
  cal REAL, protein REAL, carb REAL, fat REAL, fibre REAL,
  adherence_score INTEGER, quality_score INTEGER,
  analysis_md TEXT, suggestions TEXT,
  created_at TEXT
);
```
