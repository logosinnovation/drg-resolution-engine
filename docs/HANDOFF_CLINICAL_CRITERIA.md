# Handoff: Clinical Criteria Database for CDI Validation

## Context — What Exists

A complete MS-DRG Resolution Engine has been built, validated, and deployed. It answers the **coding logic** question: "Does this ICD-10 code actually produce the claimed DRG upgrade on this specific chart?" It is validated 408/408 against the CMS Java Grouper V43 reference implementation.

### Current Engine (Complete)
- **Data**: 770 DRGs, 18,432 CC/MCC codes, 186,599 exclusion entries, 346 families, 65,807 routed codes, FY2026 weights
- **Validation**: CC/MCC layer exact-match against IPPS FY2026 Tables 6I/6J/6K; DRG resolution 408/408 against CMS Java Grouper V43
- **Application**: React app with Validate (before/after DRG comparison), Investigate (code lookup), Reference (DRG browser), Verification (proof chain) tabs
- **Files**: `drg_engine_v5.json` (9.9 MB), `drg-engine-v5.jsx` (App), deployed as GitHub Pages with auto-loading data

### What It Does NOT Do
The engine validates coding compliance — whether a code *changes the DRG*. It does not validate clinical support — whether the chart *supports the diagnosis*. This is the gap.

---

## What We Are Building

A **Clinical Criteria Database** that maps every CC/MCC code to the specific, sourced, auditable clinical evidence required to support it. No LLM involvement — this is a structured reference database. The user enters a diagnosis code, the system outputs exactly what clinical findings, lab values, vitals, imaging, and physician documentation must be present in the chart.

This completes the full CDI validation workflow:
1. **AI flags a case** — "Clinical evidence supports J9601 (acute respiratory failure) on this chart"
2. **Coding validation** (existing engine) — "Does J9601 survive the exclusion matrix with this principal? Yes → DRG 293→291, weight +0.4329"
3. **Clinical validation** (new database) — "Does the chart support J9601? Required: PaO2 < 60 mmHg OR SpO2 < 90% with acute onset, plus physician documentation explicitly stating 'acute respiratory failure.' Source: ICD-10-CM Guidelines I.C.10.b, AHA Coding Clinic Q2 2015 p.14"

The clinical validation is deterministic, not generative. Same code → same criteria → same output, every time. Every criterion traces to a published source.

---

## Scope

### All 18,432 CC/MCC codes, organized into ~40-50 clinical families

The ICD-10-CM code structure naturally groups codes into clinical categories. All 18,432 CC/MCC codes will be mapped to clinical families. The families share clinical criteria at the family level, with code-specific differentiation where CC/MCC tier depends on specificity.

### Distribution of the 18,432 codes by ICD-10 chapter:

| Chapter | Codes | Notes |
|---------|-------|-------|
| Injury (S) | 9,825 | Fractures, dislocations, vascular injuries — laterality/encounter variants |
| Musculoskeletal (M) | 1,442 | Pathological fractures, osteomyelitis |
| Injury/Poisoning (T) | 1,099 | Burns, poisoning, complications |
| Neoplasms (C/D0-D4) | 833 | Malignancy codes |
| Infectious (A/B) | 759 | Sepsis, meningitis, encephalitis, specific organisms |
| Circulatory (I) | 742 | HF, MI, stroke, PE, arrhythmias, aortic conditions |
| Pregnancy (O) | 656 | Obstetric complications |
| Digestive (K) | 407 | GI hemorrhage, pancreatitis, liver failure, intestinal ischemia |
| Skin (L) | 396 | Pressure ulcers, cellulitis, necrotizing fasciitis |
| Mental/Behavioral (F) | 338 | Substance abuse/dependence |
| Congenital (Q) | 293 | Congenital anomalies |
| Nervous System (G) | 271 | Encephalopathy, epilepsy, meningitis |
| Endocrine/Metabolic (E) | 265 | Diabetes complications, malnutrition, electrolytes |
| Eye (H0-H5) | 259 | Eye conditions with CC/MCC status |
| Genitourinary (N) | 185 | AKI, CKD, renal conditions |
| Perinatal (P) | 171 | Neonatal conditions |
| Blood/Immune (D5-D9) | 163 | DIC, sickle cell, coagulopathy, anemia |
| Respiratory (J) | 163 | Respiratory failure, pneumonia, COPD, ARDS |
| Signs/Symptoms (R) | 75 | Coma, severe sepsis (R65.2x), shock |
| Health Status (Z) | 57 | Transplant status, resistance codes |
| Ear (H6-H9) | 32 | Ear conditions |

### Key insight about the distribution:

9,825 of the 18,432 codes (53%) are injury codes (Chapter S). These are primarily fracture codes with laterality and encounter-type variants. A single clinical criteria family — "Fractures" — covers thousands of codes because the clinical evidence requirements are the same (imaging confirming fracture, type/location documentation, initial vs subsequent encounter distinction). The same pattern applies to burns (T31/T32) and obstetric codes (O chapter). This means ~40-50 clinical families can cover all 18,432 codes because the families are defined by clinical evaluation criteria, not by individual code.

---

## Database Schema

### Per Clinical Family:

```json
{
  "id": "resp_failure",
  "name": "Acute Respiratory Failure",
  "icd10_chapter": "J",
  "codes": ["J9600", "J9601", "J9602", "J9610", "J9611", "J9612", "J9620", "J9621", "J9622", "J9690", "J9691", "J9692"],
  "code_ranges": "J96.0x, J96.1x, J96.2x, J96.9x",
  "code_count": 12,
  
  "clinical_criteria": [
    {
      "id": "rf_abg_hypoxic",
      "category": "laboratory",
      "data_type": "ABG",
      "criterion": "PaO2 < 60 mmHg on room air",
      "detail": "Arterial blood gas showing hypoxemia. If on supplemental O2, documented PaO2/FiO2 ratio < 300 also qualifies.",
      "threshold": { "metric": "PaO2", "operator": "<", "value": 60, "unit": "mmHg" },
      "source": "ICD10_GUIDELINES",
      "source_detail": "Section I.C.10.b — Acute respiratory failure as principal or secondary diagnosis",
      "required": false,
      "evidence_weight": "strong"
    }
  ],
  
  "documentation_requirements": [
    {
      "id": "rf_doc_explicit",
      "requirement": "Physician must document 'acute respiratory failure' explicitly",
      "insufficient_terms": ["hypoxia", "respiratory distress", "shortness of breath", "desaturation"],
      "source": "CODING_CLINIC",
      "source_detail": "Q2 2015, p.14"
    }
  ],
  
  "specificity_ladder": [
    {
      "code": "J9601",
      "description": "Acute respiratory failure with hypoxia",
      "cc_mcc": "MCC",
      "distinguishing_evidence": "ABG PaO2 < 60 or SpO2 < 90% — hypoxic type",
      "upgrade_from": "J9600",
      "upgrade_evidence": "Specify hypoxia vs hypercapnia vs mixed based on ABG"
    },
    {
      "code": "J9602",
      "description": "Acute respiratory failure with hypercapnia",
      "cc_mcc": "MCC",
      "distinguishing_evidence": "ABG PaCO2 > 50 with pH < 7.35 — hypercapnic type",
      "upgrade_from": "J9600"
    },
    {
      "code": "J9600",
      "description": "Acute respiratory failure, unspecified whether with hypoxia or hypercapnia",
      "cc_mcc": "MCC",
      "specificity_note": "Same CC/MCC tier but less specific — query opportunity for type"
    },
    {
      "code": "J9620",
      "description": "Acute and chronic respiratory failure, unspecified",
      "cc_mcc": "MCC",
      "distinguishing_evidence": "Documented chronic respiratory failure baseline with acute worsening",
      "requires_both": ["Chronic baseline documented", "Acute exacerbation documented"]
    }
  ],
  
  "acuity_differentiation": {
    "acute": { "codes": ["J9600", "J9601", "J9602"], "evidence": "New onset, not present on prior encounters, identifiable precipitant" },
    "chronic": { "codes": ["J9610", "J9611", "J9612"], "evidence": "Longstanding, documented on prior encounters, on home O2" },
    "acute_on_chronic": { "codes": ["J9620", "J9621", "J9622"], "evidence": "BOTH chronic baseline AND acute worsening documented" }
  },
  
  "cdi_query_templates": [
    {
      "trigger": "ABG shows PaO2 < 60 but physician documents only 'hypoxia'",
      "query": "Based on the ABG findings of PaO2 [VALUE] mmHg, does the clinical presentation represent acute respiratory failure? If so, is this hypoxic, hypercapnic, or mixed type?",
      "source": "CODING_CLINIC Q2 2015 p.14"
    },
    {
      "trigger": "Patient on mechanical ventilation but no respiratory failure diagnosis",
      "query": "The patient was placed on mechanical ventilation on [DATE]. Does this represent acute respiratory failure? If so, please document the type (hypoxic/hypercapnic) and acuity (acute/chronic/acute-on-chronic).",
      "source": "CODING_CLINIC Q4 2017 p.23"
    },
    {
      "trigger": "SpO2 consistently < 90% without respiratory failure documented",
      "query": "Oxygen saturation has been documented at [VALUE]% requiring supplemental O2. Does this represent acute respiratory failure?",
      "source": "ICD10_GUIDELINES I.C.10.b"
    },
    {
      "trigger": "Documentation says 'respiratory failure' without acuity/type",
      "query": "You documented respiratory failure on [DATE]. For coding accuracy, could you clarify: (1) Is this acute, chronic, or acute-on-chronic? (2) Is this hypoxic (Type I), hypercapnic (Type II), or mixed?",
      "source": "ICD10_GUIDELINES I.C.10.b"
    }
  ],
  
  "common_pitfalls": [
    "COPD patients with chronic hypoxemia on home O2 — baseline SpO2 may be < 90% without acute failure",
    "Post-operative respiratory failure vs failure to wean — different coding implications",
    "Acute respiratory failure as principal vs secondary depends on circumstances of admission (Guidelines I.C.10.b)",
    "Respiratory failure in COVID — J96.0x plus U07.1; sequencing depends on reason for admission"
  ],
  
  "context_modifiers": {
    "with_copd": "Patient has chronic COPD — must document ACUTE worsening from their baseline, not just chronic hypoxemia",
    "with_obesity_hypoventilation": "Baseline hypercapnia may be present — need documented acute deterioration from their established PaCO2 baseline",
    "post_surgical": "Post-operative respiratory failure should also be coded with appropriate complication code (T81.x)"
  }
}
```

### Per Source Citation:

```json
{
  "source_key": {
    "ICD10_GUIDELINES": {
      "full_name": "ICD-10-CM Official Guidelines for Coding and Reporting, FY2026",
      "publisher": "CMS / NCHS",
      "url": "https://www.cms.gov/files/document/fy-2026-icd-10-cm-coding-guidelines.pdf",
      "authority": "Mandatory — required for all HIPAA-covered entities"
    },
    "CODING_CLINIC": {
      "full_name": "AHA Coding Clinic for ICD-10-CM/PCS",
      "publisher": "American Hospital Association",
      "authority": "Official guidance — recognized by CMS as authoritative",
      "note": "Individual issues cited as: CODING_CLINIC [Quarter] [Year] p.[Page]"
    },
    "SEPSIS3": {
      "full_name": "The Third International Consensus Definitions for Sepsis and Septic Shock (Sepsis-3)",
      "citation": "Singer M, et al. JAMA. 2016;315(8):801-810",
      "doi": "10.1001/jama.2016.0287",
      "authority": "Clinical society consensus — defines diagnostic criteria used in coding"
    },
    "KDIGO_AKI": {
      "full_name": "KDIGO Clinical Practice Guideline for Acute Kidney Injury",
      "citation": "Kidney Int Suppl. 2012;2:1-138",
      "authority": "Clinical society guideline — defines AKI staging criteria"
    },
    "ARDS_BERLIN": {
      "full_name": "Acute Respiratory Distress Syndrome: The Berlin Definition",
      "citation": "ARDS Definition Task Force. JAMA. 2012;307(23):2526-2533",
      "doi": "10.1001/jama.2012.5669"
    },
    "ACC_AHA_HF": {
      "full_name": "2022 AHA/ACC/HFSA Guideline for the Management of Heart Failure",
      "citation": "Heidenreich PA, et al. Circulation. 2022;145:e895-e1032"
    },
    "ACC_AHA_ACS": {
      "full_name": "2014 AHA/ACC Guideline for the Management of Patients With Non-ST-Elevation ACS + 2021 Chest Pain Guideline",
      "citation": "Amsterdam EA, et al. JACC. 2014;64(24):e139-e228"
    },
    "AHA_STROKE": {
      "full_name": "2019 AHA/ASA Guidelines for Early Management of Acute Ischemic Stroke",
      "citation": "Powers WJ, et al. Stroke. 2019;50:e46-e110"
    },
    "NPUAP": {
      "full_name": "National Pressure Ulcer Advisory Panel Staging System",
      "citation": "NPUAP/EPUAP/PPPIA. Prevention and Treatment of Pressure Ulcers/Injuries: Clinical Practice Guideline, 3rd Ed. 2019"
    },
    "ASPEN": {
      "full_name": "ASPEN/AND Clinical Guidelines: Nutrition Screening, Assessment, and Intervention in Adults",
      "citation": "Mueller C, et al. JPEN. 2011;35(1):16-24 + AND/ASPEN Malnutrition Characteristics 2012"
    },
    "ISTH_DIC": {
      "full_name": "ISTH Scoring System for Disseminated Intravascular Coagulation",
      "citation": "Taylor FB, et al. Thromb Haemost. 2001;86:1327-1330"
    },
    "GOLD": {
      "full_name": "Global Initiative for Chronic Obstructive Lung Disease",
      "citation": "GOLD 2024 Report — Global Strategy for Prevention, Diagnosis and Management of COPD"
    },
    "ATS_IDSA_CAP": {
      "full_name": "Diagnosis and Treatment of Adults with Community-acquired Pneumonia",
      "citation": "Metlay JP, et al. Am J Respir Crit Care Med. 2019;200(7):e45-e67"
    },
    "AASLD_LIVER": {
      "full_name": "AASLD Practice Guidelines for Hepatic Encephalopathy / Acute Liver Failure",
      "citation": "Vilstrup H, et al. Hepatology. 2014;60(2):715-735"
    },
    "AGA_PANCREATITIS": {
      "full_name": "AGA Institute Technical Review on Acute Pancreatitis",
      "citation": "Crockett SD, et al. Gastroenterology. 2018;154(4):1096-1101"
    },
    "ESC_PE": {
      "full_name": "2019 ESC Guidelines for Diagnosis and Management of Acute Pulmonary Embolism",
      "citation": "Konstantinides SV, et al. Eur Heart J. 2020;41(4):543-603"
    }
  }
}
```

---

## Proposed Clinical Families (~45)

### Tier 1: Highest CDI Impact (build first, 10 families)

These are the diagnoses most commonly flagged by AI as underdocumented and that most frequently change DRG tier. Build with full criteria, documentation requirements, specificity ladders, CDI query templates, and all citations.

| # | Family | Key Codes | CC/MCC | Guideline Sources |
|---|--------|-----------|--------|-------------------|
| 1 | Respiratory Failure | J96.0x-J96.9x (12 codes) | MCC/CC | ICD-10 Guidelines I.C.10.b, Coding Clinic |
| 2 | Sepsis / Severe Sepsis / Septic Shock | A41.x, R65.2x (19 codes) | MCC | ICD-10 Guidelines I.C.1.d, Sepsis-3 |
| 3 | Acute Kidney Injury | N17.x (5 codes) | MCC/CC | KDIGO AKI, Coding Clinic |
| 4 | Heart Failure | I50.x (19 codes) | MCC/CC | ACC/AHA HF 2022, ICD-10 Guidelines I.C.9.a |
| 5 | Acute MI (STEMI/NSTEMI) | I21.x (13 codes) | MCC | ACC/AHA ACS, Coding Clinic |
| 6 | Cerebral Infarction (Stroke) | I63.x (91 codes) | MCC | AHA Stroke 2019, ICD-10 Guidelines |
| 7 | Malnutrition | E40-E46 (5 codes) | MCC/CC | ASPEN/AND, Coding Clinic |
| 8 | Pneumonia | J13-J18 (24 codes) | MCC (organism-specific) | ATS/IDSA CAP, Coding Clinic |
| 9 | Pressure Ulcers | L89.x (50 codes) | MCC (stage 3/4) | NPUAP 2019, ICD-10 Guidelines I.C.12.a |
| 10 | Encephalopathy | G93.x, G92.x (12 codes) | MCC/CC | Coding Clinic, AASLD |

### Tier 2: High Impact (build second, 15 families)

| # | Family | Key Codes | CC/MCC | Guideline Sources |
|---|--------|-----------|--------|-------------------|
| 11 | COPD / Asthma Exacerbation | J44.x, J45.x | CC | GOLD 2024, Coding Clinic |
| 12 | Pulmonary Embolism | I26.x (12 codes) | MCC | ESC PE 2019 |
| 13 | Atrial Fibrillation / Flutter | I48.x (7 codes) | CC | ACC/AHA AFib Guidelines |
| 14 | GI Hemorrhage | K92.x, K25-K28 (varies) | CC/MCC | Coding Clinic |
| 15 | Acute Pancreatitis | K85.x (18 codes) | MCC | AGA 2018 |
| 16 | Hepatic Failure / Encephalopathy | K72.x (4 codes) | MCC | AASLD |
| 17 | DIC / Coagulopathy | D65, D68.x (26 codes) | MCC/CC | ISTH DIC |
| 18 | Acute Blood Loss Anemia | D62 (1 code) | CC | Coding Clinic |
| 19 | Diabetes with Complications | E08-E13 (~265 codes) | MCC/CC by complication | ICD-10 Guidelines I.C.4.a, Coding Clinic |
| 20 | Electrolyte Disorders | E87.x (8 codes) | CC | Coding Clinic |
| 21 | Sickle Cell Crisis | D57.x (36 codes) | MCC | Coding Clinic |
| 22 | Cardiac Arrest | I46.x (3 codes) | MCC (Part 2: alive only) | Coding Clinic |
| 23 | Shock (cardiogenic, hypovolemic) | R57.x (4 codes) | MCC | Coding Clinic |
| 24 | ARDS | J80 (1 code) | MCC | Berlin Definition |
| 25 | Intestinal Ischemia | K55.x (26 codes) | MCC/CC | Coding Clinic |

### Tier 3: Broad Coverage (build third, ~20 families covering remaining codes)

| # | Family | Codes | Notes |
|---|--------|-------|-------|
| 26 | Fractures (traumatic) | S02-S92 (~7,000+ codes) | Single family — criteria are imaging + type/location/laterality + encounter type |
| 27 | Pathological Fractures | M80, M84 (~1,400 codes) | Distinguished from traumatic by underlying cause |
| 28 | Burns / Corrosions | T20-T32 (~1,000 codes) | TBSA + depth + location |
| 29 | Spinal Cord Injury | S14, S24, S34 (~93 codes) | Level + completeness |
| 30 | Traumatic Brain Injury | S06.x (~208 codes) | GCS + LOC + imaging |
| 31 | Vascular Injuries | S15, S25, S35, S45, S55, S65, S75, S85, S95 (~300 codes) | Imaging + vessel identification |
| 32 | Open Wounds with Penetration | S11, S21, S31 (~130 codes) | Depth + organ involvement |
| 33 | Meningitis / Encephalitis | A39, A83, A84, G00-G04 (~75 codes) | CSF analysis + culture + imaging |
| 34 | Specific Infections (C. diff, MRSA, etc.) | A04, B95, Z16 (~70 codes) | Culture + susceptibility |
| 35 | Neoplasms with CC/MCC | C00-D49 (~833 codes) | Pathology + staging + treatment context |
| 36 | Obstetric Complications | O00-O9A (~656 codes) | Trimester + complication type |
| 37 | Perinatal Conditions | P00-P96 (~171 codes) | Birth weight + gestational age + condition |
| 38 | Congenital Anomalies | Q00-Q99 (~293 codes) | Diagnostic imaging/testing + documentation |
| 39 | Substance Use Disorders | F10-F19 (~338 codes) | Withdrawal criteria + use/abuse/dependence distinction |
| 40 | Epilepsy / Status Epilepticus | G40.x (~50 codes) | EEG + clinical presentation + intractability |
| 41 | Eye Conditions | H00-H59 (~259 codes) | Ophthalmologic examination findings |
| 42 | Aortic Conditions | I71.x (~19 codes) | Imaging (CT angiography) + type/location |
| 43 | Cerebrovascular Hemorrhage | I60-I62 (~27 codes) | Imaging + location + etiology |
| 44 | Postprocedural Complications | T81.x (~76 codes) | Linked procedure + complication documentation |
| 45 | CKD / Renal Conditions | N18.x + N00-N08 (~30 codes) | GFR staging + etiology documentation |

---

## Build Sequence

### Phase 1: Schema + Family Clustering
- Finalize the JSON schema (per the structure above)
- Programmatically map all 18,432 codes to their clinical family using ICD-10 category structure + existing CC/MCC data
- Output: `clinical_criteria_v1.json` with all codes assigned to families, but criteria populated only for Tier 1

### Phase 2: Tier 1 Families (10 families, ~230 codes)
- Build complete clinical criteria for all 10 Tier 1 families
- Each family gets: clinical criteria with thresholds, documentation requirements, specificity ladders, CDI query templates, context modifiers, common pitfalls
- Every criterion gets a source citation
- Validate criteria against published guidelines (user reviews for clinical accuracy)

### Phase 3: Tier 2 Families (15 families, ~450 codes)
- Same depth as Tier 1
- More specialized guideline sources (ESC, AGA, AASLD)

### Phase 4: Tier 3 Families (~20 families, ~17,750 codes)
- These are the large-volume families (fractures = 7,000+ codes alone)
- Criteria are simpler (imaging + documentation) but must handle the laterality/encounter-type specificity correctly

### Phase 5: App Integration
- Add "Clinical Evidence" panel to the Validate tab
- When a case is validated, every code on the claim shows its clinical criteria
- The AI-suggested code gets prominent display: "To support J9601, the chart must contain..."
- CDI query templates pre-populated with the case context
- Audit trail extended to include clinical criteria checks

---

## Integration with Existing Engine

The clinical criteria database is a **separate data file** (`clinical_criteria_v1.json`) loaded alongside `drg_engine_v5.json`. The app loads both. The Validate tab becomes:

```
CASE ENTRY: Principal + Secondaries + AI Suggestion
    ↓
CODING VALIDATION (existing engine):
  - Before/After DRG comparison
  - Exclusion matrix audit
  - Weight delta
    ↓
CLINICAL VALIDATION (new database):
  - For the AI-suggested code: required clinical criteria with thresholds
  - Documentation requirements + insufficient terms
  - Specificity ladder (is there a more specific code that changes tier?)
  - CDI query template if evidence is ambiguous
    ↓
AUDIT TRAIL (combined):
  - Coding logic: deterministic, CMS-sourced
  - Clinical criteria: guideline-sourced, per-code
  - Both copyable for compliance documentation
```

---

## Existing Project Files

All available in the project zip and outputs directory:

| File | Purpose |
|------|---------|
| `drg_engine_v5.json` | Complete engine data (9.9 MB) — 770 DRGs, 18,432 CC/MCC, 186,599 exclusions, FY2026 weights |
| `drg-engine-v5.jsx` | React application (741 lines) — Validate, Investigate, Reference, Verification tabs |
| `README.md` | Project overview + usage + architecture |
| `VERIFICATION.md` | Full verification methodology — 3-layer proof chain |
| `validation/ValidateGrouper.java` | 60 targeted CMS Grouper test cases |
| `validation/BroadValidation.java` | 348 family coverage test cases |
| `validation/compare_results.py` | Diff script: CMS output vs engine |
| `validation/cms_grouper_results.csv` | Raw CMS Grouper output (60 cases) |
| `validation/broad_validation_results.csv` | Raw CMS Grouper output (348 cases) |
| `validation/gfc-src/` | GFC interface stubs (10 Java files) |

### CMS Data Sources Used
- MS-DRG V43 Definitions Manual (851k lines, 9 text files)
- IPPS FY2026 Table 5 (weights, GMLOS, AMLOS)
- IPPS FY2026 Tables 6I/6J/6K (CC list, MCC list, exclusion matrix)
- CMS Java Grouper V43 (msdrg-v430-43.0.0.2.jar)

---

## Target Use Case

SmarterDx Clinical Operations Specialist role — validates AI diagnostic model output for CDI. The AI identifies cases where clinical evidence supports a higher-severity diagnosis than documented. The specialist validates whether the identification is both clinically and coding-compliant.

This tool provides both halves:
- **Coding compliance**: deterministic, validated against CMS reference implementation
- **Clinical compliance**: structured, sourced, every criterion traceable to published guideline

The complete workflow in one application. No external references needed. Every output auditable.

---

## Authoritative Source References (to retrieve in next session)

These are the primary sources that will be used to populate clinical criteria. The new session should retrieve and parse these:

1. **ICD-10-CM Official Guidelines FY2026** — the mandatory coding standard
2. **AHA Coding Clinic** — official guidance, issue-specific citations needed for each criterion
3. **Sepsis-3 (JAMA 2016)** — sepsis/severe sepsis/septic shock definitions
4. **KDIGO AKI (2012)** — acute kidney injury staging
5. **Berlin Definition (JAMA 2012)** — ARDS criteria
6. **ACC/AHA HF 2022** — heart failure classification and criteria
7. **ACC/AHA ACS 2014/2021** — acute coronary syndrome criteria
8. **AHA/ASA Stroke 2019** — cerebral infarction criteria
9. **NPUAP/EPUAP/PPPIA 2019** — pressure ulcer staging
10. **ASPEN/AND 2012** — malnutrition diagnostic criteria
11. **GOLD 2024** — COPD classification
12. **ESC PE 2019** — pulmonary embolism criteria
13. **ISTH DIC 2001** — disseminated intravascular coagulation scoring
14. **AGA 2018** — acute pancreatitis criteria
15. **AASLD 2014** — hepatic encephalopathy / liver failure criteria

---

## Engine Data Schema (`drg_engine_v5.json`)

The next session must understand the internal structure to programmatically map all 18,432 codes to clinical families. Here is the exact key structure:

```json
{
  "version": "5.0",

  "drgs": {
    "291": [5, "medical", "Heart Failure and Shock with MCC"],
    "292": [5, "medical", "Heart Failure and Shock with CC"],
    // key = DRG number (string), value = [mdc, type, description]
    // 770 entries
  },

  "cc": {
    "J9601": ["MCC", 219],
    "I4820": ["CC", 139],
    "J1282": ["MCC", -1],
    // key = ICD-10 code, value = [level, pdx_collection_number]
    // level = "MCC" or "CC"
    // pdx_collection_number = integer, or -1 for no-exclusion codes (always survive)
    // 18,432 entries
  },

  "pdx": {
    "219": ["I5020", "I5021", "I5022", "I5023", ...],
    // key = PDX collection number (string), value = array of principal diagnosis codes
    // If a principal is in this array, the secondary's CC/MCC status is REVOKED
    // 1,994 collections, 186,599 total entries
  },

  "families": {
    "f291": ["Heart Failure and Shock", 5, "medical", {"mcc": 291, "cc": 292, "base": 293}],
    "f193": ["Simple Pneumonia and Pleurisy", 4, "medical", {"mcc": 193, "cc": 194, "base": 195}],
    "f535": ["Fractures of Hip and Pelvis", 8, "medical", {"mcc": 535, "without_mcc": 536}],
    // key = family ID, value = [name, mdc, type, tiers]
    // tiers can have keys: mcc, cc, base, without_mcc, cc_mcc, single
    // 346 families
  },

  "routing": {
    "I5022": ["f291"],
    "J189": ["f193"],
    "N179": [{"f": "f673", "m": 11, "t": "surgical"}, {"f": "f682", "m": 11, "t": "medical"}, ...],
    // key = ICD-10 code, value = array of family references
    // Simple: array of family ID strings
    // Multi-route: array of objects {f: familyId, m: mdc, t: type}
    // 65,807 entries
  },

  "weights": {
    "291": 1.7565,
    "292": 1.3236,
    // key = DRG number (string), value = relative weight (float)
    // 770 entries
  },

  "gmlos": {
    "291": 4.8,
    // key = DRG number, value = geometric mean length of stay
  },

  "amlos": {
    "291": 5.9,
    // key = DRG number, value = arithmetic mean length of stay
  },

  "descriptions": {
    "J9601": "Acute respiratory failure with hypoxia",
    "I5022": "Chronic systolic (congestive) heart failure",
    // key = ICD-10 code, value = description string
    // ~65,000+ entries (all routed codes + CC/MCC codes)
  },

  "integrity": {
    "version": "5.0",
    "cms_version": "V43",
    "fy": 2026,
    "cc_mcc_total": 18432,
    "mcc_count": 3354,
    "cc_count": 15078,
    "no_excl_count": 41,
    "pdx_collections": 1994,
    "exclusion_entries": 186599,
    "families": 346,
    "routing_total": 65807,
    "validated": true,
    "cms_grouper_validation": {
      "test_cases": 408,
      "matches": 408
    }
  }
}
```

### Key patterns for programmatic family clustering:

To map all 18,432 CC/MCC codes to clinical families, iterate `data.cc` and group by ICD-10 category:
- First 3 characters of the code define the ICD-10 category (e.g., J96 = respiratory failure, A41 = sepsis, N17 = AKI)
- Some families span multiple 3-char categories (e.g., "Sepsis" covers A41 + R65 + A40 + A02 + B37 + etc.)
- The `data.descriptions` field provides the clinical description for label generation
- Use the existing `data.cc[code][0]` for MCC vs CC designation within each family

---

## Key Design Decisions from This Build

These decisions affect how the clinical criteria database integrates:

### 1. CC/MCC is pairwise, not attribute-level
A code's CC/MCC status depends on the (principal, secondary) pair. The clinical criteria database needs to be aware that meeting clinical criteria is necessary but not sufficient — the code must also survive the exclusion matrix for a specific principal. The app workflow is: clinical criteria check → exclusion matrix check → DRG resolution.

### 2. pdx = -1 means no exclusions
41 codes have PDX collection -1 in `data.cc`. These always survive regardless of principal. Includes COVID pneumonia (J1282), vancomycin resistance (Z16xx), cytokine release (D8983x), homelessness (Z59xx). The clinical criteria for these codes don't need exclusion-context modifiers.

### 3. Tier resolution fallback chain
When a CC secondary exists but the family has no explicit `cc` tier:
- `{mcc, cc, base}` → CC maps to `cc`
- `{mcc, without_mcc}` → CC maps to `without_mcc`
- `{cc_mcc, base}` → CC maps to `cc_mcc`
- `{single}` → CC maps to `single`

This matters for the clinical criteria display: when a code is CC but the family only has MCC/without_mcc tiers, the specificity ladder should note that upgrading from CC to MCC would change the DRG, but CC alone doesn't differentiate from base.

### 4. Condition-based DRG splits exist
Not all DRG family splits are severity-based. DRG 175 = "PE with MCC **or** Acute Cor Pulmonale" — the "or" means certain principal codes (I260*) always get DRG 175 regardless of secondaries. The clinical criteria database needs to flag these: "This code inherently satisfies the DRG tier requirement due to its clinical condition, not due to CC/MCC severity."

### 5. Multi-route codes show all paths
6,514 codes route to both surgical and medical families. The app shows all paths. The clinical criteria database applies to the diagnosis regardless of which DRG path is taken — clinical evidence for "acute respiratory failure" is the same whether the patient is on a surgical or medical DRG.

### 6. POA does NOT gate CC/MCC for DRG assignment
Confirmed via CMS Grouper testing: POA=N codes still count for CC/MCC severity and DRG assignment. POA only triggers HAC (Hospital-Acquired Condition) processing. The clinical criteria database should include POA-related documentation requirements but should not treat POA as a clinical criteria gating factor.

---

## Files to Upload to Next Session

Upload these files when starting the new chat:

1. **This document** (`HANDOFF_CLINICAL_CRITERIA.md`) — the complete specification
2. **`drg_engine_v5.json`** (9.9 MB) — the engine data, needed for programmatic code-to-family mapping
3. **`drg-engine-v5.jsx`** — the current React app code, needed for UI integration in Phase 5

Optionally also upload:
4. **`VERIFICATION.md`** — the proof chain documentation, for reference when building the clinical criteria verification methodology
5. **`README.md`** — project overview, for reference

### First instruction to the new session:

> "I'm building a Clinical Criteria Database for CDI validation. The handoff document (HANDOFF_CLINICAL_CRITERIA.md) contains the complete specification — read it fully before starting. The drg_engine_v5.json contains the existing engine data with all 18,432 CC/MCC codes that need to be mapped to clinical families. Start with Phase 1: schema finalization + programmatic family clustering of all 18,432 codes."

---

## What Success Looks Like

When complete, a CDI specialist using this tool enters a case and sees:

**For the AI-suggested code (e.g., J9601 — Acute respiratory failure with hypoxia):**

> **Clinical Criteria Required:**
> - PaO2 < 60 mmHg on ABG (Source: ICD-10 Guidelines I.C.10.b)
> - OR SpO2 < 90% with documented acute onset (Source: ICD-10 Guidelines I.C.10.b)
> - OR PaO2/FiO2 ratio < 300 on supplemental O2 (Source: ICD-10 Guidelines I.C.10.b)
> - OR initiation of mechanical ventilation for respiratory failure (Source: Coding Clinic Q4 2017 p.23)
>
> **Documentation Required:**
> - Physician must explicitly document "acute respiratory failure" (Source: Coding Clinic Q2 2015 p.14)
> - "Hypoxia," "respiratory distress," and "desaturation" are INSUFFICIENT
> - Must specify type: hypoxic (J9601), hypercapnic (J9602), or unspecified (J9600)
>
> **Specificity Opportunity:**
> - J9600 (unspecified) → J9601 (hypoxic) or J9602 (hypercapnic): same MCC tier, but more specific code preferred. Query if ABG available but type not specified.
> - J9601 (acute) → J9621 (acute on chronic): same MCC tier, but requires documented chronic baseline. Query if patient has known chronic respiratory failure.
>
> **CDI Query (if evidence is ambiguous):**
> "ABG shows PaO2 of [VALUE] mmHg. Does the clinical presentation represent acute respiratory failure? If so, is this hypoxic (Type I), hypercapnic (Type II), or mixed?"
> Source: Coding Clinic Q2 2015 p.14
>
> **Coding Validation:**
> ✓ J9601 survives as MCC — principal I5022 is NOT in PDX collection 219
> Before: DRG 293 (weight 0.9236) → After: DRG 291 (weight 1.7565) — Delta: +0.8329
>
> **Context Alert:**
> Patient has COPD (J44.1) on chart — must document ACUTE worsening from chronic baseline, not just chronic hypoxemia.
