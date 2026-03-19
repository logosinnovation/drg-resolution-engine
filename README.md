# DRG Resolution Engine

A deterministic MS-DRG resolution engine for validating AI-generated clinical documentation improvement (CDI) recommendations. Built from primary CMS sources, validated against the CMS reference implementation.

## The Problem This Solves

AI diagnostic models flag charts where clinical evidence supports a higher-severity diagnosis than what was documented. A human reviewer must validate whether the AI's identification is both clinically accurate and coding-compliant.

The coding compliance check is where most validation workflows break down. AI models treat CC/MCC status as an **attribute** of a diagnosis code — "J9601 is always an MCC." This is wrong. CC/MCC status is a **property of a pair**: the principal diagnosis and the secondary diagnosis, evaluated through a 186,599-entry exclusion matrix organized into 1,994 PDX collections. A code that's an MCC on one chart is excluded on another depending on the principal.

This engine makes that pairwise evaluation visible, deterministic, and traceable.

## What It Does

The engine takes a principal diagnosis, existing secondary diagnoses, and an AI-suggested addition, then shows:

- **Before/After DRG comparison** — the current DRG vs. the DRG if the AI's suggestion is captured
- **Weight delta** — the exact reimbursement impact
- **Exclusion matrix audit** — whether the suggested code survives or is excluded by the specific principal on this chart, with the PDX collection number
- **Copyable audit trail** — a formatted text block documenting every step of the validation for compliance records

## Validation Summary

This engine has been validated at two independent layers:

| Layer | Method | Result |
|-------|--------|--------|
| CC/MCC data | Exact match against CMS IPPS FY2026 Tables 6I, 6J, 6K | 18,432 codes, 186,599 exclusion entries — zero discrepancies |
| DRG resolution logic | 408 test cases through CMS Java Grouper V43 | 408/408 match (100%) |

Full verification methodology is documented in [VERIFICATION.md](VERIFICATION.md).

## Quick Start

### Option 1: Browser (no install)

1. Download `drg-engine.html` and `drg_engine_v5.json`
2. Open the HTML file in Chrome
3. Click "Select File" and load the JSON

### Option 2: Local development

```bash
npm install
npm run dev
```

Open http://localhost:5173 and load `drg_engine_v5.json`.

### Option 3: Deploy to GitHub Pages

```bash
# Update base path in vite.config.js to match your repo name
npm run deploy
```

## Usage

### Validate Tab (Primary Workflow)

This is the daily-use mode for reviewing AI-flagged cases.

**Inputs:**
- **Principal Diagnosis** — the PDX from the chart (e.g., `I5022`)
- **Existing Secondaries** — current SDX codes, comma or space separated (e.g., `I4820, D62, E119`)
- **AI Suggestion** — the code the AI recommends capturing (e.g., `J9601`)

**Outputs:**
- Side-by-side DRG cards showing before and after
- Weight delta with VALID/NO CHANGE verdict
- Detailed evaluation of the AI-suggested code showing whether it survived the exclusion matrix
- Full list of all secondary evaluations
- Audit trail block with copy-to-clipboard

**Example — AI suggestion survives:**
> Principal: I5022 (Systolic heart failure, unspecified)
> AI suggests: J9601 (Acute respiratory failure with hypoxia)
> Result: DRG 293 → DRG 291, weight +0.4329, VALID
> J9601 survives as MCC — I5022 is not in PDX collection 219

**Example — AI suggestion is excluded:**
> Principal: I5021 (Acute on chronic systolic heart failure)
> AI suggests: I5022 (Chronic systolic heart failure)
> Result: DRG 293 → DRG 293, weight +0.0000, NO CHANGE
> I5022 CC excluded — I5021 IS in PDX collection 127

### Investigate Tab

Look up any ICD-10 code to see its CC/MCC status, PDX collection assignment, DRG routing as a principal, and the full exclusion list showing which principals would nullify it.

### Reference Tab

Browse all 770 MS-DRGs with FY2026 weights. Select any DRG to see its family, tier structure, and weight comparisons across severity levels.

## Engine Data

The data file (`drg_engine_v5.json`, ~10 MB) contains:

| Component | Count | Source |
|-----------|-------|--------|
| DRGs | 770 | CMS MS-DRG V43 Definitions Manual, Appendix A |
| DRG Families | 346 | MDC decision tables + Appendix B |
| CC/MCC Codes | 18,432 | IPPS FY2026 Tables 6I + 6J |
| PDX Collections | 1,994 | Appendix C + Table 6K |
| Exclusion Entries | 186,599 | Appendix C + Table 6K |
| Routed Diagnosis Codes | 65,807 | Appendix B + Pre-MDC resolution |
| No-Exclusion Codes | 41 | Appendix C Part 2/3 |
| FY2026 Weights | 770 | IPPS Table 5 |
| GMLOS / AMLOS | 770 | IPPS Table 5 |

## Architecture

The engine is a **pairwise relational query system**, not an attribute lookup.

```
ICD-10 code (principal)
  → Appendix B routing → MDC
    → MDC decision tables → DRG family
      → For each secondary:
          → Is it CC/MCC? (Tables 6I/6J)
          → PDX collection lookup (Table 6K)
          → Is the principal in this collection?
            → Yes: CC/MCC status REVOKED (excluded)
            → No: CC/MCC status SURVIVES
      → Highest surviving tier (MCC > CC > Base)
        → Family tier mapping → Specific DRG
          → Table 5 → Weight, GMLOS, AMLOS
```

### Tier Resolution Logic

DRG families have different tier structures. The engine handles all patterns:

| Pattern | MCC maps to | CC maps to | None maps to |
|---------|-------------|------------|--------------|
| `{mcc, cc, base}` | mcc | cc | base |
| `{mcc, without_mcc}` | mcc | without_mcc | without_mcc |
| `{cc_mcc, base}` | cc_mcc | cc_mcc | base |
| `{single}` | single | single | single |

### Special Cases

- **No-exclusion codes** (PDX collection = -1): 41 codes that always survive regardless of principal. Includes COVID pneumonia (J1282), vancomycin resistance (Z16xx), cytokine release syndrome (D8983x).
- **Pre-MDC routing**: 443 codes (diabetes E08-E13, CKD N18, transplant status Z94/Z96) pass through Pre-MDC logic before reaching their standard MDC. Resolved via CMS Grouper batch.
- **Condition-based splits**: Some DRG descriptions contain OR conditions (e.g., DRG 175 = "PE with MCC **or** Acute Cor Pulmonale"). These are handled with separate single-DRG families for the condition variant.

## CMS Data Sources

All data is parsed from primary CMS publications:

- [MS-DRG V43 Definitions Manual](https://www.cms.gov/files/zip/icd10-ms-drg-definitions-manual-files-v43.zip)
- [IPPS FY2026 Final Rule Table 5](https://www.cms.gov/medicare/payment/prospective-payment-systems/acute-inpatient-pps/fy2026-ipps-final-rule-home-page)
- [IPPS FY2026 Tables 6A-6K](https://www.cms.gov/medicare/payment/prospective-payment-systems/acute-inpatient-pps/fy2026-ipps-final-rule-home-page)
- [MS-DRG Java Grouper V43](https://www.cms.gov/medicare/payment/prospective-payment-systems/acute-inpatient-pps/ms-drg-classifications-and-software)

## License

This tool is built from publicly available CMS data. The CMS MS-DRG Definitions Manual and IPPS tables are government publications. The engine logic is an independent implementation, not a derivative of the CMS Java Grouper.
