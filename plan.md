# SKU Decoder — Implementation Plan

## Overview

A web-based tool that deciphers product model numbers and SKUs, breaking them down into their constituent parts and explaining what each segment means. Users paste or type a model number (e.g., `OLED65C44LA`) and instantly see a structured breakdown of every letter/number group.

---

## 1. Product Vision

### Core Problem
Model numbers are notoriously opaque. A consumer buying an LG TV needs to know that `OLED65C44LA` means "65-inch OLED, C-series (2024), 4th revision, sold in the LA/UK region" — but this information is buried in obscure spec sheets or brand-specific glossaries.

### Goal
Give anyone — consumer, reseller, IT buyer, repair technician — an instant, human-readable breakdown of a model number, with no account required and no LLM API calls.

---

## 2. Architecture Decision: No External LLM

The system will use **structured pattern databases** (JSON/YAML files) with **regex-based parsing** per manufacturer. This means:

- **Fully offline-capable**: no API keys, no latency, no cost per query.
- **Deterministic**: same input always yields same output.
- **Easily extensible**: anyone can add a new manufacturer by adding a pattern file.
- **Fallback heuristic engine**: for unknown brands, a generic parser will attempt to segment the model number by common conventions (digits = size/year/revision, letter groups = series/type/region).

An optional LLM integration hook can be added later (e.g., "Ask AI" button that calls OpenAI or a local Ollama model) for unrecognised models — but this will be opt-in and never required.

---

## 3. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | **Vanilla JS + HTML + CSS** (no framework) | Zero build step for MVP; fast to ship; easy to contribute to |
| Data | **JSON files per manufacturer** | Version-controlled, human-readable, no DB required for MVP |
| Hosting | **Static site** (GitHub Pages / Netlify / Cloudflare Pages) | Free, no server needed, globally fast |
| Testing | **Vitest** (unit) + **Playwright** (e2e) | Lightweight, already familiar to the repo ecosystem |
| Build (optional later) | **Vite** | Adds bundling/minification when the project grows |

> **Post-MVP database upgrade path**: If the number of manufacturer pattern files becomes large (50+), migrate the JSON files to a **SQLite database** (via sql.js / OPFS in the browser, or a lightweight Edge Function) without changing the frontend API.

---

## 4. Data Model

### 4.1 Manufacturer Pattern File

Each brand gets one JSON file at `data/manufacturers/<brand-slug>.json`:

```json
{
  "brand": "LG",
  "category": "TV",
  "version": 1,
  "patterns": [
    {
      "id": "lg-tv-oled-2022-2025",
      "regex": "^(OLED|QNED|NANO|UHD)(\\d{2,3})(\\w)(\\d)(\\d)(\\w{2})$",
      "segments": [
        {
          "group": 1,
          "name": "Display Technology",
          "values": {
            "OLED": "OLED (Organic Light Emitting Diode)",
            "QNED": "QNED (Quantum NanoCell LED)",
            "NANO": "NanoCell LED",
            "UHD": "4K Ultra HD LED"
          }
        },
        {
          "group": 2,
          "name": "Screen Size",
          "format": "${value} inches"
        },
        {
          "group": 3,
          "name": "Series / Tier",
          "values": {
            "A": "A-Series (Entry)",
            "B": "B-Series (Mid-range)",
            "C": "C-Series (Upper Mid-range)",
            "G": "G-Series (Gallery / Premium)",
            "Z": "Z-Series (Flagship 8K)"
          }
        },
        {
          "group": 4,
          "name": "Model Year",
          "values": {
            "1": "2021",
            "2": "2022",
            "3": "2023",
            "4": "2024",
            "5": "2025"
          }
        },
        {
          "group": 5,
          "name": "Revision / Variant",
          "format": "Revision ${value}"
        },
        {
          "group": 6,
          "name": "Region / Market",
          "values": {
            "LA": "North America / Latin America / UK",
            "UA": "Europe",
            "SA": "South Korea",
            "TA": "Southeast Asia",
            "PA": "Australia / Pacific"
          }
        }
      ]
    }
  ]
}
```

### 4.2 Segment Result (runtime object)

```json
{
  "raw": "OLED65C44LA",
  "brand": "LG",
  "category": "TV",
  "matched_pattern": "lg-tv-oled-2022-2025",
  "confidence": "high",
  "segments": [
    { "name": "Display Technology", "raw": "OLED", "decoded": "OLED (Organic Light Emitting Diode)" },
    { "name": "Screen Size",        "raw": "65",   "decoded": "65 inches" },
    { "name": "Series / Tier",      "raw": "C",    "decoded": "C-Series (Upper Mid-range)" },
    { "name": "Model Year",         "raw": "4",    "decoded": "2024" },
    { "name": "Revision / Variant", "raw": "4",    "decoded": "Revision 4" },
    { "name": "Region / Market",    "raw": "LA",   "decoded": "North America / Latin America / UK" }
  ],
  "notes": []
}
```

---

## 5. Parsing Engine

### 5.1 Flow

```
user input
    │
    ▼
normalize (trim, uppercase, remove spaces/dashes)
    │
    ▼
brand detection
  ├── explicit: user selects brand from dropdown
  └── implicit: prefix matching against all loaded pattern files
    │
    ▼
pattern matching (try each regex in brand file, ordered by specificity)
    │
    ├── match found → extract groups → map each group via "values" or "format"
    │                                → return high-confidence result
    │
    └── no match  → heuristic segmenter (generic fallback)
                    → return low-confidence result with "unrecognised" badge
```

### 5.2 Heuristic Fallback (for unknown models)

When no pattern file matches, apply these generic rules in order:

1. **Leading alpha prefix** → likely product type/line (e.g., `OLED`, `UN`, `QN`, `KD`)
2. **First 2–3 digit sequence** → likely screen size or storage capacity
3. **Single letter after digits** → likely series/tier
4. **Trailing 2-letter suffix** → likely region code (checked against ISO 3166 country codes)
5. **Remaining digits** → likely year code or revision

Flag the result as `confidence: "low"` and show a "Help us improve — submit a correction" link.

---

## 6. Initial Manufacturer Coverage (Phase 1)

| Brand | Category | Notes |
|---|---|---|
| LG | TVs | OLED, QNED, NanoCell lines (2021–2025) |
| Samsung | TVs | QN/UN/QA prefix lines (2021–2025) |
| Sony | TVs | KD/XR/A prefix BRAVIA lines |
| Apple | iPhones | iPhone 13–16 model numbers (A2xxx) |
| Apple | MacBooks | A-chip generation + model ID |
| Intel | CPUs | Core i3/i5/i7/i9, generation + SKU suffix |
| AMD | CPUs | Ryzen 3/5/7/9 series |
| Samsung | SSDs | 870/980/990 EVO/Pro |
| Bosch | Dishwashers / Washing machines | Series number + features |

Each manufacturer file is independently contributed and versioned.

---

## 7. Website Structure

```
/                  ← Home: search bar, auto-detect brand
/result            ← Decoded result page (shareable URL with ?q=OLED65C44LA&brand=lg)
/brands            ← Browse all supported brands and categories
/brands/lg/tv      ← Browse all LG TV patterns with examples
/contribute        ← Guide for adding/correcting pattern files
/about             ← How it works, accuracy disclaimer
```

### 7.1 Home Page

- Large search/input bar, centred
- "Brand (optional)" dropdown below input (defaults to "Auto-detect")
- Example chips: `OLED65C44LA`, `QN65QN90D`, `MK16LL/A`, `Ryzen 5 7600X`
- Recent searches (localStorage)

### 7.2 Result Page

- Input repeated at top (editable)
- Visual "token strip": each segment shown as a labelled colour-coded chip across the original model string
- Below the strip: a table/card list with segment name, raw value, decoded meaning, and a note icon if ambiguous
- Confidence badge: `✓ High confidence — pattern matched` / `⚠ Low confidence — heuristic guess`
- Share button (copies URL with `?q=` param)
- "Something wrong?" feedback link

### 7.3 Brand Browser (`/brands`)

- Filterable grid of brand + category cards
- Each card shows: logo, brand name, number of patterns, last updated date
- Click → `/brands/<brand>/<category>` with a pattern table and live examples

---

## 8. Directory Structure

```
/
├── plan.md                        ← this file
├── index.html                     ← home page
├── result.html                    ← result page
├── brands.html                    ← brand browser
├── contribute.html                ← contribution guide
├── about.html                     ← about page
│
├── css/
│   ├── reset.css
│   ├── tokens.css                 ← design tokens (colours, fonts, spacing)
│   └── main.css
│
├── js/
│   ├── main.js                    ← home page logic
│   ├── result.js                  ← result page logic
│   ├── brands.js                  ← brand browser logic
│   ├── engine/
│   │   ├── loader.js              ← fetch + cache manufacturer JSON files
│   │   ├── detector.js            ← brand auto-detection
│   │   ├── matcher.js             ← regex pattern matching
│   │   ├── heuristic.js           ← fallback segmenter
│   │   └── formatter.js           ← turn match result → display model
│   └── ui/
│       ├── tokenStrip.js          ← renders the colour-coded segment strip
│       ├── resultCard.js          ← renders each decoded segment card
│       └── search.js              ← search bar with autocomplete
│
├── data/
│   └── manufacturers/
│       ├── index.json             ← list of all available manufacturer files
│       ├── lg-tv.json
│       ├── samsung-tv.json
│       ├── sony-tv.json
│       ├── apple-iphone.json
│       ├── intel-cpu.json
│       └── ...
│
├── assets/
│   ├── logos/                     ← brand logos (SVG)
│   └── icons/
│
└── tests/
    ├── unit/
    │   ├── matcher.test.js
    │   ├── heuristic.test.js
    │   └── formatter.test.js
    └── e2e/
        ├── home.spec.js
        └── result.spec.js
```

---

## 9. Implementation Phases

### Phase 1 — Foundation (MVP)
- [ ] Set up static site scaffolding (HTML/CSS/JS)
- [ ] Define and implement the manufacturer JSON schema
- [ ] Build the parsing engine (loader, detector, matcher, formatter)
- [ ] Build the heuristic fallback engine
- [ ] Implement home page UI with search bar
- [ ] Implement result page with token strip and segment cards
- [ ] Add LG TV pattern file (complete, well-tested)
- [ ] Add Samsung TV pattern file
- [ ] Write unit tests for the engine
- [ ] Write e2e tests for home → result flow
- [ ] Deploy to GitHub Pages

### Phase 2 — Coverage Expansion
- [ ] Add Sony TV, Apple iPhone/Mac, Intel/AMD CPU pattern files
- [ ] Brand browser page (`/brands`)
- [ ] Shareable result URLs (`?q=&brand=`)
- [ ] Recent searches via localStorage
- [ ] Contribution guide page + PR template for new pattern files

### Phase 3 — Polish & Community
- [ ] "Report a correction" feedback mechanism (GitHub Issue prefill link)
- [ ] Community-submitted pattern files review process (GitHub PR workflow)
- [ ] Visual design pass (better typography, animations, dark mode)
- [ ] SEO: pre-rendered result pages for top model numbers
- [ ] Optional: "Ask AI" button as a fallback for totally unknown models (opt-in, no API key stored server-side)

---

## 10. Contribution Model for Pattern Files

Anyone can contribute by submitting a PR that adds or updates a JSON file under `data/manufacturers/`. A CI check will:

1. Validate the JSON against the schema.
2. Run all regex patterns against their listed example inputs.
3. Fail if any example doesn't match or decodes incorrectly.

Pattern files must include at least 3 `examples` entries per pattern to be accepted.

---

## 11. Open Questions / Decisions Needed

1. **Brand detection UX**: Should the search bar auto-detect the brand as the user types (live), or only on submit?
2. **Scope**: Which product categories should be prioritised in Phase 2 beyond TVs and CPUs? (e.g., washing machines, car audio, cameras, networking gear)
3. **Crowd-sourcing strategy**: GitHub PRs for pattern files is developer-friendly but not consumer-friendly. Should there be a simple web form for non-technical users to submit corrections?
4. **Monetisation / sustainability**: Ads? Sponsorship? Open-source only?
5. **LLM integration**: For Phase 3, is a local/offline LLM (via WebLLM / Transformers.js running in-browser) acceptable, or should it be strictly zero-dependency forever?

---

## 12. Accuracy & Disclaimer

Model number conventions are not standardised across or within brands. Manufacturers occasionally reuse patterns with different meanings, and regional variants complicate mappings. The site will always display a confidence level and encourage users to verify against official documentation for purchase or repair decisions.
