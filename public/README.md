# CDI Validation Tool for AI Diagnostic Review

An open-source tool for Clinical Documentation Improvement specialists who review AI-generated diagnostic recommendations. Given a set of diagnosis codes and an AI-suggested addition, the tool shows whether the suggestion survives the CC/MCC exclusion matrix, what it does to the DRG, and what clinical evidence the chart needs to support it.

**Live demo:** [https://logosinnovation.github.io/drg-resolution-engine/](https://logosinnovation.github.io/drg-resolution-engine/)

## What This Is

A browser-based validation layer that sits between an AI diagnostic model and a human reviewer. When an AI flags a chart — "clinical evidence supports capturing J9601 (acute respiratory failure)" — this tool answers two questions:

1. **Does the code actually change the DRG?** The tool resolves the full CC/MCC exclusion matrix for the specific principal on this chart. A code that's an MCC in isolation may be excluded by this particular principal. The tool shows the pairwise evaluation, not just the code-level designation.

2. **What clinical evidence must be in the chart?** For supported diagnosis families, the tool displays the specific criteria (lab thresholds, vital signs, imaging findings), documentation requirements (what the physician must explicitly state), specificity opportunities (where a more precise code exists), and pre-written CDI query templates with source citations.

## What This Is Not

This is not a production DRG grouper. It does not handle ICD-10-PCS procedures, surgical DRG path selection, age/sex-dependent routing, Medicare Code Editor edits, Hospital Acquired Condition processing, or transfer payment adjustments. Companies that need a full grouper use the licensed CMS Java implementation or commercial equivalents.

This tool validates the **medical diagnosis coding logic** that CDI specialists review daily — the CC/MCC exclusion check that AI models frequently get wrong because they treat severity as a code attribute rather than a pairwise property.

## How It Works

Enter a principal diagnosis, existing secondaries, and the AI's suggested addition. The tool shows:

- **Before/After DRG comparison** with weight delta
- **Exclusion matrix audit** — whether each secondary survived or was excluded, with PDX collection numbers
- **Clinical criteria** (for supported families) — what the chart must contain, sourced to ICD-10 Guidelines and AHA Coding Clinic
- **CDI query templates** — pre-written physician queries for ambiguous cases
- **Copyable audit trail** — formatted documentation of the complete validation

### Example

> Principal: I5022 (Chronic systolic heart failure)
> AI suggests adding: J9601 (Acute respiratory failure with hypoxia)
>
> **Coding result:** J9601 survives as MCC — I5022 is not in PDX collection 219. DRG 293 → 291, weight +0.4329.
>
> **Clinical criteria required:** PaO2 < 60 mmHg, or SpO2 < 90% with acute onset, or P/F ratio < 300. Physician must explicitly document "acute respiratory failure" — "hypoxia" and "respiratory distress" are insufficient. *(Sources: ICD-10 Guidelines I.C.10.b, Coding Clinic Q2 2015 p.14)*

## Validation

### Data layer — exhaustive, not sampled

All CC/MCC data was parsed from primary CMS sources and cross-validated against authoritative IPPS FY2026 tables:

| Component | Count | Verified Against |
|-----------|-------|-----------------|
| CC/MCC codes | 18,432 | Tables 6I + 6J (exact match) |
| PDX exclusion collections | 1,994 | Table 6K (exact match) |
| Exclusion entries | 186,599 | Table 6K (exact match) |
| DRG weights | 770 | Table 5 (exact match) |

Zero discrepancies across all components.

### Resolution logic — every routable code tested

Every one of the 65,807 ICD-10 codes in the routing table was run as a principal diagnosis through the CMS Java Grouper V43 (the official reference implementation distributed by CMS/Solventum). Result: **65,807 / 65,807 match (100%)**.

This is not a sample. It is an exhaustive sweep of the entire routable code space under fixed demographics (age 65, male, routine discharge, no procedures).

**10 bugs were found and fixed during validation.** Each is documented in the Verification tab of the application with root cause, affected codes, and fix description. The bugs ranged from parser errors (comma in code counts dropping 5,573 fracture codes) to logic errors (CC tier falling to MCC via fallback instead of without_mcc) to routing errors (393 substance abuse codes assigned to the wrong DRG family). All were identified by comparing against the CMS Grouper, diagnosed from the data, fixed, and re-validated.

### What is NOT validated

- Surgical DRG path selection (requires ICD-10-PCS procedure codes — the tool shows both paths when they exist)
- Age-dependent routing (neonatal, pediatric)
- Sex-specific routing (obstetric)
- Discharge status effects (transfer logic, left AMA)
- Medicare Code Editor edits
- HAC/POA payment adjustments (POA is confirmed to not affect CC/MCC for DRG assignment)

The CC/MCC exclusion matrix — the core function of this tool — is demographics-independent and fully validated regardless of these limitations.

### Reproducibility

The `validation/` directory contains the Java test harnesses, GFC interface stubs, raw CMS Grouper output CSVs, and comparison scripts. Anyone with the CMS V43 JARs can independently reproduce the full 65,807-code validation.

## Data Sources

All data is parsed from publicly available CMS publications:

- **MS-DRG V43 Definitions Manual** — DRG definitions, family structures, routing tables, CC/MCC lists, exclusion collections
- **IPPS FY2026 Final Rule Tables 5, 6I, 6J, 6K** — weights, GMLOS/AMLOS, authoritative CC list, MCC list, complete exclusion matrix
- **CMS Java Grouper V43** — reference implementation used for validation (not redistributed)

## Clinical Criteria Database (In Progress)

The tool includes a tracer bullet for one clinical family (Respiratory Failure, 12 codes) with:

- Clinical criteria with thresholds and source citations
- Documentation requirements with insufficient terms
- Specificity ladder showing code differentiation
- CDI query templates with triggers
- Context modifiers (e.g., COPD baseline changes the evaluation)
- Common coding pitfalls

The full database covering all 18,432 CC/MCC codes across ~45 clinical families is under active development. Schema and build plan are documented in `docs/HANDOFF_CLINICAL_CRITERIA.md`.

## Project Structure

```
src/App.jsx                    ← React application
public/drg_engine_v5.json      ← Engine data (auto-loads)
drg-engine.html                ← Standalone version (no build needed)
VERIFICATION.md                ← Full verification methodology
docs/
  HANDOFF_CLINICAL_CRITERIA.md ← Clinical criteria database specification
validation/
  ValidateGrouper.java         ← 60 targeted test cases
  BroadValidation.java         ← 348 family sweep test cases
  FullValidation.java          ← Complete 65,807-code sweep
  gfc-src/                     ← GFC interface stubs (10 files)
  *.csv                        ← Raw CMS Grouper output
```

## Running Locally

```bash
npm install
npm run dev
# Opens at localhost:5173/drg-resolution-engine/
```

Or open `drg-engine.html` directly in a browser — no build step needed.

## License

Built from publicly available CMS data (U.S. government publications). The engine logic is an independent implementation. The CMS Java Grouper is used for validation only and is not redistributed.
