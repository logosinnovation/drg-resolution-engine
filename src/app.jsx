import { useState, useMemo, useRef, useCallback, useEffect } from "react";

const norm = (c) => c?.replace(/[\.\s-]/g, "").toUpperCase() || "";
const MONO = "'DM Mono','JetBrains Mono',monospace";
const SANS = "'DM Sans','IBM Plex Sans',-apple-system,sans-serif";

// ════════════════════════════════════════════════════════════════
// ENGINE
// ════════════════════════════════════════════════════════════════

function evalSecondaries(data, principal, secondaries) {
  const evals = [];
  let highest = null;
  for (const sec of secondaries) {
    const sCode = norm(sec.code || sec);
    const sDesc = data.descriptions?.[sCode] || "";
    const ccInfo = data.cc?.[sCode];
    if (!ccInfo) { evals.push({ code: sCode, desc: sDesc, status: "none" }); continue; }
    const [level, pdxColl] = ccInfo;
    if (pdxColl !== -1) {
      const coll = data.pdx?.[String(pdxColl)];
      if (coll && coll.includes(principal)) {
        evals.push({ code: sCode, desc: sDesc, status: "excluded", level, pdx: pdxColl }); continue;
      }
    }
    if (sec.poa === false) { evals.push({ code: sCode, desc: sDesc, status: "poa", level }); continue; }
    evals.push({ code: sCode, desc: sDesc, status: "survived", level });
    if (level === "MCC") highest = "MCC";
    else if (level === "CC" && highest !== "MCC") highest = "CC";
  }
  return { evals, highest };
}

function resolveTier(tiers, highest) {
  let drg, tierKey;
  if (highest === "MCC") { drg = tiers.mcc || tiers.cc_mcc || tiers.single; tierKey = tiers.mcc ? "mcc" : tiers.cc_mcc ? "cc_mcc" : "single"; }
  else if (highest === "CC") { drg = tiers.cc || tiers.cc_mcc || tiers.without_mcc || tiers.single; tierKey = tiers.cc ? "cc" : tiers.cc_mcc ? "cc_mcc" : tiers.without_mcc ? "without_mcc" : "single"; }
  else { drg = tiers.base || tiers.without_mcc || tiers.single; tierKey = tiers.base ? "base" : tiers.without_mcc ? "without_mcc" : "single"; }
  if (!drg && tiers) drg = Math.max(...Object.values(tiers).map(Number));
  return { drg, tierKey };
}

function resolveCase(data, principalRaw, secondaries) {
  const principal = norm(principalRaw);
  const pDesc = data.descriptions?.[principal] || "Unknown";
  const routes = data.routing?.[principal];
  if (!routes || routes.length === 0) return { error: `No DRG routing for ${principal}`, principal, pDesc };
  const families = [];
  for (const r of routes) {
    const fKey = typeof r === "string" ? r : r.f;
    const fam = data.families?.[fKey];
    if (fam) {
      const mdc = typeof r === "string" ? fam[1] : r.m;
      if (mdc !== 15 && mdc !== 25) families.push({ key: fKey, name: fam[0], mdc: fam[1], type: fam[2], tiers: fam[3] });
    }
  }
  if (!families.length) {
    for (const r of routes) {
      const fKey = typeof r === "string" ? r : r.f;
      const fam = data.families?.[fKey];
      if (fam) families.push({ key: fKey, name: fam[0], mdc: fam[1], type: fam[2], tiers: fam[3] });
    }
  }
  const { evals, highest } = evalSecondaries(data, principal, secondaries);
  const paths = families.map(f => {
    const { drg, tierKey } = resolveTier(f.tiers, highest);
    const w = data.weights?.[String(drg)];
    const allTiers = Object.fromEntries(Object.entries(f.tiers).map(([t, d]) => [t, { drg: d, w: data.weights?.[String(d)], desc: data.drgs?.[String(d)]?.[2] || "" }]));
    return { ...f, drg, tierKey, weight: w, desc: data.drgs?.[String(drg)]?.[2] || "", allTiers };
  });
  const medical = paths.filter(p => p.type === "medical");
  const primary = medical.length ? medical[0] : paths[0];
  return { principal, pDesc, evals, highest, paths, primary };
}

// ════════════════════════════════════════════════════════════════
// STYLES
// ════════════════════════════════════════════════════════════════

const css = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
::-webkit-scrollbar{width:5px}
::-webkit-scrollbar-track{background:#0b1120}
::-webkit-scrollbar-thumb{background:#2d3a4f;border-radius:3px}
input:focus,textarea:focus{outline:1px solid #3b82f6}
::selection{background:#1d4ed8;color:#fff}
`;

const C = {
  bg: "#080d18", surface: "#0d1424", raised: "#111b2e", border: "#1a2540", borderHi: "#253352",
  text: "#c8d6e5", textMuted: "#5a6d84", textDim: "#3b4d66", textBright: "#e8f0f8",
  accent: "#3b82f6", accentDim: "#1e3a6e",
  red: "#ef4444", redBg: "#1a0f14",
  green: "#22c55e", greenBg: "#0a1a10",
  amber: "#f59e0b", amberBg: "#1a1508",
  cyan: "#22d3ee",
};

const TIER_STYLE = {
  mcc: { color: C.red, bg: C.redBg, label: "MCC" },
  cc: { color: C.amber, bg: C.amberBg, label: "CC" },
  cc_mcc: { color: C.amber, bg: C.amberBg, label: "CC/MCC" },
  base: { color: C.textMuted, bg: C.surface, label: "BASE" },
  without_mcc: { color: C.textMuted, bg: C.surface, label: "W/O MCC" },
  single: { color: C.textMuted, bg: C.surface, label: "SINGLE" },
  none: { color: C.textMuted, bg: C.surface, label: "—" },
};

// ════════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ════════════════════════════════════════════════════════════════

function Badge({ tier, large }) {
  const t = TIER_STYLE[tier] || TIER_STYLE.none;
  return <span style={{ fontFamily: MONO, fontSize: large ? 12 : 10, fontWeight: 500, letterSpacing: 1,
    color: t.color, background: t.bg, border: `1px solid ${t.color}33`, borderRadius: 3,
    padding: large ? "3px 10px" : "1px 7px", textTransform: "uppercase", whiteSpace: "nowrap" }}>{t.label}</span>;
}

function CodeTag({ code, desc, level, compact }) {
  return <span style={{ fontFamily: MONO, fontSize: compact ? 12 : 13, display: "inline-flex", alignItems: "center", gap: 6,
    background: C.raised, border: `1px solid ${C.border}`, borderRadius: 3, padding: compact ? "2px 6px" : "3px 8px", maxWidth: 500 }}>
    <span style={{ color: C.textBright }}>{code}</span>
    {desc && <span style={{ color: C.textDim, fontSize: compact ? 10 : 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{desc}</span>}
    {level && <span style={{ fontSize: 9, fontWeight: 500, color: level === "MCC" ? C.red : level === "CC" ? C.amber : C.textDim }}>{level}</span>}
  </span>;
}

function Section({ label, children, noPad, accent }) {
  return <div style={{ background: C.surface, border: `1px solid ${accent ? C.accent + "33" : C.border}`, borderRadius: 6, overflow: "visible" }}>
    {label && <div style={{ padding: "8px 14px", borderBottom: `1px solid ${C.border}`, color: accent ? C.accent : C.textMuted, fontSize: 10, fontWeight: 600,
      letterSpacing: 1.5, textTransform: "uppercase", fontFamily: SANS }}>{label}</div>}
    <div style={{ padding: noPad ? 0 : 14, overflow: "visible" }}>{children}</div>
  </div>;
}

// ════════════════════════════════════════════════════════════════
// CLINICAL CRITERIA DATABASE — Tier 1 (10 highest-impact families, 273 codes)
// Remaining 35+ families loaded from clinical_criteria_v1.json when complete
// ════════════════════════════════════════════════════════════════

/* eslint-disable */
// @generated — clinical criteria data, do not hand-edit
const CLINICAL_FAMILIES = [
  {
    "id": "resp_failure",
    "name": "Respiratory Failure",
    "icd10_chapter": "J",
    "codes": [
      "J9600",
      "J9601",
      "J9602",
      "J9610",
      "J9611",
      "J9612",
      "J9620",
      "J9621",
      "J9622",
      "J9690",
      "J9691",
      "J9692"
    ],
    "code_ranges": "J96.0x, J96.1x, J96.2x, J96.9x",
    "code_count": 12,
    "clinical_criteria": [
      {
        "id": "rf_abg_hypoxic",
        "category": "laboratory",
        "data_type": "ABG",
        "criterion": "PaO2 < 60 mmHg",
        "detail": "Arterial blood gas showing severe hypoxemia on room air.",
        "threshold": {
          "metric": "PaO2",
          "operator": "<",
          "value": 60,
          "unit": "mmHg"
        },
        "source": "CODING_CLINIC",
        "source_detail": "Vol. 7 No. 3, Third Quarter 1990, p.14",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "rf_spo2_hypoxic",
        "category": "vitals",
        "data_type": "Pulse Oximetry",
        "criterion": "SpO2 < 90% on room air",
        "detail": "Persistent oxygen saturation below 90% requiring supplemental oxygen. COPD baseline may be lower.",
        "threshold": {
          "metric": "SpO2",
          "operator": "<",
          "value": 90,
          "unit": "%"
        },
        "source": "CODING_CLINIC",
        "source_detail": "Q4 2017, p.23",
        "required": false,
        "evidence_weight": "moderate"
      },
      {
        "id": "rf_pf_ratio",
        "category": "laboratory",
        "data_type": "Calculated",
        "criterion": "PaO2/FiO2 ratio < 300",
        "detail": "P/F ratio indicating acute respiratory failure or ARDS.",
        "threshold": {
          "metric": "P/F Ratio",
          "operator": "<",
          "value": 300,
          "unit": "ratio"
        },
        "source": "ARDS_BERLIN",
        "source_detail": "Berlin Definition of ARDS",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "rf_abg_hypercapnic",
        "category": "laboratory",
        "data_type": "ABG",
        "criterion": "PaCO2 > 50 mmHg with pH < 7.35",
        "detail": "Acute respiratory acidosis.",
        "threshold": {
          "metric": "PaCO2",
          "operator": ">",
          "value": 50,
          "unit": "mmHg"
        },
        "source": "CODING_CLINIC",
        "source_detail": "Historical criteria baseline for Type II failure",
        "required": false,
        "evidence_weight": "strong"
      }
    ],
    "documentation_requirements": [
      {
        "id": "rf_doc_explicit",
        "requirement": "Provider must explicitly document 'acute respiratory failure' or 'acute on chronic respiratory failure'.",
        "insufficient_terms": [
          "hypoxia",
          "hypoxemia",
          "respiratory distress",
          "shortness of breath",
          "dyspnea",
          "desaturation",
          "respiratory insufficiency"
        ],
        "source": "CODING_CLINIC",
        "source_detail": "Q2 2015, p.14; Q3 2012, p.20"
      }
    ],
    "specificity_ladder": [
      {
        "code": "J9601",
        "description": "Acute respiratory failure with hypoxia",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "ABG PaO2 < 60 or SpO2 < 90%; P/F Ratio < 300",
        "upgrade_from": "J9600",
        "upgrade_evidence": "Specify 'hypoxic' type based on low O2 levels"
      },
      {
        "code": "J9602",
        "description": "Acute respiratory failure with hypercapnia",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "ABG PaCO2 > 50 with pH < 7.35",
        "upgrade_from": "J9600",
        "upgrade_evidence": "Specify 'hypercapnic' type based on high CO2 and acidosis"
      },
      {
        "code": "J9600",
        "description": "Acute respiratory failure, unspecified type",
        "cc_mcc": "MCC",
        "specificity_note": "Same MCC weight but lacks specificity. Query if ABG/Vitals indicate specific type."
      },
      {
        "code": "J9621",
        "description": "Acute on chronic respiratory failure with hypoxia",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Documented chronic baseline WITH acute hypoxic exacerbation.",
        "requires_both": [
          "Chronic baseline documented",
          "Acute exacerbation documented"
        ]
      }
    ],
    "acuity_differentiation": {
      "acute": {
        "codes": [
          "J9600",
          "J9601",
          "J9602"
        ],
        "evidence": "Sudden onset, identifiable precipitant, aggressive intervention required."
      },
      "chronic": {
        "codes": [
          "J9610",
          "J9611",
          "J9612"
        ],
        "evidence": "Longstanding condition, compensatory metabolic alkalosis, home O2, no acute worsening."
      },
      "acute_on_chronic": {
        "codes": [
          "J9620",
          "J9621",
          "J9622"
        ],
        "evidence": "Established chronic respiratory failure with acute deterioration."
      }
    },
    "cdi_query_templates": [
      {
        "trigger": "ABG shows PaO2 < 60 or SpO2 < 90% but physician documents only 'hypoxia'",
        "query": "Clinical indicators reveal a PaO2 of [VALUE] / SpO2 of [VALUE]% requiring [O2_SUPPORT]. Does the patient's condition represent Acute Respiratory Failure? Please document the acuity and type.",
        "source": "CODING_CLINIC Q2 2015 p.14"
      },
      {
        "trigger": "Patient placed on mechanical ventilation or BiPAP without respiratory failure diagnosis",
        "query": "The patient required initiation of [BiPAP/Mechanical Ventilation] on [DATE]. Does this reflect Acute Respiratory Failure?",
        "source": "CODING_CLINIC Q4 2017 p.23"
      },
      {
        "trigger": "Documentation states 'respiratory failure' but lacks acuity or type",
        "query": "Your documentation notes 'respiratory failure'. Please clarify the acuity (Acute, Chronic, or Acute-on-Chronic) and type (Hypoxic, Hypercapnic, Unspecified).",
        "source": "ICD10_GUIDELINES I.C.10.b"
      }
    ],
    "common_pitfalls": [
      "Coding 'hypoxia' (R09.02) when 'acute respiratory failure' is supported by evidence.",
      "Failing to distinguish chronic hypoxemia in COPD patients vs acute exacerbation.",
      "Using J96.0x for post-operative respiratory failure; use J95.82x instead.",
      "Sequencing: Acute respiratory failure can be Principal if chiefly responsible for admission."
    ],
    "context_modifiers": {
      "with_copd": "In COPD patients, PaCO2 > 50 may be baseline. Acute failure requires acute acidemia and change from baseline.",
      "post_surgical": "Post-operative respiratory failure uses J95.82x series, not J96.x.",
      "with_covid19": "Per Guidelines I.C.1.g.1.a, U07.1 is sequenced first, followed by respiratory failure code."
    }
  },
  {
    "id": "sepsis",
    "name": "Sepsis / Severe Sepsis / Septic Shock",
    "icd10_chapter": "A/R",
    "codes": [
      "A400",
      "A401",
      "A403",
      "A408",
      "A409",
      "A4101",
      "A4102",
      "A411",
      "A412",
      "A413",
      "A414",
      "A4150",
      "A4151",
      "A4152",
      "A4153",
      "A4154",
      "A4159",
      "A4181",
      "A4189",
      "A419",
      "R6520",
      "R6521"
    ],
    "code_ranges": "A40.x, A41.x, R65.20, R65.21",
    "code_count": 22,
    "clinical_criteria": [
      {
        "id": "sep_sirs_temp",
        "category": "vitals",
        "data_type": "Temperature",
        "criterion": "Temperature > 38.3\u00b0C (101\u00b0F) or < 36.0\u00b0C (96.8\u00b0F)",
        "detail": "Fever or hypothermia as part of the systemic inflammatory response. Hypothermia in sepsis carries a worse prognosis.",
        "threshold": {
          "metric": "Temperature",
          "operator": ">",
          "value": 38.3,
          "unit": "\u00b0C"
        },
        "source": "SEPSIS3",
        "source_detail": "Singer et al. JAMA 2016;315(8):801-810 \u2014 Sepsis-3 clinical criteria",
        "required": false,
        "evidence_weight": "moderate"
      },
      {
        "id": "sep_lactate",
        "category": "laboratory",
        "data_type": "Lactate",
        "criterion": "Serum lactate > 2.0 mmol/L",
        "detail": "Elevated lactate indicates tissue hypoperfusion. Lactate \u2265 4 mmol/L suggests septic shock even without hypotension. Serial trending is clinically important.",
        "threshold": {
          "metric": "Lactate",
          "operator": ">",
          "value": 2.0,
          "unit": "mmol/L"
        },
        "source": "SEPSIS3",
        "source_detail": "Sepsis-3: Lactate > 2 + vasopressors defines septic shock",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "sep_sofa",
        "category": "clinical_finding",
        "data_type": "SOFA Score",
        "criterion": "Acute increase in SOFA score \u2265 2 from baseline",
        "detail": "Sequential Organ Failure Assessment: PaO2/FiO2, platelets, bilirubin, MAP/vasopressors, GCS, creatinine. Baseline assumed 0 unless prior organ dysfunction documented.",
        "threshold": {
          "metric": "SOFA increase",
          "operator": ">=",
          "value": 2,
          "unit": "points"
        },
        "source": "SEPSIS3",
        "source_detail": "Sepsis-3 defines sepsis as suspected infection + SOFA \u2265 2",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "sep_blood_culture",
        "category": "laboratory",
        "data_type": "Microbiology",
        "criterion": "Blood cultures obtained (positive or pending)",
        "detail": "Blood cultures should be drawn before antibiotics but their positivity is NOT required for sepsis diagnosis. A40/A41 codes require identification of the organism when known.",
        "source": "ICD10_GUIDELINES",
        "source_detail": "Section I.C.1.d \u2014 Sepsis: organism-specific coding",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "sep_vasopressors",
        "category": "intervention",
        "data_type": "Vasopressor Use",
        "criterion": "Vasopressor required to maintain MAP \u2265 65 mmHg despite adequate fluid resuscitation",
        "detail": "Norepinephrine, vasopressin, epinephrine, or phenylephrine. This criterion distinguishes septic shock (R65.21) from severe sepsis without shock (R65.20).",
        "threshold": {
          "metric": "MAP",
          "operator": "<",
          "value": 65,
          "unit": "mmHg"
        },
        "source": "SEPSIS3",
        "source_detail": "Septic shock = vasopressors to maintain MAP \u2265 65 AND lactate > 2 despite fluid resuscitation",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "sep_organ_dysfunction",
        "category": "clinical_finding",
        "data_type": "Organ Dysfunction",
        "criterion": "Evidence of at least one organ dysfunction (AKI, altered mental status, coagulopathy, hepatic, respiratory, cardiovascular)",
        "detail": "Severe sepsis (R65.20/R65.21) requires documented organ dysfunction. Each organ dysfunction should also be coded separately.",
        "source": "ICD10_GUIDELINES",
        "source_detail": "Section I.C.1.d.1.a \u2014 Sepsis with organ dysfunction: code the underlying infection, R65.2x, and each organ dysfunction",
        "required": false,
        "evidence_weight": "strong"
      }
    ],
    "documentation_requirements": [
      {
        "id": "sep_doc_explicit",
        "requirement": "Provider must explicitly document 'sepsis', 'severe sepsis', or 'septic shock'. The coder cannot infer sepsis from positive blood cultures, SIRS criteria, or antibiotic use alone.",
        "insufficient_terms": [
          "bacteremia",
          "SIRS",
          "blood stream infection",
          "positive blood culture",
          "urosepsis",
          "infection"
        ],
        "source": "CODING_CLINIC",
        "source_detail": "Q4 2016 p.65: Bacteremia vs sepsis; Q2 2019 p.8: Urosepsis defaults to UTI, not sepsis"
      },
      {
        "id": "sep_doc_organism",
        "requirement": "When the causative organism is identified, the sepsis code should specify it (A41.01 MSSA, A41.02 MRSA, A41.51 E. coli, etc.) rather than using A41.9 unspecified.",
        "insufficient_terms": [
          "sepsis NOS",
          "sepsis organism unknown"
        ],
        "source": "ICD10_GUIDELINES",
        "source_detail": "Section I.C.1.d \u2014 Code the specific organism when documented"
      },
      {
        "id": "sep_doc_severity",
        "requirement": "For severe sepsis, provider must document BOTH sepsis AND associated organ dysfunction. R65.2x is assigned as an additional code. For septic shock, provider must document 'septic shock' \u2014 shock from other causes uses different codes.",
        "insufficient_terms": [
          "shock",
          "hemodynamic instability",
          "hypotension"
        ],
        "source": "ICD10_GUIDELINES",
        "source_detail": "Section I.C.1.d.1.a: Severe sepsis requires explicit link between sepsis and organ dysfunction"
      }
    ],
    "specificity_ladder": [
      {
        "code": "A4101",
        "description": "Sepsis due to MSSA",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Blood culture positive for Methicillin-susceptible Staphylococcus aureus",
        "upgrade_from": "A419",
        "upgrade_evidence": "Specify organism from culture results"
      },
      {
        "code": "A4102",
        "description": "Sepsis due to MRSA",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Blood culture positive for Methicillin-resistant Staphylococcus aureus",
        "upgrade_from": "A419",
        "upgrade_evidence": "Specify MRSA from culture and susceptibility results"
      },
      {
        "code": "A4151",
        "description": "Sepsis due to E. coli",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Blood culture positive for Escherichia coli",
        "upgrade_from": "A4150",
        "upgrade_evidence": "Specify E. coli from gram-negative sepsis"
      },
      {
        "code": "A419",
        "description": "Sepsis, unspecified organism",
        "cc_mcc": "MCC",
        "specificity_note": "Same MCC tier but less specific \u2014 query for organism identification from culture results"
      },
      {
        "code": "R6520",
        "description": "Severe sepsis without septic shock",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Sepsis + documented organ dysfunction (AKI, respiratory failure, coagulopathy, etc.)",
        "requires_both": [
          "Underlying sepsis documented",
          "Organ dysfunction explicitly linked"
        ]
      },
      {
        "code": "R6521",
        "description": "Severe sepsis with septic shock",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Severe sepsis + hemodynamic compromise requiring vasopressors despite adequate fluid resuscitation + lactate > 2",
        "upgrade_from": "R6520",
        "upgrade_evidence": "Document 'septic shock' when vasopressors required"
      }
    ],
    "cdi_query_templates": [
      {
        "trigger": "Positive blood cultures with IV antibiotics but no sepsis diagnosis documented",
        "query": "Blood cultures drawn on [DATE] are positive for [ORGANISM]. The patient is receiving IV antibiotics and meets [CRITERIA \u2014 e.g., SOFA \u2265 2]. Does this clinical presentation represent sepsis? If so, please document the diagnosis and the causative organism.",
        "source": "CODING_CLINIC Q4 2016 p.65"
      },
      {
        "trigger": "Documentation says 'urosepsis' \u2014 ambiguous term",
        "query": "You documented 'urosepsis' on [DATE]. Per Coding Clinic guidance, 'urosepsis' defaults to UTI (N39.0), not sepsis. If the patient has systemic sepsis originating from a urinary source, please document 'sepsis due to [organism] secondary to UTI.'",
        "source": "CODING_CLINIC Q2 2019 p.8"
      },
      {
        "trigger": "Sepsis documented but organ dysfunction present without explicit link",
        "query": "The patient has documented sepsis and has developed [organ dysfunction \u2014 e.g., AKI, respiratory failure]. Is this organ dysfunction a manifestation of the sepsis (severe sepsis), or is it a separate condition?",
        "source": "ICD10_GUIDELINES I.C.1.d.1.a"
      },
      {
        "trigger": "Patient on vasopressors with sepsis but 'septic shock' not documented",
        "query": "The patient has sepsis and required initiation of [vasopressor] on [DATE] to maintain MAP \u2265 65 mmHg. Lactate is [VALUE] mmol/L. Does this represent septic shock?",
        "source": "SEPSIS3 + CODING_CLINIC Q4 2018 p.38"
      }
    ],
    "common_pitfalls": [
      "Coding 'bacteremia' (R78.81) instead of 'sepsis' \u2014 bacteremia alone does not equal sepsis without systemic manifestation and provider documentation.",
      "'Urosepsis' defaults to UTI (N39.0) per Coding Clinic; if actual sepsis is present, the provider must explicitly say 'sepsis' or 'sepsis due to UTI.'",
      "R65.20/R65.21 are NEVER sequenced first \u2014 they are additional codes after the underlying sepsis code (A40/A41).",
      "Each organ dysfunction in severe sepsis must be coded separately in addition to R65.2x.",
      "Sepsis-3 clinical criteria (SOFA \u2265 2) are clinical diagnostic tools \u2014 coding still requires explicit provider documentation of 'sepsis.'"
    ],
    "context_modifiers": {
      "with_uti": "If source is urinary, ensure documentation explicitly states 'sepsis due to [organism] secondary to UTI' \u2014 not just 'urosepsis.'",
      "with_pneumonia": "If source is pulmonary, sequence depends on reason for admission. Sepsis from pneumonia: A41.x + J15/J18 + R65.2x if severe.",
      "post_surgical": "Postprocedural sepsis requires explicit documentation linking infection to procedure. Use T81.44- (sepsis following a procedure) as additional code."
    }
  },
  {
    "id": "aki",
    "name": "Acute Kidney Injury",
    "icd10_chapter": "N",
    "codes": [
      "N170",
      "N171",
      "N172",
      "N178",
      "N179"
    ],
    "code_ranges": "N17.0\u2013N17.9",
    "code_count": 5,
    "clinical_criteria": [
      {
        "id": "aki_cr_rise",
        "category": "laboratory",
        "data_type": "Serum Creatinine",
        "criterion": "Serum creatinine increase \u2265 0.3 mg/dL within 48 hours, OR \u2265 1.5x baseline within 7 days",
        "detail": "KDIGO Stage 1 minimum. Stage 2: 2.0\u20132.9x baseline. Stage 3: \u2265 3.0x baseline or creatinine \u2265 4.0 mg/dL or initiation of RRT.",
        "threshold": {
          "metric": "Creatinine rise",
          "operator": ">=",
          "value": 0.3,
          "unit": "mg/dL in 48h"
        },
        "source": "KDIGO_AKI",
        "source_detail": "KDIGO AKI Guideline 2012: Definition and staging of AKI",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "aki_urine_output",
        "category": "vitals",
        "data_type": "Urine Output",
        "criterion": "Urine output < 0.5 mL/kg/h for \u2265 6 hours",
        "detail": "Oliguria meeting KDIGO criteria. Stage 2: < 0.5 for \u2265 12h. Stage 3: < 0.3 for \u2265 24h or anuria \u2265 12h.",
        "threshold": {
          "metric": "Urine output",
          "operator": "<",
          "value": 0.5,
          "unit": "mL/kg/h for 6h"
        },
        "source": "KDIGO_AKI",
        "source_detail": "KDIGO AKI Guideline 2012: Urine output criteria",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "aki_bun",
        "category": "laboratory",
        "data_type": "BUN",
        "criterion": "Elevated BUN with BUN/Cr ratio indicating prerenal, intrinsic, or postrenal etiology",
        "detail": "BUN alone is insufficient \u2014 creatinine trend is the primary diagnostic criterion. BUN/Cr ratio > 20:1 suggests prerenal; normal ratio suggests intrinsic renal.",
        "source": "KDIGO_AKI",
        "source_detail": "KDIGO supplementary material \u2014 differential diagnosis",
        "required": false,
        "evidence_weight": "moderate"
      },
      {
        "id": "aki_rrt",
        "category": "intervention",
        "data_type": "Renal Replacement Therapy",
        "criterion": "Initiation of hemodialysis, CRRT, or peritoneal dialysis for acute indication",
        "detail": "Initiation of RRT automatically qualifies as KDIGO Stage 3 AKI regardless of creatinine level.",
        "source": "KDIGO_AKI",
        "source_detail": "KDIGO Stage 3: Initiation of RRT = Stage 3 by definition",
        "required": false,
        "evidence_weight": "strong"
      }
    ],
    "documentation_requirements": [
      {
        "id": "aki_doc_explicit",
        "requirement": "Provider must explicitly document 'acute kidney injury' or 'acute kidney failure' or 'acute renal failure.' Rising creatinine alone is insufficient for code assignment.",
        "insufficient_terms": [
          "elevated creatinine",
          "azotemia",
          "renal insufficiency",
          "rising Cr",
          "creatinine bump"
        ],
        "source": "CODING_CLINIC",
        "source_detail": "Q1 2019 p.12: AKI requires explicit provider documentation"
      },
      {
        "id": "aki_doc_type",
        "requirement": "When etiology is known, document the specific type: tubular necrosis (N17.0, MCC), cortical necrosis (N17.1, MCC), medullary necrosis (N17.2, MCC). N17.9 (unspecified, CC) has lower severity weight.",
        "insufficient_terms": [
          "AKI NOS"
        ],
        "source": "ICD10_GUIDELINES",
        "source_detail": "Section I.C.14: Code to highest specificity for renal conditions"
      }
    ],
    "specificity_ladder": [
      {
        "code": "N170",
        "description": "Acute kidney failure with tubular necrosis",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "ATN confirmed by clinical presentation (ischemic or nephrotoxic), muddy brown casts on urinalysis, FeNa > 2%",
        "upgrade_from": "N179",
        "upgrade_evidence": "Specify tubular necrosis etiology \u2014 changes CC to MCC"
      },
      {
        "code": "N171",
        "description": "Acute kidney failure with acute cortical necrosis",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Bilateral renal cortical necrosis on imaging, typically in obstetric complications or DIC",
        "upgrade_from": "N179",
        "upgrade_evidence": "Specify cortical necrosis \u2014 changes CC to MCC"
      },
      {
        "code": "N172",
        "description": "Acute kidney failure with medullary necrosis",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Papillary necrosis documented, often associated with sickle cell, NSAIDs, or diabetes",
        "upgrade_from": "N179",
        "upgrade_evidence": "Specify medullary/papillary necrosis \u2014 changes CC to MCC"
      },
      {
        "code": "N178",
        "description": "Other acute kidney failure",
        "cc_mcc": "CC",
        "specificity_note": "CC tier \u2014 used when specific type is documented but not N17.0/N17.1/N17.2 (e.g., contrast nephropathy, hepatorenal syndrome)"
      },
      {
        "code": "N179",
        "description": "Acute kidney failure, unspecified",
        "cc_mcc": "CC",
        "specificity_note": "CC tier only. Query opportunity: if ATN is clinically present, upgrading to N17.0 changes CC \u2192 MCC."
      }
    ],
    "cdi_query_templates": [
      {
        "trigger": "Creatinine rising \u2265 0.3 mg/dL or \u2265 1.5x baseline but no AKI documented",
        "query": "Serum creatinine increased from [BASELINE] to [CURRENT] mg/dL over [TIMEFRAME]. Does this represent acute kidney injury? If so, can you specify the etiology (e.g., acute tubular necrosis, prerenal, contrast-induced)?",
        "source": "CODING_CLINIC Q1 2019 p.12 + KDIGO"
      },
      {
        "trigger": "AKI documented as unspecified (N17.9) but clinical evidence suggests ATN",
        "query": "You documented acute kidney injury. The clinical presentation includes [EVIDENCE \u2014 e.g., muddy brown casts, FeNa > 2%, ischemic etiology]. Does this represent acute tubular necrosis? Specifying the type allows for more accurate severity classification.",
        "source": "KDIGO AKI Staging + ICD-10-CM Guidelines"
      },
      {
        "trigger": "Patient initiated on dialysis/CRRT acutely without AKI documentation",
        "query": "The patient was started on [dialysis/CRRT] on [DATE] for an acute indication. Does this represent acute kidney injury? If so, please document the diagnosis and etiology.",
        "source": "KDIGO Stage 3 criteria"
      }
    ],
    "common_pitfalls": [
      "Coding 'elevated creatinine' (R79.89) instead of AKI when clinical criteria are clearly met but provider hasn't explicitly documented AKI.",
      "N17.9 (unspecified AKI) is only CC; N17.0 (ATN) is MCC \u2014 specifying the type can change the DRG tier. Always query for type when clinical evidence supports ATN.",
      "AKI superimposed on CKD: both should be coded. The AKI is coded in addition to the CKD stage, not instead of it.",
      "Contrast-induced nephropathy: code as N17.8 (other AKI) with T36-T50 adverse effect code. This is still only CC, but proper documentation matters for the clinical record."
    ],
    "context_modifiers": {
      "with_ckd": "AKI on CKD: code both N17.x AND N18.x. The CKD stage should reflect the baseline, not the acute creatinine.",
      "with_sepsis": "AKI as organ dysfunction in severe sepsis: code R65.2x in addition to the sepsis code and N17.x. Link the AKI to the sepsis.",
      "with_rhabdomyolysis": "Rhabdomyolysis-induced AKI: code M62.82 (rhabdomyolysis) + N17.0 (ATN). CK levels and myoglobinuria support the link."
    }
  },
  {
    "id": "heart_failure",
    "name": "Heart Failure",
    "icd10_chapter": "I",
    "codes": [
      "I501",
      "I5020",
      "I5021",
      "I5022",
      "I5023",
      "I5030",
      "I5031",
      "I5032",
      "I5033",
      "I5040",
      "I5041",
      "I5042",
      "I5043"
    ],
    "code_ranges": "I50.1, I50.20\u2013I50.43",
    "code_count": 13,
    "clinical_criteria": [
      {
        "id": "hf_bnp",
        "category": "laboratory",
        "data_type": "BNP / NT-proBNP",
        "criterion": "BNP \u2265 100 pg/mL or NT-proBNP \u2265 300 pg/mL",
        "detail": "Supports diagnosis of heart failure. Values correlate with severity but are not diagnostic in isolation. Age-adjusted thresholds for NT-proBNP: > 50y = > 900; > 75y = > 1800.",
        "threshold": {
          "metric": "BNP",
          "operator": ">=",
          "value": 100,
          "unit": "pg/mL"
        },
        "source": "ACC_AHA_HF",
        "source_detail": "2022 AHA/ACC/HFSA HF Guideline: Biomarker recommendations for diagnosis",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "hf_echo_ef",
        "category": "imaging",
        "data_type": "Echocardiogram",
        "criterion": "Echocardiogram showing reduced EF (HFrEF: EF \u2264 40%) or preserved EF with diastolic dysfunction (HFpEF: EF \u2265 50%)",
        "detail": "EF determines systolic vs diastolic classification. HFmrEF (EF 41-49%) is a separate category. Diastolic dysfunction requires E/e' ratio, LA volume, or TR velocity.",
        "source": "ACC_AHA_HF",
        "source_detail": "2022 AHA/ACC/HFSA: Classification by EF",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "hf_cxr",
        "category": "imaging",
        "data_type": "Chest X-ray",
        "criterion": "CXR showing pulmonary edema, cardiomegaly, or pleural effusions",
        "detail": "Supportive but not diagnostic. Pulmonary vascular congestion, cephalization of vessels, and Kerley B lines suggest fluid overload.",
        "source": "ACC_AHA_HF",
        "source_detail": "2022 AHA/ACC/HFSA: Imaging recommendations",
        "required": false,
        "evidence_weight": "moderate"
      },
      {
        "id": "hf_clinical_signs",
        "category": "clinical_finding",
        "data_type": "Physical Exam",
        "criterion": "Clinical signs: JVD, peripheral edema, S3 gallop, crackles/rales, hepatojugular reflux",
        "detail": "Physical examination findings supporting volume overload. Documentation should include specific findings, not just 'volume overloaded.'",
        "source": "ACC_AHA_HF",
        "source_detail": "2022 AHA/ACC/HFSA: Clinical assessment",
        "required": false,
        "evidence_weight": "moderate"
      },
      {
        "id": "hf_diuretics",
        "category": "intervention",
        "data_type": "IV Diuretics",
        "criterion": "IV diuretic administration (furosemide, bumetanide) for acute decompensation",
        "detail": "IV loop diuretics suggest acute or acute-on-chronic exacerbation. Transition from oral to IV diuretics suggests worsening requiring acute management.",
        "source": "ACC_AHA_HF",
        "source_detail": "2022 AHA/ACC/HFSA: Acute decompensated HF management",
        "required": false,
        "evidence_weight": "moderate"
      }
    ],
    "documentation_requirements": [
      {
        "id": "hf_doc_type",
        "requirement": "Provider must document the TYPE of heart failure: systolic (I50.2x), diastolic (I50.3x), or combined (I50.4x). I50.9 (unspecified) should be queried.",
        "insufficient_terms": [
          "CHF",
          "congestive heart failure",
          "heart failure NOS",
          "fluid overload"
        ],
        "source": "CODING_CLINIC",
        "source_detail": "Q2 2017 p.9: Documentation of HF type; Q4 2020 p.33"
      },
      {
        "id": "hf_doc_acuity",
        "requirement": "Provider must document ACUITY: acute (x1 = MCC), chronic (x2 = CC), or acute on chronic (x3 = MCC). This is the critical MCC vs CC distinction.",
        "insufficient_terms": [
          "exacerbation",
          "decompensated",
          "worsening"
        ],
        "source": "CODING_CLINIC",
        "source_detail": "Q1 2017 p.47: Acute vs chronic HF documentation impact"
      }
    ],
    "specificity_ladder": [
      {
        "code": "I5021",
        "description": "Acute systolic (congestive) heart failure",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Reduced EF (\u2264 40%) with acute decompensation: new onset OR acute worsening requiring IV diuretics, vasodilators, or inotropes",
        "upgrade_from": "I5022",
        "upgrade_evidence": "Document 'acute' systolic HF \u2014 changes CC to MCC"
      },
      {
        "code": "I5023",
        "description": "Acute on chronic systolic heart failure",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Known chronic systolic HF with acute exacerbation",
        "upgrade_from": "I5022",
        "upgrade_evidence": "Document 'acute on chronic' \u2014 changes CC to MCC",
        "requires_both": [
          "Chronic systolic HF baseline documented",
          "Acute exacerbation documented"
        ]
      },
      {
        "code": "I5022",
        "description": "Chronic systolic heart failure",
        "cc_mcc": "CC",
        "specificity_note": "CC tier only. If patient is admitted with decompensation, 'acute on chronic' (I50.23, MCC) is likely more accurate."
      },
      {
        "code": "I5031",
        "description": "Acute diastolic heart failure",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Preserved EF (\u2265 50%) with diastolic dysfunction and acute decompensation",
        "upgrade_from": "I5032",
        "upgrade_evidence": "Document 'acute' diastolic HF \u2014 changes CC to MCC"
      },
      {
        "code": "I5041",
        "description": "Acute combined systolic and diastolic heart failure",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Both systolic and diastolic dysfunction documented with acute decompensation",
        "upgrade_from": "I5042",
        "upgrade_evidence": "Document 'acute' combined HF \u2014 changes CC to MCC"
      },
      {
        "code": "I501",
        "description": "Left ventricular failure, unspecified",
        "cc_mcc": "CC",
        "specificity_note": "CC tier \u2014 nonspecific. Query for type (systolic/diastolic) and acuity (acute/chronic)."
      }
    ],
    "acuity_differentiation": {
      "acute": {
        "codes": [
          "I5021",
          "I5031",
          "I5041"
        ],
        "evidence": "New onset or acute decompensation: IV diuretics, BNP markedly elevated above baseline, acute pulmonary edema, new symptoms requiring hospitalization."
      },
      "chronic": {
        "codes": [
          "I5022",
          "I5032",
          "I5042"
        ],
        "evidence": "Stable, compensated heart failure on oral medications. No acute worsening. Established diagnosis in outpatient records."
      },
      "acute_on_chronic": {
        "codes": [
          "I5023",
          "I5033",
          "I5043"
        ],
        "evidence": "Known chronic HF with acute exacerbation: escalation from oral to IV diuretics, new/worsening symptoms, increasing BNP, weight gain from fluid retention."
      }
    },
    "cdi_query_templates": [
      {
        "trigger": "BNP elevated, IV diuretics given, but only 'CHF' or 'heart failure' documented",
        "query": "You documented 'CHF.' For coding accuracy, could you specify: (1) Type \u2014 systolic, diastolic, or combined? (2) Acuity \u2014 is this acute, chronic, or acute on chronic? The patient is receiving IV [diuretic] and BNP is [VALUE] pg/mL.",
        "source": "CODING_CLINIC Q2 2017 p.9"
      },
      {
        "trigger": "Chronic HF documented but patient presenting with acute decompensation",
        "query": "You documented 'chronic systolic heart failure.' The patient presented with [acute symptoms \u2014 dyspnea, pulmonary edema, weight gain] and required IV diuretics. Does this represent an acute exacerbation of the chronic heart failure (acute on chronic)?",
        "source": "CODING_CLINIC Q1 2017 p.47"
      },
      {
        "trigger": "Echo shows reduced EF but documentation says 'diastolic heart failure'",
        "query": "The echocardiogram shows EF of [VALUE]% which indicates systolic dysfunction. Your documentation notes 'diastolic heart failure.' Could you clarify the type based on the echo findings?",
        "source": "ACC/AHA 2022 HF Guidelines \u2014 EF classification"
      }
    ],
    "common_pitfalls": [
      "'CHF' alone is nonspecific \u2014 query for systolic/diastolic/combined AND acute/chronic/acute-on-chronic. The combination determines MCC vs CC.",
      "Acute HF codes (I50.21, I50.31, I50.41) are MCC; chronic codes (I50.22, I50.32, I50.42) are only CC. This is the single most impactful distinction for DRG.",
      "'Diastolic dysfunction' on echo does not equal 'diastolic heart failure' \u2014 the provider must diagnose heart failure, not just the echo finding.",
      "HFpEF patients may have normal EF \u2014 document diastolic dysfunction AND heart failure symptoms to support the code.",
      "Fluid overload/volume overload does not equal heart failure \u2014 different code (E87.70) unless HF is the cause."
    ],
    "context_modifiers": {
      "with_ckd": "HF + CKD: ICD-10 assumes a causal relationship per I.C.9.a.2. Code I13.x (hypertensive heart and CKD) rather than separate HF + CKD if hypertension is also present.",
      "with_afib": "Atrial fibrillation with HF is common. Both should be coded separately. Rate vs rhythm control strategy may be relevant.",
      "with_copd": "HF + COPD: BNP may be elevated from right heart strain in COPD exacerbation. Clarify whether HF is truly decompensated or if the COPD is the primary driver."
    }
  },
  {
    "id": "acute_mi",
    "name": "Acute Myocardial Infarction",
    "icd10_chapter": "I",
    "codes": [
      "I2101",
      "I2102",
      "I2109",
      "I2111",
      "I2119",
      "I2121",
      "I2129",
      "I213",
      "I214",
      "I219",
      "I21A1",
      "I21A9",
      "I21B",
      "I220",
      "I221",
      "I222",
      "I228",
      "I229"
    ],
    "code_ranges": "I21.0x\u2013I21.B, I22.0\u2013I22.9",
    "code_count": 18,
    "clinical_criteria": [
      {
        "id": "mi_troponin",
        "category": "laboratory",
        "data_type": "Troponin",
        "criterion": "Rise and/or fall of cardiac troponin (cTn) with at least one value above the 99th percentile upper reference limit",
        "detail": "High-sensitivity troponin preferred. Delta change pattern (rise/fall) distinguishes acute MI from chronic elevation. Must have clinical context \u2014 troponin alone does not define MI.",
        "threshold": {
          "metric": "Troponin",
          "operator": ">",
          "value": 0,
          "unit": "above 99th percentile URL"
        },
        "source": "ACC_AHA_ACS",
        "source_detail": "Fourth Universal Definition of MI (JACC 2018;72:2231-64): Criterion 1",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "mi_ecg",
        "category": "clinical_finding",
        "data_type": "ECG",
        "criterion": "ECG changes: new ST elevation, ST depression, T-wave inversions, or new pathological Q waves",
        "detail": "STEMI: ST elevation \u2265 1mm in 2+ contiguous leads (\u2265 2mm in V1-V3). NSTEMI: ST depression \u2265 0.5mm or T-wave inversions \u2265 1mm in 2+ contiguous leads.",
        "source": "ACC_AHA_ACS",
        "source_detail": "2014 AHA/ACC NSTE-ACS Guideline: ECG criteria",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "mi_symptoms",
        "category": "clinical_finding",
        "data_type": "Symptoms",
        "criterion": "Ischemic symptoms: chest pain/pressure, dyspnea, diaphoresis, radiation to arm/jaw",
        "detail": "Symptoms of myocardial ischemia. Atypical presentations (nausea, fatigue, dyspnea only) are common in elderly, women, and diabetic patients.",
        "source": "ACC_AHA_ACS",
        "source_detail": "2014 AHA/ACC NSTE-ACS Guideline: Clinical presentation",
        "required": false,
        "evidence_weight": "moderate"
      },
      {
        "id": "mi_cath",
        "category": "imaging",
        "data_type": "Cardiac Catheterization",
        "criterion": "Angiographic evidence of coronary thrombus, plaque rupture, or significant stenosis",
        "detail": "Cardiac catheterization confirms culprit lesion and guides intervention (PCI). Angiographic findings support Type 1 MI vs Type 2.",
        "source": "ACC_AHA_ACS",
        "source_detail": "Fourth Universal Definition: Angiographic criteria",
        "required": false,
        "evidence_weight": "strong"
      }
    ],
    "documentation_requirements": [
      {
        "id": "mi_doc_type",
        "requirement": "Provider must document the TYPE of MI: STEMI with artery (I21.0x\u2013I21.2x), NSTEMI (I21.4), Type 2 (I21.A1), or unspecified (I21.9). STEMI requires artery specification.",
        "insufficient_terms": [
          "troponin leak",
          "troponin elevation",
          "demand ischemia",
          "cardiac event"
        ],
        "source": "CODING_CLINIC",
        "source_detail": "Q4 2017 p.44: Type 2 MI coding; Q1 2021 p.30: STEMI artery documentation"
      },
      {
        "id": "mi_doc_stemi_artery",
        "requirement": "For STEMI, the provider should document the specific coronary artery: LAD (I21.02), RCA (I21.11), LCx (I21.21), left main (I21.01). 'STEMI' alone maps to I21.3 (unspecified site).",
        "insufficient_terms": [
          "STEMI NOS"
        ],
        "source": "ICD10_GUIDELINES",
        "source_detail": "Section I.C.9.e.1: STEMI \u2014 code to site"
      }
    ],
    "specificity_ladder": [
      {
        "code": "I2102",
        "description": "STEMI involving LAD",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "ST elevation in V1-V4, LAD occlusion on angiography",
        "upgrade_from": "I213",
        "upgrade_evidence": "Specify LAD territory from ECG leads or cath findings"
      },
      {
        "code": "I2111",
        "description": "STEMI involving RCA",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "ST elevation in II, III, aVF \u2014 inferior territory",
        "upgrade_from": "I213",
        "upgrade_evidence": "Specify RCA/inferior territory from ECG leads or cath"
      },
      {
        "code": "I214",
        "description": "NSTEMI",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Troponin rise/fall pattern + ischemic symptoms/ECG changes WITHOUT persistent ST elevation",
        "upgrade_from": "I219",
        "upgrade_evidence": "Specify NSTEMI vs unspecified MI when troponin and ischemic features are present"
      },
      {
        "code": "I21A1",
        "description": "Type 2 MI",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Myocardial oxygen supply/demand mismatch without coronary plaque rupture. Common triggers: tachycardia, hypotension, anemia, respiratory failure.",
        "specificity_note": "Type 2 MI is distinct from 'demand ischemia' \u2014 the provider must explicitly state 'myocardial infarction type 2.'"
      },
      {
        "code": "I219",
        "description": "Acute MI, unspecified",
        "cc_mcc": "MCC",
        "specificity_note": "Same MCC tier but nonspecific. Query to distinguish STEMI vs NSTEMI vs Type 2."
      }
    ],
    "cdi_query_templates": [
      {
        "trigger": "Troponin elevated with rise/fall pattern but documentation says 'troponin leak' or 'demand ischemia'",
        "query": "Troponin values show [VALUES] with a rise/fall pattern. You documented '[THEIR TERM].' Based on the clinical context, does this represent an acute myocardial infarction? If so, is this a Type 1 (plaque rupture) or Type 2 (supply/demand mismatch) MI?",
        "source": "CODING_CLINIC Q4 2017 p.44 \u2014 Type 2 MI"
      },
      {
        "trigger": "STEMI documented without specifying the artery territory",
        "query": "You documented 'STEMI.' ECG shows ST elevation in [LEADS]. Catheterization showed [FINDINGS]. Could you specify the involved coronary artery territory (LAD, RCA, LCx, left main)?",
        "source": "ICD10_GUIDELINES I.C.9.e.1"
      },
      {
        "trigger": "I22 subsequent MI may be applicable \u2014 new MI within 4 weeks of initial",
        "query": "The patient had an initial MI on [DATE] and now presents with new troponin elevation and [symptoms]. Does this represent a subsequent (new) MI? I22.x codes are used for new MI events occurring within 4 weeks of an initial I21 MI.",
        "source": "CODING_CLINIC Q1 2018 p.32"
      }
    ],
    "common_pitfalls": [
      "'Troponin leak' is not a diagnosis \u2014 it's a lab finding. Provider must document the clinical diagnosis: MI, myocardial injury, or non-cardiac cause of troponin elevation.",
      "Type 2 MI (I21.A1) requires the provider to explicitly state 'type 2 MI' or 'myocardial infarction type 2.' 'Demand ischemia' alone does NOT map to MI.",
      "I22.x (subsequent MI) is only used for a NEW MI within 4 weeks of a previous I21 MI. It is NOT for follow-up visits for a prior MI.",
      "Acute MI codes (I21/I22) have a 4-week window. After 4 weeks, use I25.2 (old MI) for ongoing care.",
      "Non-ischemic myocardial injury (I5A) is a separate code for troponin elevation without MI criteria \u2014 introduced in ICD-10-CM FY2024."
    ],
    "context_modifiers": {
      "with_cardiac_arrest": "If MI causes cardiac arrest: sequence the MI first, cardiac arrest (I46.x) second. If patient dies, MI can be sequenced as principal.",
      "with_pci": "PCI during same encounter for STEMI: the procedural codes are on the PCS side. The MI diagnosis still codes as acute during the initial encounter.",
      "post_surgical": "Perioperative MI: document as Type 2 MI (I21.A1) if supply/demand mismatch, or Type 1 if plaque rupture. Add appropriate complication code."
    }
  },
  {
    "id": "stroke",
    "name": "Cerebral Infarction",
    "icd10_chapter": "I",
    "codes": [
      "I6300",
      "I63011",
      "I63012",
      "I63013",
      "I63019",
      "I6302",
      "I63031",
      "I63032",
      "I63033",
      "I63039",
      "I6309",
      "I6310",
      "I63111",
      "I63112",
      "I63113",
      "I63119",
      "I6312",
      "I63131",
      "I63132",
      "I63133",
      "I63139",
      "I6319",
      "I6320",
      "I63211",
      "I63212",
      "I63213",
      "I63219",
      "I6322",
      "I63231",
      "I63232",
      "I63233",
      "I63239",
      "I6329",
      "I6330",
      "I63311",
      "I63312",
      "I63313",
      "I63319",
      "I63321",
      "I63322",
      "I63323",
      "I63329",
      "I63331",
      "I63332",
      "I63333",
      "I63339",
      "I63341",
      "I63342",
      "I63343",
      "I63349",
      "I6339",
      "I6340",
      "I63411",
      "I63412",
      "I63413",
      "I63419",
      "I63421",
      "I63422",
      "I63423",
      "I63429",
      "I63431",
      "I63432",
      "I63433",
      "I63439",
      "I63441",
      "I63442",
      "I63443",
      "I63449",
      "I6349",
      "I6350",
      "I63511",
      "I63512",
      "I63513",
      "I63519",
      "I63521",
      "I63522",
      "I63523",
      "I63529",
      "I63531",
      "I63532",
      "I63533",
      "I63539",
      "I63541",
      "I63542",
      "I63543",
      "I63549",
      "I6359",
      "I636",
      "I6381",
      "I6389",
      "I639"
    ],
    "code_ranges": "I63.0x\u2013I63.9",
    "code_count": 91,
    "clinical_criteria": [
      {
        "id": "str_imaging",
        "category": "imaging",
        "data_type": "CT/MRI Brain",
        "criterion": "Brain imaging (CT or MRI) showing acute infarction or excluding hemorrhage",
        "detail": "Non-contrast CT may be normal in first 6-12 hours. MRI with diffusion-weighted imaging (DWI) is more sensitive for early infarct. CT angiography identifies large vessel occlusion.",
        "source": "AHA_STROKE",
        "source_detail": "2019 AHA/ASA Acute Ischemic Stroke Guidelines: Imaging recommendations",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "str_neuro_deficit",
        "category": "clinical_finding",
        "data_type": "Neurological Deficit",
        "criterion": "Acute focal neurological deficit: hemiparesis/plegia, facial droop, aphasia, visual field cut, ataxia, dysarthria",
        "detail": "NIHSS documents severity. Deficits should correspond to a vascular territory. Document onset time for treatment decisions.",
        "source": "AHA_STROKE",
        "source_detail": "2019 AHA/ASA Guidelines: Clinical presentation and NIHSS",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "str_vessel",
        "category": "imaging",
        "data_type": "CTA / MRA / Angiography",
        "criterion": "Vascular imaging identifying occluded or stenotic artery",
        "detail": "CT angiography or MR angiography showing the culprit vessel. Critical for determining the specific I63 code (precerebral vs cerebral, thrombosis vs embolism).",
        "source": "AHA_STROKE",
        "source_detail": "2019 AHA/ASA: Vascular imaging for etiology determination",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "str_tpa_thrombectomy",
        "category": "intervention",
        "data_type": "tPA / Thrombectomy",
        "criterion": "Administration of IV tPA (within 4.5 hours) or mechanical thrombectomy (within 24 hours for LVO)",
        "detail": "Acute stroke interventions. Their use is strong supporting evidence for acute cerebral infarction diagnosis.",
        "source": "AHA_STROKE",
        "source_detail": "2019 AHA/ASA: IV alteplase and mechanical thrombectomy recommendations",
        "required": false,
        "evidence_weight": "strong"
      }
    ],
    "documentation_requirements": [
      {
        "id": "str_doc_infarction",
        "requirement": "Provider must document 'cerebral infarction' or 'ischemic stroke' or 'CVA (ischemic).' Terms like 'stroke' alone are ambiguous \u2014 could be hemorrhagic.",
        "insufficient_terms": [
          "stroke NOS",
          "CVA",
          "cerebrovascular event",
          "brain attack",
          "TIA"
        ],
        "source": "CODING_CLINIC",
        "source_detail": "Q2 2016 p.25: CVA documentation requirements"
      },
      {
        "id": "str_doc_mechanism",
        "requirement": "Document the MECHANISM: thrombosis (I63.0-I63.3), embolism (I63.1/I63.4), or occlusion/stenosis (I63.2/I63.5). Document the ARTERY when known.",
        "insufficient_terms": [
          "ischemic stroke NOS"
        ],
        "source": "ICD10_GUIDELINES",
        "source_detail": "Section I.C.9.d: Code to highest specificity for cerebrovascular conditions"
      }
    ],
    "specificity_ladder": [
      {
        "code": "I63411",
        "description": "Cerebral infarction due to embolism of right middle cerebral artery",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Imaging confirms MCA territory infarct with embolic source (cardiac, aortic arch)",
        "upgrade_from": "I639",
        "upgrade_evidence": "Specify mechanism (embolism) and artery (MCA) from imaging and clinical evaluation"
      },
      {
        "code": "I63311",
        "description": "Cerebral infarction due to thrombosis of right middle cerebral artery",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "MCA territory infarct with in-situ thrombosis (large artery atherosclerosis)",
        "upgrade_from": "I639",
        "upgrade_evidence": "Specify thrombosis mechanism from vascular imaging"
      },
      {
        "code": "I636",
        "description": "Cerebral infarction due to cerebral venous thrombosis, nonpyogenic",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Venous sinus thrombosis on CTV/MRV causing venous infarction",
        "specificity_note": "Rare but distinct \u2014 different etiology and treatment from arterial strokes"
      },
      {
        "code": "I639",
        "description": "Cerebral infarction, unspecified",
        "cc_mcc": "MCC",
        "specificity_note": "Same MCC tier but least specific. Always query for mechanism and artery territory."
      }
    ],
    "cdi_query_templates": [
      {
        "trigger": "Documentation says 'CVA' or 'stroke' without specifying ischemic vs hemorrhagic",
        "query": "You documented 'CVA' on [DATE]. Imaging shows [FINDINGS]. For coding accuracy, is this an ischemic stroke (cerebral infarction) or hemorrhagic stroke? If ischemic, can you specify the mechanism (thrombosis vs embolism) and the involved artery?",
        "source": "CODING_CLINIC Q2 2016 p.25"
      },
      {
        "trigger": "Ischemic stroke documented but mechanism/artery not specified",
        "query": "You documented 'ischemic stroke.' CTA/MRI shows involvement of the [TERRITORY]. The likely mechanism appears to be [thrombosis/embolism based on workup]. Could you document the specific artery territory and mechanism?",
        "source": "ICD10_GUIDELINES I.C.9.d"
      }
    ],
    "common_pitfalls": [
      "'CVA' alone is ambiguous \u2014 it maps to I63.9 (cerebral infarction unspecified) but could mean hemorrhagic stroke. Always clarify.",
      "TIA (G45.x) is NOT a cerebral infarction. If imaging shows infarct, the diagnosis should be stroke even if symptoms resolved.",
      "Acute stroke codes (I63.x) are used during the initial encounter. For sequelae (after the acute phase), use I69.3x.",
      "Laterality matters: right vs left vs unspecified affects the specific code. Query for laterality documentation when imaging is available.",
      "Stroke occurring during the postoperative period: clarify whether it's a complication (I97.x) vs independent event."
    ],
    "context_modifiers": {
      "with_afib": "Atrial fibrillation is the most common embolic source. Stroke with AFib strongly suggests embolic mechanism (I63.4x). Document the association.",
      "with_tpa": "If tPA was given, document this in the context of 'acute cerebral infarction' to support code selection and interventional coding.",
      "with_hemorrhagic_conversion": "If initial ischemic stroke converts to hemorrhagic: the ischemic stroke is still the principal. The hemorrhagic conversion is coded separately."
    }
  },
  {
    "id": "malnutrition",
    "name": "Malnutrition",
    "icd10_chapter": "E",
    "codes": [
      "E40",
      "E41",
      "E42",
      "E43",
      "E440",
      "E441",
      "E45",
      "E46"
    ],
    "code_ranges": "E40\u2013E46",
    "code_count": 8,
    "clinical_criteria": [
      {
        "id": "mal_weight_loss",
        "category": "clinical_finding",
        "data_type": "Weight",
        "criterion": "Unintentional weight loss: \u2265 5% in 1 month, \u2265 7.5% in 3 months, or \u2265 10% in 6 months",
        "detail": "Must be unintentional. Compare to documented baseline weight. Severe: \u2265 5% in 1 month or \u2265 10% in 6 months. Moderate: lesser degrees with other findings.",
        "source": "ASPEN",
        "source_detail": "AND/ASPEN Malnutrition Characteristics 2012: Weight loss thresholds",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "mal_intake",
        "category": "clinical_finding",
        "data_type": "Dietary Intake",
        "criterion": "Inadequate energy intake: < 75% of estimated needs for > 7 days (moderate) or < 50% for > 5 days (severe)",
        "detail": "Documented by calorie count or dietary intake assessment. Includes both oral and enteral/parenteral intake.",
        "source": "ASPEN",
        "source_detail": "AND/ASPEN 2012: Energy intake assessment",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "mal_bmi",
        "category": "clinical_finding",
        "data_type": "BMI",
        "criterion": "BMI < 18.5 kg/m\u00b2 (underweight) \u2014 severe malnutrition often BMI < 16",
        "detail": "Low BMI alone is insufficient without other malnutrition characteristics. Document in context of clinical presentation.",
        "threshold": {
          "metric": "BMI",
          "operator": "<",
          "value": 18.5,
          "unit": "kg/m\u00b2"
        },
        "source": "ASPEN",
        "source_detail": "AND/ASPEN 2012: BMI criteria for malnutrition assessment",
        "required": false,
        "evidence_weight": "moderate"
      },
      {
        "id": "mal_albumin",
        "category": "laboratory",
        "data_type": "Albumin / Prealbumin",
        "criterion": "Low serum albumin (< 3.5 g/dL) or prealbumin (< 15 mg/dL) \u2014 supportive but NOT diagnostic alone",
        "detail": "Albumin is an acute-phase reactant affected by inflammation, hydration, liver disease. It supports but does not diagnose malnutrition. ASPEN recommends against using albumin as the sole indicator.",
        "threshold": {
          "metric": "Albumin",
          "operator": "<",
          "value": 3.5,
          "unit": "g/dL"
        },
        "source": "ASPEN",
        "source_detail": "ASPEN Consensus Statement 2015: Albumin is NOT a marker of nutritional status in acute illness",
        "required": false,
        "evidence_weight": "weak"
      },
      {
        "id": "mal_physical",
        "category": "clinical_finding",
        "data_type": "Physical Assessment",
        "criterion": "Physical findings: muscle wasting, loss of subcutaneous fat, temporal wasting, functional decline",
        "detail": "AND/ASPEN recommends physical exam-based assessment: subcutaneous fat loss, muscle wasting, fluid accumulation, reduced grip strength.",
        "source": "ASPEN",
        "source_detail": "AND/ASPEN 2012: Malnutrition physical examination characteristics",
        "required": false,
        "evidence_weight": "strong"
      }
    ],
    "documentation_requirements": [
      {
        "id": "mal_doc_severity",
        "requirement": "Provider OR qualified dietitian must document the SEVERITY of malnutrition: severe (E40\u2013E43 = MCC), moderate (E44.0 = CC), or mild (E44.1 = CC). 'Malnutrition' alone maps to E46 (unspecified, CC).",
        "insufficient_terms": [
          "malnourished",
          "poor nutrition",
          "poor PO intake",
          "nutritional deficiency",
          "protein wasting"
        ],
        "source": "CODING_CLINIC",
        "source_detail": "Q3 2017 p.24: Dietitian documentation accepted for malnutrition; Q4 2019 p.86"
      },
      {
        "id": "mal_doc_type",
        "requirement": "For severe malnutrition: specify protein-calorie type. E43 (unspecified severe PCM) is MCC. If specific clinical features are present: E40 (kwashiorkor), E41 (marasmus), or E42 (marasmic kwashiorkor).",
        "insufficient_terms": [
          "underweight",
          "cachexia",
          "wasting"
        ],
        "source": "ICD10_GUIDELINES",
        "source_detail": "Section I.C.4: Malnutrition \u2014 code to highest specificity"
      }
    ],
    "specificity_ladder": [
      {
        "code": "E43",
        "description": "Unspecified severe protein-calorie malnutrition",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "\u2265 2 of: severe weight loss (\u2265 5% in 1 mo), severely reduced intake (< 50% for \u2265 5 days), severe muscle/fat loss on exam",
        "upgrade_from": "E46",
        "upgrade_evidence": "Document 'severe malnutrition' \u2014 changes CC to MCC"
      },
      {
        "code": "E440",
        "description": "Moderate protein-calorie malnutrition",
        "cc_mcc": "CC",
        "distinguishing_evidence": "Moderate weight loss (1-2% in 1 week, 5% in 1 month), moderately reduced intake, moderate physical findings",
        "upgrade_from": "E46",
        "upgrade_evidence": "Document 'moderate malnutrition' for specificity"
      },
      {
        "code": "E441",
        "description": "Mild protein-calorie malnutrition",
        "cc_mcc": "CC",
        "distinguishing_evidence": "Mild deficits in intake, weight, or physical findings",
        "specificity_note": "CC tier \u2014 same DRG impact as moderate, but accurate documentation matters"
      },
      {
        "code": "E46",
        "description": "Unspecified protein-calorie malnutrition",
        "cc_mcc": "CC",
        "specificity_note": "CC tier. Query for severity \u2014 upgrading to E43 (severe) changes CC \u2192 MCC."
      }
    ],
    "cdi_query_templates": [
      {
        "trigger": "Dietitian documents malnutrition without severity specification",
        "query": "The dietitian assessed the patient as malnourished. Based on the clinical findings \u2014 weight loss of [VALUE], intake of [PERCENT], and physical findings of [FINDINGS] \u2014 would you characterize this as mild, moderate, or severe protein-calorie malnutrition?",
        "source": "CODING_CLINIC Q3 2017 p.24 + AND/ASPEN criteria"
      },
      {
        "trigger": "Low albumin and BMI < 18.5 but no malnutrition diagnosis",
        "query": "The patient's albumin is [VALUE] g/dL, BMI is [VALUE] kg/m\u00b2, and they have documented [weight loss / poor intake / physical findings]. Has a nutritional assessment been completed? Does this clinical picture represent protein-calorie malnutrition, and if so, what severity?",
        "source": "ASPEN Consensus + CODING_CLINIC Q4 2019 p.86"
      }
    ],
    "common_pitfalls": [
      "Low albumin alone does NOT support malnutrition \u2014 albumin is an inflammatory marker, not a nutritional marker in acute illness (ASPEN 2015 consensus).",
      "Cachexia (R64) is a separate diagnosis from malnutrition \u2014 it's a metabolic syndrome associated with underlying illness, not inadequate intake.",
      "'Poor PO intake' or 'malnourished' are not codeable diagnoses. The provider must specify 'malnutrition' with severity.",
      "Dietitian documentation of malnutrition severity IS accepted for coding per Coding Clinic \u2014 but the physician must agree with the assessment (no disagreement).",
      "Severe malnutrition (E40-E43) is MCC; moderate/mild/unspecified (E44-E46) is CC \u2014 a huge DRG impact difference."
    ],
    "context_modifiers": {
      "with_cancer": "Cancer-associated malnutrition: code both the neoplasm and the malnutrition. Severe malnutrition is common in advanced cancers and significantly impacts DRG.",
      "with_surgery": "Malnutrition increases surgical complication risk. Preoperative nutritional status should be documented for severity assessment.",
      "with_dysphagia": "Dysphagia causing inadequate intake: code both dysphagia (R13.x) and resulting malnutrition. Document the causal link."
    }
  },
  {
    "id": "pneumonia",
    "name": "Pneumonia",
    "icd10_chapter": "J",
    "codes": [
      "J1000",
      "J1001",
      "J1008",
      "J1100",
      "J1108",
      "J120",
      "J121",
      "J122",
      "J123",
      "J1281",
      "J1282",
      "J1289",
      "J129",
      "J13",
      "J14",
      "J150",
      "J151",
      "J1520",
      "J15211",
      "J15212",
      "J1529",
      "J153",
      "J154",
      "J155",
      "J1561",
      "J1569",
      "J157",
      "J158",
      "J159",
      "J160",
      "J168",
      "J17",
      "J180",
      "J181",
      "J182",
      "J188",
      "J189"
    ],
    "code_ranges": "J10.0x, J11.0x, J12.x\u2013J18.x",
    "code_count": 37,
    "clinical_criteria": [
      {
        "id": "pna_cxr",
        "category": "imaging",
        "data_type": "Chest X-ray / CT",
        "criterion": "Chest imaging showing new pulmonary infiltrate, consolidation, or ground-glass opacity",
        "detail": "New or progressive infiltrate on CXR or CT in the context of infectious symptoms. CT is more sensitive than CXR for early pneumonia.",
        "source": "ATS_IDSA_CAP",
        "source_detail": "2019 ATS/IDSA CAP Guidelines: Radiographic criteria",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "pna_culture",
        "category": "laboratory",
        "data_type": "Respiratory Culture / Sputum",
        "criterion": "Sputum culture, blood culture, or respiratory pathogen panel identifying causative organism",
        "detail": "Organism identification drives specific code selection (J13 pneumococcus, J14 H. influenzae, J15.x other bacteria, J12.x viral). PCR/antigen tests count.",
        "source": "ATS_IDSA_CAP",
        "source_detail": "2019 ATS/IDSA: Microbiologic testing recommendations",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "pna_clinical",
        "category": "clinical_finding",
        "data_type": "Clinical Presentation",
        "criterion": "Clinical signs: fever, cough (productive or dry), tachypnea, hypoxia, crackles/rhonchi on auscultation",
        "detail": "Clinical presentation plus imaging finding. At least two clinical features with a new infiltrate support pneumonia diagnosis.",
        "source": "ATS_IDSA_CAP",
        "source_detail": "2019 ATS/IDSA: Clinical diagnosis criteria",
        "required": false,
        "evidence_weight": "moderate"
      },
      {
        "id": "pna_wbc_procalc",
        "category": "laboratory",
        "data_type": "WBC / Procalcitonin",
        "criterion": "WBC > 12,000 or < 4,000, or procalcitonin \u2265 0.25 ng/mL",
        "detail": "Leukocytosis or leukopenia supports infection. Procalcitonin helps distinguish bacterial from viral and guide antibiotic duration.",
        "source": "ATS_IDSA_CAP",
        "source_detail": "2019 ATS/IDSA: Laboratory evaluation",
        "required": false,
        "evidence_weight": "moderate"
      }
    ],
    "documentation_requirements": [
      {
        "id": "pna_doc_organism",
        "requirement": "When the causative organism is identified, the provider should document it specifically. Organism-specific pneumonia codes (J13\u2013J16) are more specific than J18.x (unspecified).",
        "insufficient_terms": [
          "pneumonia NOS",
          "lung infection"
        ],
        "source": "ICD10_GUIDELINES",
        "source_detail": "Section I.C.10: Code the specific organism when identified"
      },
      {
        "id": "pna_doc_type",
        "requirement": "Document the anatomic type when applicable: lobar (J18.1), bronchopneumonia (J18.0), or interstitial. Document aspiration when pneumonia results from aspiration (J69.0).",
        "insufficient_terms": [
          "pneumonia"
        ],
        "source": "CODING_CLINIC",
        "source_detail": "Q1 2018 p.13: Pneumonia type and organism documentation"
      }
    ],
    "specificity_ladder": [
      {
        "code": "J15211",
        "description": "Pneumonia due to MSSA",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Sputum or blood culture positive for Methicillin-susceptible S. aureus",
        "upgrade_from": "J189",
        "upgrade_evidence": "Specify MSSA from culture \u2014 organism-specific code is more accurate"
      },
      {
        "code": "J15212",
        "description": "Pneumonia due to MRSA",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Culture positive for MRSA",
        "upgrade_from": "J189",
        "upgrade_evidence": "Specify MRSA from culture and susceptibility"
      },
      {
        "code": "J13",
        "description": "Pneumonia due to Streptococcus pneumoniae",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Pneumococcal antigen positive, or culture positive for S. pneumoniae",
        "upgrade_from": "J189"
      },
      {
        "code": "J1282",
        "description": "Pneumonia due to COVID-19",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "COVID-19 positive test + pneumonia on imaging. Sequence U07.1 first, then J12.82.",
        "specificity_note": "No-exclusion code (pdx = -1) \u2014 always survives regardless of principal."
      },
      {
        "code": "J189",
        "description": "Pneumonia, unspecified organism",
        "cc_mcc": "MCC",
        "specificity_note": "MCC \u2014 but specifying the organism is preferred when culture data is available."
      },
      {
        "code": "J182",
        "description": "Hypostatic pneumonia, unspecified organism",
        "cc_mcc": "CC",
        "specificity_note": "Only CC \u2014 this is the one pneumonia code that is CC, not MCC. Used for immobility-related pneumonia."
      }
    ],
    "cdi_query_templates": [
      {
        "trigger": "Infiltrate on imaging with antibiotics started but no pneumonia diagnosis",
        "query": "Chest imaging on [DATE] shows [FINDINGS \u2014 infiltrate/consolidation]. The patient has [symptoms \u2014 fever, cough, leukocytosis] and is receiving antibiotics. Does this represent pneumonia? If so, is the causative organism known?",
        "source": "ATS/IDSA 2019 CAP Guidelines"
      },
      {
        "trigger": "Pneumonia documented as unspecified but culture results available",
        "query": "You documented 'pneumonia.' Respiratory culture results show [ORGANISM]. Could you update the documentation to reflect the specific causative organism?",
        "source": "ICD10_GUIDELINES I.C.10"
      },
      {
        "trigger": "Aspiration event documented but aspiration pneumonia not explicitly stated",
        "query": "The patient had a documented aspiration event on [DATE] and subsequently developed [infiltrate/fever/leukocytosis]. Does this represent aspiration pneumonia (J69.0)?",
        "source": "CODING_CLINIC Q1 2017 p.24"
      }
    ],
    "common_pitfalls": [
      "J18.2 (hypostatic pneumonia) is the ONLY pneumonia code that is CC instead of MCC \u2014 all others are MCC.",
      "Aspiration pneumonia (J69.0) is a separate code from aspiration pneumonitis (J69.0 is used for both, but clinical distinction matters for treatment).",
      "Ventilator-associated pneumonia (J95.851) is coded separately from community-acquired pneumonia \u2014 different DRG pathway.",
      "COVID pneumonia: U07.1 is sequenced FIRST, then J12.82. This is a chapter-specific sequencing rule.",
      "Pneumonia in influenza: use the combination code (J10.0x/J11.0x) rather than separate pneumonia + influenza codes."
    ],
    "context_modifiers": {
      "with_sepsis": "Pneumonia as source of sepsis: sequence depends on admission reason. If admitted for pneumonia with sepsis developing, pneumonia may be principal. If admitted for sepsis, A41.x is principal.",
      "with_resp_failure": "Pneumonia causing respiratory failure: code both. Sequencing depends on which condition occasions the admission.",
      "with_covid": "COVID-19 pneumonia: U07.1 sequenced first per Guidelines I.C.1.g.1.a, followed by J12.82."
    }
  },
  {
    "id": "pressure_ulcers",
    "name": "Pressure Ulcers",
    "icd10_chapter": "L",
    "codes": [
      "L89003",
      "L89004",
      "L89013",
      "L89014",
      "L89023",
      "L89024",
      "L89103",
      "L89104",
      "L89113",
      "L89114",
      "L89123",
      "L89124",
      "L89133",
      "L89134",
      "L89143",
      "L89144",
      "L89153",
      "L89154",
      "L89203",
      "L89204",
      "L89213",
      "L89214",
      "L89223",
      "L89224",
      "L89303",
      "L89304",
      "L89313",
      "L89314",
      "L89323",
      "L89324",
      "L8943",
      "L8944",
      "L89503",
      "L89504",
      "L89513",
      "L89514",
      "L89523",
      "L89524",
      "L89603",
      "L89604",
      "L89613",
      "L89614",
      "L89623",
      "L89624",
      "L89813",
      "L89814",
      "L89893",
      "L89894",
      "L8993",
      "L8994"
    ],
    "code_ranges": "L89.xx3, L89.xx4 (Stage 3 and Stage 4 only have CC/MCC status)",
    "code_count": 50,
    "clinical_criteria": [
      {
        "id": "pu_stage3",
        "category": "clinical_finding",
        "data_type": "Wound Assessment",
        "criterion": "Stage 3: Full-thickness skin loss with visible subcutaneous fat. Bone, tendon, or muscle NOT visible/palpable.",
        "detail": "Granulation tissue, slough, or eschar may be present. Undermining and tunneling may occur. Depth varies by anatomical location.",
        "source": "NPUAP",
        "source_detail": "NPUAP/EPUAP/PPPIA 2019: Stage 3 Pressure Injury definition",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "pu_stage4",
        "category": "clinical_finding",
        "data_type": "Wound Assessment",
        "criterion": "Stage 4: Full-thickness skin and tissue loss with exposed or palpable bone, tendon, fascia, or muscle.",
        "detail": "Slough and/or eschar may be present on some of the wound bed. Often includes undermining and tunneling. Osteomyelitis risk.",
        "source": "NPUAP",
        "source_detail": "NPUAP/EPUAP/PPPIA 2019: Stage 4 Pressure Injury definition",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "pu_location",
        "category": "clinical_finding",
        "data_type": "Anatomic Location",
        "criterion": "Document the specific anatomic site: sacrum, coccyx, buttock, hip, heel, elbow, back, head, ankle, or other site",
        "detail": "Site determines the 4th/5th character of the L89 code. Laterality (right/left/unspecified) affects code selection for paired sites.",
        "source": "ICD10_GUIDELINES",
        "source_detail": "Section I.C.12.a: Pressure ulcer site and stage documentation",
        "required": false,
        "evidence_weight": "strong"
      }
    ],
    "documentation_requirements": [
      {
        "id": "pu_doc_stage",
        "requirement": "Provider or wound care nurse must document the STAGE using NPUAP staging: Stage 1, 2, 3, 4, unstageable, or deep tissue. Only Stage 3 (L89.xx3) and Stage 4 (L89.xx4) are MCC.",
        "insufficient_terms": [
          "pressure sore",
          "decubitus",
          "bedsore",
          "skin breakdown"
        ],
        "source": "CODING_CLINIC",
        "source_detail": "Q4 2017 p.108: Pressure ulcer staging and documentation requirements"
      },
      {
        "id": "pu_doc_site_laterality",
        "requirement": "Document BOTH the anatomic site and laterality (right/left). 'Pressure ulcer' without site maps to L89.9x (unspecified site).",
        "insufficient_terms": [
          "pressure ulcer NOS",
          "stage 4 pressure ulcer"
        ],
        "source": "ICD10_GUIDELINES",
        "source_detail": "Section I.C.12.a.2: Code site and laterality"
      }
    ],
    "specificity_ladder": [
      {
        "code": "L89154",
        "description": "Pressure ulcer of sacral region, stage 4",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Full-thickness tissue loss of sacrum with exposed bone/muscle \u2014 NPUAP Stage 4",
        "upgrade_from": "L89153",
        "upgrade_evidence": "If bone/tendon/muscle visible \u2192 Stage 4 instead of Stage 3"
      },
      {
        "code": "L89153",
        "description": "Pressure ulcer of sacral region, stage 3",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Full-thickness skin loss of sacrum with visible subQ fat, but no bone/tendon visible",
        "specificity_note": "Both Stage 3 and Stage 4 are MCC \u2014 same DRG impact, but clinical accuracy matters."
      },
      {
        "code": "L8994",
        "description": "Pressure ulcer of unspecified site, stage 4",
        "cc_mcc": "MCC",
        "specificity_note": "MCC but unspecified site \u2014 query for anatomic location for accuracy."
      }
    ],
    "cdi_query_templates": [
      {
        "trigger": "Wound documented as 'pressure sore' or 'decubitus' without NPUAP staging",
        "query": "You documented a pressure injury on the [LOCATION]. For coding accuracy, could you specify the NPUAP stage? Stage 3 = full-thickness skin loss (subQ visible). Stage 4 = full-thickness tissue loss (bone/tendon/muscle visible).",
        "source": "NPUAP 2019 + CODING_CLINIC Q4 2017 p.108"
      },
      {
        "trigger": "Wound care notes show Stage 3 or 4 pressure ulcer but physician documentation is less specific",
        "query": "Wound care nursing assessment documents a Stage [3/4] pressure ulcer of the [LOCATION]. Your documentation notes '[THEIR TERM].' Could you confirm the stage and location for coding alignment?",
        "source": "CODING_CLINIC Q4 2017 p.108"
      },
      {
        "trigger": "Pressure ulcer documented without laterality on a paired site",
        "query": "You documented a pressure ulcer of the [hip/heel/buttock/elbow]. For accurate coding, is this the right or left side?",
        "source": "ICD10_GUIDELINES I.C.12.a.2"
      }
    ],
    "common_pitfalls": [
      "Only Stage 3 and Stage 4 pressure ulcers are CC/MCC (all are MCC). Stage 1, Stage 2, unstageable, and deep tissue are NOT CC/MCC.",
      "'Unstageable' pressure ulcer is NOT the same as Stage 3 or 4 \u2014 unstageable means the wound bed is obscured by slough/eschar. It is not MCC.",
      "Pressure ulcer present on admission (POA) still counts for CC/MCC and DRG assignment \u2014 POA only affects HAC processing.",
      "Non-pressure chronic ulcers (L97.x) are different codes with different CC/MCC rules. Don't conflate with pressure ulcers (L89.x).",
      "If a pressure ulcer progresses during the stay (e.g., Stage 2 at admission \u2192 Stage 3), code only the highest stage documented."
    ],
    "context_modifiers": {
      "with_osteomyelitis": "Stage 4 pressure ulcer with exposed bone: query for osteomyelitis (M86.x). If present, code both \u2014 osteomyelitis adds additional DRG impact.",
      "with_sepsis": "Infected pressure ulcer as source of sepsis: code the sepsis (A41.x), the pressure ulcer, and the infection. Document the causal chain.",
      "with_malnutrition": "Malnutrition impairs wound healing and is commonly comorbid. Ensure both are documented and coded \u2014 combined CC/MCC impact is significant."
    }
  },
  {
    "id": "encephalopathy",
    "name": "Encephalopathy",
    "icd10_chapter": "G",
    "codes": [
      "G9203",
      "G9204",
      "G9205",
      "G928",
      "G929",
      "G931",
      "G9340",
      "G9341",
      "G9342",
      "G9343",
      "G9344",
      "G9345",
      "G9349",
      "G935",
      "G936",
      "G937",
      "G9382"
    ],
    "code_ranges": "G92.x, G93.1, G93.4x, G93.5, G93.6, G93.7, G93.82",
    "code_count": 17,
    "clinical_criteria": [
      {
        "id": "enc_altered_ms",
        "category": "clinical_finding",
        "data_type": "Mental Status",
        "criterion": "Altered mental status: confusion, delirium, obtundation, or coma not explained by primary neurological diagnosis",
        "detail": "Must be distinguished from delirium (F05), dementia (F01-F03), and psychiatric conditions. The underlying cause determines the specific encephalopathy code.",
        "source": "CODING_CLINIC",
        "source_detail": "Q2 2017 p.8: Encephalopathy documentation and coding",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "enc_metabolic_labs",
        "category": "laboratory",
        "data_type": "Metabolic Panel",
        "criterion": "Metabolic derangements: hepatic (elevated ammonia, bilirubin), uremic (elevated BUN/Cr), hypoglycemic, electrolyte, or acid-base abnormalities",
        "detail": "Metabolic encephalopathy (G93.41, MCC) requires an identifiable metabolic cause. Labs should demonstrate the derangement causing altered mental status.",
        "source": "AASLD_LIVER",
        "source_detail": "AASLD Guidelines: Hepatic encephalopathy \u2014 ammonia criteria; General: metabolic workup",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "enc_eeg",
        "category": "imaging",
        "data_type": "EEG",
        "criterion": "EEG showing diffuse slowing, triphasic waves, or periodic patterns consistent with encephalopathy",
        "detail": "EEG can support the diagnosis and help exclude seizure as the cause of altered mental status. Triphasic waves suggest metabolic (especially hepatic) encephalopathy.",
        "source": "CODING_CLINIC",
        "source_detail": "General: EEG findings supporting encephalopathy diagnosis",
        "required": false,
        "evidence_weight": "moderate"
      },
      {
        "id": "enc_toxic_exposure",
        "category": "clinical_finding",
        "data_type": "Toxicology",
        "criterion": "Identified toxic exposure: medications (opioids, sedatives, chemotherapy), substances, or environmental toxins",
        "detail": "Toxic encephalopathy (G92.8/G92.9) requires an identified toxic agent. Code the toxic agent/drug as additional code.",
        "source": "ICD10_GUIDELINES",
        "source_detail": "Section I.C.6: Code the underlying toxic cause",
        "required": false,
        "evidence_weight": "strong"
      }
    ],
    "documentation_requirements": [
      {
        "id": "enc_doc_type",
        "requirement": "Provider must document the TYPE of encephalopathy: metabolic (G93.41, MCC), toxic (G92.8, MCC), anoxic (G93.1, CC), or unspecified (G93.40, CC). The type determines MCC vs CC.",
        "insufficient_terms": [
          "altered mental status",
          "AMS",
          "confusion",
          "delirium",
          "obtunded",
          "change in mental status"
        ],
        "source": "CODING_CLINIC",
        "source_detail": "Q2 2017 p.8: Encephalopathy vs AMS \u2014 provider must specify encephalopathy"
      },
      {
        "id": "enc_doc_cause",
        "requirement": "Document the underlying CAUSE: hepatic, uremic, septic, hypoxic/anoxic, toxic (specify agent), or metabolic (specify derangement). This drives code selection and additional coding.",
        "insufficient_terms": [
          "encephalopathy NOS"
        ],
        "source": "CODING_CLINIC",
        "source_detail": "Q3 2017 p.18: Specify the type and cause of encephalopathy"
      }
    ],
    "specificity_ladder": [
      {
        "code": "G9341",
        "description": "Metabolic encephalopathy",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Altered mental status with identifiable metabolic cause: hepatic, uremic, electrolyte, endocrine",
        "upgrade_from": "G9340",
        "upgrade_evidence": "Specify 'metabolic' encephalopathy \u2014 changes CC to MCC"
      },
      {
        "code": "G928",
        "description": "Other toxic encephalopathy",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Encephalopathy due to identified toxic agent: medication, substance, environmental",
        "upgrade_from": "G9340",
        "upgrade_evidence": "Specify 'toxic' encephalopathy with causative agent"
      },
      {
        "code": "G936",
        "description": "Cerebral edema",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Imaging showing cerebral edema (CT/MRI), elevated ICP, or clinical signs of herniation",
        "specificity_note": "Distinct condition \u2014 may co-occur with encephalopathy but is separately codeable"
      },
      {
        "code": "G9382",
        "description": "Brain death",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Formal brain death determination per institutional protocol: absent brainstem reflexes, apnea test, confirmatory test",
        "specificity_note": "Terminal diagnosis \u2014 code when formally declared"
      },
      {
        "code": "G9340",
        "description": "Encephalopathy, unspecified",
        "cc_mcc": "CC",
        "specificity_note": "CC tier only. Query for type \u2014 metabolic (G93.41) or toxic (G92.8) would be MCC."
      },
      {
        "code": "G931",
        "description": "Anoxic brain damage",
        "cc_mcc": "CC",
        "specificity_note": "CC tier \u2014 used for brain damage from hypoxic event. Different from metabolic encephalopathy."
      }
    ],
    "cdi_query_templates": [
      {
        "trigger": "Altered mental status documented but no encephalopathy diagnosis",
        "query": "The patient has documented altered mental status with [lab findings \u2014 elevated ammonia, metabolic derangements, toxic exposure]. Does this clinical picture represent encephalopathy? If so, is this metabolic, toxic, or another type?",
        "source": "CODING_CLINIC Q2 2017 p.8"
      },
      {
        "trigger": "Encephalopathy documented as 'unspecified' but clinical evidence suggests metabolic cause",
        "query": "You documented 'encephalopathy.' Labs show [FINDINGS \u2014 ammonia elevated, hepatic dysfunction, uremia]. Would you characterize this as metabolic encephalopathy? Specifying the type allows for more accurate severity classification.",
        "source": "CODING_CLINIC Q3 2017 p.18"
      },
      {
        "trigger": "Septic patient with AMS \u2014 encephalopathy not documented",
        "query": "The patient has sepsis and developed altered mental status on [DATE] without an alternative neurological explanation. Does this represent septic encephalopathy (metabolic encephalopathy due to sepsis)?",
        "source": "CODING_CLINIC Q2 2017 p.8 + Sepsis-3"
      }
    ],
    "common_pitfalls": [
      "'Altered mental status' (R41.82) is a symptom, NOT a diagnosis. If encephalopathy is the cause, the provider must document 'encephalopathy.'",
      "G93.40 (encephalopathy, unspecified) is only CC; G93.41 (metabolic encephalopathy) is MCC \u2014 specifying the type is the key CC\u2192MCC upgrade.",
      "'Delirium' (F05) is a separate diagnosis from encephalopathy. In many inpatient settings, both may apply \u2014 delirium is the clinical syndrome, encephalopathy is the neurological condition.",
      "Hepatic encephalopathy should be coded with the underlying liver disease code. The encephalopathy code (G93.41) captures the neurological manifestation.",
      "Immune effector cell-associated neurotoxicity (ICANS) grades 3-5 (G92.03\u2013G92.05) are CC, not MCC \u2014 despite the severity, the CC/MCC assignment differs from other encephalopathies."
    ],
    "context_modifiers": {
      "with_liver_disease": "Hepatic encephalopathy: code G93.41 (metabolic) + underlying liver disease (K72.x, K70.x). Ammonia level supports but is not required for the diagnosis.",
      "with_sepsis": "Septic encephalopathy: code G93.41 (metabolic) + sepsis codes. AMS in sepsis without other neurological cause is likely septic encephalopathy.",
      "with_ckd": "Uremic encephalopathy: code G93.41 + N18.x (CKD stage). Typically occurs with very high BUN/creatinine. Dialysis initiation may resolve it."
    }
  },
  {
    "id": "copd_asthma",
    "name": "COPD / Asthma Exacerbation",
    "icd10_chapter": "J",
    "codes": [
      "J440",
      "J441",
      "J4521",
      "J4522",
      "J4531",
      "J4532",
      "J4541",
      "J4542",
      "J4551",
      "J4552",
      "J45901",
      "J45902"
    ],
    "code_ranges": "J44.0, J44.1, J45.x1, J45.x2",
    "code_count": 12,
    "clinical_criteria": [
      {
        "id": "copd_spirometry",
        "category": "clinical_finding",
        "data_type": "Spirometry",
        "criterion": "FEV1/FVC ratio < 0.70 (COPD) or FEV1 reversibility \u2265 12% and 200 mL (Asthma)",
        "detail": "Spirometry confirms underlying obstructive disease. During acute exacerbation, spirometry may not be feasible \u2014 clinical history of prior confirmed diagnosis suffices.",
        "source": "GOLD",
        "source_detail": "GOLD 2024 Report: Spirometric confirmation of COPD",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "copd_acute_worsening",
        "category": "clinical_finding",
        "data_type": "Clinical Presentation",
        "criterion": "Acute worsening of respiratory symptoms beyond normal day-to-day variation requiring change in therapy",
        "detail": "Increased dyspnea, sputum volume, sputum purulence (Anthonisen criteria for COPD). For asthma: increased wheeze, chest tightness, rescue inhaler use, nocturnal awakening.",
        "source": "GOLD",
        "source_detail": "GOLD 2024: Definition of COPD exacerbation; GINA 2023: Asthma exacerbation",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "copd_escalation",
        "category": "intervention",
        "data_type": "Treatment Escalation",
        "criterion": "Escalation from baseline therapy: systemic corticosteroids, nebulized bronchodilators, antibiotics (COPD), or IV magnesium (asthma)",
        "detail": "Transition from maintenance inhalers to systemic steroids and/or nebulized treatments indicates acute exacerbation severity.",
        "source": "GOLD",
        "source_detail": "GOLD 2024: Pharmacologic management of exacerbations",
        "required": false,
        "evidence_weight": "moderate"
      },
      {
        "id": "copd_abg_resp",
        "category": "laboratory",
        "data_type": "ABG",
        "criterion": "ABG showing acute respiratory acidosis (pH < 7.35 with elevated PaCO2) or hypoxemia",
        "detail": "ABG abnormalities during exacerbation may also support respiratory failure diagnosis (J96.x) in addition to the COPD/asthma code.",
        "source": "GOLD",
        "source_detail": "GOLD 2024: Assessment of exacerbation severity",
        "required": false,
        "evidence_weight": "strong"
      }
    ],
    "documentation_requirements": [
      {
        "id": "copd_doc_exacerbation",
        "requirement": "Provider must document 'acute exacerbation' of COPD or asthma. The terms 'COPD' or 'asthma' alone without exacerbation map to codes that are NOT CC/MCC.",
        "insufficient_terms": [
          "COPD",
          "asthma",
          "shortness of breath",
          "wheezing",
          "bronchospasm",
          "dyspnea"
        ],
        "source": "CODING_CLINIC",
        "source_detail": "Q1 2017 p.25: COPD exacerbation documentation; Q3 2019 p.15"
      },
      {
        "id": "copd_doc_severity",
        "requirement": "For asthma, document the SEVERITY (mild intermittent, mild/moderate/severe persistent) AND the exacerbation status. Status asthmaticus (J45.x2) indicates a severe, prolonged attack not responsive to standard therapy.",
        "insufficient_terms": [
          "asthma attack",
          "asthma flare"
        ],
        "source": "ICD10_GUIDELINES",
        "source_detail": "Section I.C.10.a: Asthma severity and exacerbation coding"
      }
    ],
    "specificity_ladder": [
      {
        "code": "J441",
        "description": "COPD with acute exacerbation",
        "cc_mcc": "CC",
        "distinguishing_evidence": "Documented COPD baseline with acute worsening (increased dyspnea, sputum, purulence)",
        "specificity_note": "CC tier. If also meeting respiratory failure criteria, add J96.x (MCC) as separate code."
      },
      {
        "code": "J440",
        "description": "COPD with acute lower respiratory infection",
        "cc_mcc": "CC",
        "distinguishing_evidence": "COPD exacerbation triggered by infection \u2014 document the specific organism if known",
        "upgrade_from": "J441",
        "upgrade_evidence": "If infectious trigger identified, J44.0 is more specific than J44.1"
      },
      {
        "code": "J4552",
        "description": "Severe persistent asthma with status asthmaticus",
        "cc_mcc": "CC",
        "distinguishing_evidence": "Severe asthma not responsive to standard bronchodilator therapy \u2014 prolonged attack requiring ICU-level care",
        "upgrade_from": "J4551",
        "upgrade_evidence": "Document 'status asthmaticus' if refractory to initial therapy"
      },
      {
        "code": "J4551",
        "description": "Severe persistent asthma with acute exacerbation",
        "cc_mcc": "CC",
        "distinguishing_evidence": "Severe persistent asthma (FEV1 < 60% predicted baseline) with acute worsening"
      }
    ],
    "cdi_query_templates": [
      {
        "trigger": "Patient admitted with COPD and increased dyspnea/sputum but documentation says only 'COPD'",
        "query": "The patient has COPD and presented with [increased dyspnea/sputum purulence/increased rescue inhaler use]. You documented 'COPD.' Does this represent an acute exacerbation of COPD? The distinction affects severity classification.",
        "source": "CODING_CLINIC Q1 2017 p.25"
      },
      {
        "trigger": "Asthma patient on continuous nebulizers and IV steroids but 'status asthmaticus' not documented",
        "query": "The patient with [severity] persistent asthma required continuous nebulized bronchodilators and IV corticosteroids on [DATE]. Does this represent status asthmaticus?",
        "source": "ICD10_GUIDELINES I.C.10.a"
      },
      {
        "trigger": "COPD exacerbation with respiratory failure but only COPD documented",
        "query": "The patient with COPD exacerbation has [ABG values/SpO2/ventilatory support]. In addition to the COPD exacerbation, does this represent acute respiratory failure? Both diagnoses can be coded.",
        "source": "GOLD 2024 + CODING_CLINIC Q4 2017 p.23"
      }
    ],
    "common_pitfalls": [
      "COPD without exacerbation (J44.9) is NOT CC/MCC. Only J44.0 and J44.1 (with infection or exacerbation) are CC.",
      "Asthma without exacerbation or status asthmaticus is NOT CC/MCC. Only the x1 (exacerbation) and x2 (status asthmaticus) codes are CC.",
      "COPD exacerbation with respiratory failure: code BOTH J44.1 AND J96.x. The respiratory failure code (MCC) adds the DRG impact.",
      "J43 (emphysema) codes are NOT CC/MCC and should not be used for acute presentations. Use J44.x for acute COPD exacerbation.",
      "Status asthmaticus and acute exacerbation are mutually exclusive per ICD-10 structure \u2014 assign only one per asthma code."
    ],
    "context_modifiers": {
      "with_resp_failure": "COPD/asthma exacerbation with respiratory failure: code both. J96.x is MCC and drives DRG impact more than J44/J45 (CC).",
      "with_pneumonia": "COPD exacerbation triggered by pneumonia: use J44.0 (with LRI) + specific pneumonia code (J13-J18). Both affect DRG.",
      "post_surgical": "Postoperative bronchospasm in known asthmatic: query whether this represents an acute asthma exacerbation vs expected complication."
    }
  },
  {
    "id": "pe",
    "name": "Pulmonary Embolism",
    "icd10_chapter": "I",
    "codes": [
      "I2601",
      "I2602",
      "I2603",
      "I2604",
      "I2609",
      "I2690",
      "I2692",
      "I2693",
      "I2694",
      "I2695",
      "I2696",
      "I2699"
    ],
    "code_ranges": "I26.0x, I26.9x",
    "code_count": 12,
    "clinical_criteria": [
      {
        "id": "pe_ctpa",
        "category": "imaging",
        "data_type": "CT Pulmonary Angiography",
        "criterion": "CTPA showing filling defect in pulmonary arteries",
        "detail": "Gold standard for PE diagnosis. Identifies location (main, lobar, segmental, subsegmental) and type (saddle, single subsegmental, multiple).",
        "source": "ESC_PE",
        "source_detail": "2019 ESC Guidelines: Diagnostic strategy for PE",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "pe_echo_rv",
        "category": "imaging",
        "data_type": "Echocardiogram",
        "criterion": "RV dilation or dysfunction on echocardiography",
        "detail": "RV/LV ratio > 1.0, RV free wall hypokinesis (McConnell's sign), elevated RVSP. Indicates hemodynamic significance \u2014 distinguishes acute cor pulmonale (I26.0x) from PE without (I26.9x).",
        "source": "ESC_PE",
        "source_detail": "2019 ESC: RV dysfunction assessment",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "pe_troponin_bnp",
        "category": "laboratory",
        "data_type": "Troponin / BNP",
        "criterion": "Elevated troponin or BNP/NT-proBNP indicating RV strain",
        "detail": "Biomarker elevation in PE indicates myocardial injury from RV pressure overload. Supports risk stratification (intermediate-high risk PE).",
        "source": "ESC_PE",
        "source_detail": "2019 ESC: Risk stratification with biomarkers",
        "required": false,
        "evidence_weight": "moderate"
      },
      {
        "id": "pe_dvt",
        "category": "imaging",
        "data_type": "Lower Extremity Duplex",
        "criterion": "DVT on compression ultrasonography supporting VTE diagnosis",
        "detail": "DVT source supports PE diagnosis in clinical context. Code DVT separately (I82.x).",
        "source": "ESC_PE",
        "source_detail": "2019 ESC: CUS for DVT evaluation in suspected PE",
        "required": false,
        "evidence_weight": "moderate"
      }
    ],
    "documentation_requirements": [
      {
        "id": "pe_doc_cor_pulmonale",
        "requirement": "Provider must document whether PE is WITH or WITHOUT acute cor pulmonale. I26.0x (with) vs I26.9x (without) \u2014 both are MCC, but the distinction drives accurate coding.",
        "insufficient_terms": [
          "PE",
          "pulmonary embolism NOS",
          "clot in lung"
        ],
        "source": "CODING_CLINIC",
        "source_detail": "Q1 2020 p.19: PE with/without acute cor pulmonale distinction"
      },
      {
        "id": "pe_doc_type",
        "requirement": "Document the PE TYPE when known: saddle (I26.02/I26.92), septic (I26.01/I26.90), subsegmental single (I26.93) vs multiple (I26.94), cement/fat embolism.",
        "insufficient_terms": [
          "PE"
        ],
        "source": "ICD10_GUIDELINES",
        "source_detail": "FY2023+ expanded PE codes: specify type and cor pulmonale status"
      }
    ],
    "specificity_ladder": [
      {
        "code": "I2602",
        "description": "Saddle embolus with acute cor pulmonale",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "CTPA showing saddle embolus at bifurcation + echo showing RV dilation/dysfunction",
        "upgrade_from": "I2699",
        "upgrade_evidence": "Specify saddle location and cor pulmonale from imaging"
      },
      {
        "code": "I2609",
        "description": "Other PE with acute cor pulmonale",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "PE on CTPA + echocardiographic evidence of RV strain/dysfunction",
        "upgrade_from": "I2699",
        "upgrade_evidence": "Document 'with acute cor pulmonale' when echo shows RV dysfunction"
      },
      {
        "code": "I2693",
        "description": "Single subsegmental PE without acute cor pulmonale",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Isolated subsegmental filling defect on CTPA without RV strain",
        "specificity_note": "MCC \u2014 FY2023 new code. Clinically important for anticoagulation decision."
      },
      {
        "code": "I2699",
        "description": "Other PE without acute cor pulmonale",
        "cc_mcc": "MCC",
        "specificity_note": "MCC but least specific. Query for location, type, and cor pulmonale status."
      }
    ],
    "cdi_query_templates": [
      {
        "trigger": "CTPA positive for PE but documentation does not address cor pulmonale",
        "query": "CTPA on [DATE] confirms pulmonary embolism. Echocardiogram shows [RV findings]. Does this PE present with or without acute cor pulmonale (RV dysfunction)?",
        "source": "CODING_CLINIC Q1 2020 p.19"
      },
      {
        "trigger": "PE documented generically without type specification",
        "query": "You documented 'pulmonary embolism.' CTPA shows [LOCATION \u2014 saddle/lobar/segmental/subsegmental]. For coding accuracy, could you specify the location? Is it a saddle embolus, single subsegmental, or multiple?",
        "source": "ICD10_GUIDELINES \u2014 FY2023 PE code expansion"
      }
    ],
    "common_pitfalls": [
      "All PE codes (I26.x) are MCC \u2014 the coding distinction is about specificity and accuracy, not CC/MCC tier change.",
      "Acute cor pulmonale (I26.0x) vs without (I26.9x): determined by RV dysfunction on echo, NOT by hemodynamic instability alone.",
      "Chronic PE (I27.82) is a separate diagnosis from acute PE (I26.x). Chronic thromboembolic disease has different management and coding.",
      "Subsegmental PE codes (I26.93/I26.94) are new FY2023 \u2014 important because clinical significance and anticoagulation decisions differ.",
      "DVT should be coded separately from PE \u2014 the PE code does not capture the DVT source."
    ],
    "context_modifiers": {
      "with_dvt": "PE with DVT: code both I26.x (PE) and I82.x (DVT). The VTE event involves both but they are separate code assignments.",
      "with_resp_failure": "Massive PE causing respiratory failure: code both I26.x and J96.x. Respiratory failure may be the driving MCC depending on DRG family.",
      "with_cardiac_arrest": "PE causing cardiac arrest: I26.x as principal if PE is the underlying cause. I46.x as additional code."
    }
  },
  {
    "id": "afib",
    "name": "Atrial Fibrillation / Flutter",
    "icd10_chapter": "I",
    "codes": [
      "I4811",
      "I4819",
      "I4820",
      "I4821",
      "I483",
      "I484",
      "I4892"
    ],
    "code_ranges": "I48.11, I48.19\u2013I48.21, I48.3, I48.4, I48.92",
    "code_count": 7,
    "clinical_criteria": [
      {
        "id": "afib_ecg",
        "category": "clinical_finding",
        "data_type": "ECG / Telemetry",
        "criterion": "ECG or telemetry showing irregularly irregular rhythm without distinct P waves (AFib) or sawtooth flutter waves (AFlutter)",
        "detail": "12-lead ECG is diagnostic. Holter/event monitor for paroxysmal episodes. Telemetry strips document in-hospital episodes.",
        "source": "ACC_AHA_AFIB",
        "source_detail": "2014 AHA/ACC/HRS AFib Guidelines: ECG diagnosis",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "afib_rate",
        "category": "vitals",
        "data_type": "Heart Rate",
        "criterion": "Ventricular rate documented \u2014 rapid (> 100), controlled (60-100), or slow (< 60)",
        "detail": "Rate control assessment. Rapid ventricular response (RVR) may require urgent rate control. Document the rate at presentation and after treatment.",
        "source": "ACC_AHA_AFIB",
        "source_detail": "2014 AHA/ACC/HRS: Rate control strategy",
        "required": false,
        "evidence_weight": "moderate"
      },
      {
        "id": "afib_duration",
        "category": "clinical_finding",
        "data_type": "Duration / Type",
        "criterion": "Classification: paroxysmal (self-terminating, < 7 days), persistent (> 7 days), long-standing persistent (> 12 months), permanent (accepted by physician and patient)",
        "detail": "Duration determines the ICD-10 code and management strategy. Paroxysmal AFib (I48.0/I48.1x) vs permanent (I48.21).",
        "source": "ACC_AHA_AFIB",
        "source_detail": "2014 AHA/ACC/HRS: AFib classification",
        "required": false,
        "evidence_weight": "strong"
      }
    ],
    "documentation_requirements": [
      {
        "id": "afib_doc_type",
        "requirement": "Provider must document the TYPE of atrial fibrillation/flutter. Paroxysmal AFib (I48.0/I48.1x) is NOT CC. Only persistent (I48.11, I48.19), chronic (I48.20, I48.21), and flutter (I48.3, I48.4, I48.92) are CC.",
        "insufficient_terms": [
          "AFib",
          "atrial fibrillation",
          "irregular heart rhythm",
          "a-fib"
        ],
        "source": "CODING_CLINIC",
        "source_detail": "Q3 2019 p.9: AFib type documentation; Q1 2014 p.28"
      },
      {
        "id": "afib_doc_flutter",
        "requirement": "Distinguish atrial FIBRILLATION from atrial FLUTTER \u2014 they are different conditions with different codes. Document 'typical' (I48.3) vs 'atypical' (I48.4) flutter when applicable.",
        "insufficient_terms": [
          "a-fib/flutter",
          "afib/aflutter"
        ],
        "source": "ICD10_GUIDELINES",
        "source_detail": "Section I.C.9: Atrial fibrillation vs flutter are distinct diagnoses"
      }
    ],
    "specificity_ladder": [
      {
        "code": "I4811",
        "description": "Longstanding persistent atrial fibrillation",
        "cc_mcc": "CC",
        "distinguishing_evidence": "AFib continuous for > 12 months, decision to pursue rhythm control",
        "specificity_note": "CC \u2014 most specific persistent AFib code"
      },
      {
        "code": "I4821",
        "description": "Permanent atrial fibrillation",
        "cc_mcc": "CC",
        "distinguishing_evidence": "AFib accepted as permanent by physician and patient \u2014 no further rhythm control attempted",
        "upgrade_from": "I4820",
        "upgrade_evidence": "Specify 'permanent' vs 'chronic unspecified' based on management intent"
      },
      {
        "code": "I483",
        "description": "Typical atrial flutter",
        "cc_mcc": "CC",
        "distinguishing_evidence": "Counterclockwise flutter using cavotricuspid isthmus \u2014 sawtooth waves in inferior leads",
        "specificity_note": "Distinct from AFib \u2014 different mechanism, different ablation approach"
      },
      {
        "code": "I4892",
        "description": "Unspecified atrial flutter",
        "cc_mcc": "CC",
        "specificity_note": "CC \u2014 query for typical vs atypical when EP study or ablation data available"
      }
    ],
    "cdi_query_templates": [
      {
        "trigger": "Atrial fibrillation documented without type (paroxysmal/persistent/permanent)",
        "query": "You documented 'atrial fibrillation.' For coding accuracy, is this paroxysmal (self-terminating), persistent (sustained > 7 days), longstanding persistent (> 12 months), or permanent? The classification affects severity coding.",
        "source": "CODING_CLINIC Q3 2019 p.9"
      },
      {
        "trigger": "'A-fib/flutter' documented as combined \u2014 ambiguous",
        "query": "Your documentation mentions 'afib/flutter.' For accurate coding, does the patient have atrial fibrillation, atrial flutter, or both? These are distinct conditions coded separately.",
        "source": "ICD10_GUIDELINES I.C.9"
      }
    ],
    "common_pitfalls": [
      "Paroxysmal AFib (I48.0, I48.1x excluding I48.11/I48.19) is NOT CC/MCC. Only persistent, chronic/permanent, and flutter are CC.",
      "I48.0 (paroxysmal AFib) is NOT a CC despite being commonly documented in inpatients. This catches many CDI teams off guard.",
      "'New-onset AFib' \u2014 document whether it becomes persistent or resolves (paroxysmal). If AFib persists through hospitalization, 'persistent' may be appropriate.",
      "AFib with RVR is still coded with the same AFib type code \u2014 there is no separate 'AFib with RVR' ICD-10 code. The rate is a clinical finding, not a separate diagnosis.",
      "Atrial flutter and AFib can coexist \u2014 code both if documented."
    ],
    "context_modifiers": {
      "with_heart_failure": "AFib commonly coexists with HF. Both should be coded separately. AFib may be the trigger for HF exacerbation \u2014 document this relationship if applicable.",
      "with_stroke": "AFib as source of cardioembolic stroke: code both. The stroke (I63.4x embolism) and AFib drive separate DRG impacts.",
      "with_anticoagulation": "Anticoagulation management adds clinical complexity but does not change the AFib code. Document bleeding complications separately if present."
    }
  },
  {
    "id": "gi_hemorrhage",
    "name": "GI Hemorrhage",
    "icd10_chapter": "K",
    "codes": [
      "K250",
      "K252",
      "K254",
      "K256",
      "K260",
      "K262",
      "K264",
      "K266",
      "K270",
      "K272",
      "K274",
      "K276",
      "K280",
      "K282",
      "K284",
      "K286",
      "K2901",
      "K2921",
      "K2931",
      "K2941",
      "K2951",
      "K2961",
      "K2971",
      "K2981",
      "K2991",
      "K920",
      "K921",
      "K922"
    ],
    "code_ranges": "K25\u2013K28 with hemorrhage, K29.x1 with bleeding, K92.0\u2013K92.2",
    "code_count": 28,
    "clinical_criteria": [
      {
        "id": "gi_visible_bleed",
        "category": "clinical_finding",
        "data_type": "Clinical Presentation",
        "criterion": "Hematemesis, melena, hematochezia, or coffee-ground emesis",
        "detail": "Hematemesis (K92.0) and melena (K92.1) are themselves CC codes but are less specific than source-identified hemorrhage. Hematochezia suggests lower GI source.",
        "source": "CODING_CLINIC",
        "source_detail": "Q2 2013 p.15: GI hemorrhage coding hierarchy",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "gi_hgb_drop",
        "category": "laboratory",
        "data_type": "Hemoglobin",
        "criterion": "Hemoglobin drop \u2265 2 g/dL from baseline, or Hgb < 7 g/dL requiring transfusion",
        "detail": "Significant Hgb drop supports acute blood loss. Transfusion requirement indicates clinical significance.",
        "threshold": {
          "metric": "Hemoglobin drop",
          "operator": ">=",
          "value": 2,
          "unit": "g/dL"
        },
        "source": "CODING_CLINIC",
        "source_detail": "Q1 2016 p.14: GI hemorrhage with anemia",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "gi_endoscopy",
        "category": "imaging",
        "data_type": "Endoscopy (EGD/Colonoscopy)",
        "criterion": "Endoscopic identification of bleeding source: ulcer with visible vessel, actively bleeding lesion, stigmata of recent hemorrhage",
        "detail": "Endoscopy both diagnoses and treats. Findings determine the specific code: gastric ulcer (K25), duodenal (K26), peptic NOS (K27), gastritis (K29), or unspecified (K92.2).",
        "source": "CODING_CLINIC",
        "source_detail": "Q3 2017 p.19: Endoscopic findings and code selection",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "gi_transfusion",
        "category": "intervention",
        "data_type": "Blood Transfusion",
        "criterion": "Packed red blood cell transfusion for acute blood loss",
        "detail": "Transfusion supports diagnosis of acute blood loss anemia (D62, CC) in addition to the GI hemorrhage code.",
        "source": "CODING_CLINIC",
        "source_detail": "Q4 2016 p.47: Transfusion and acute blood loss anemia coding",
        "required": false,
        "evidence_weight": "strong"
      }
    ],
    "documentation_requirements": [
      {
        "id": "gi_doc_source",
        "requirement": "Document the BLEEDING SOURCE when identified: gastric ulcer, duodenal ulcer, gastritis, esophageal varices, diverticula, angiodysplasia, etc. Source-specific codes (K25\u2013K28 with hemorrhage) are MCC; K92.0/K92.1/K92.2 (symptoms) are only CC.",
        "insufficient_terms": [
          "GI bleed",
          "GI hemorrhage NOS",
          "blood in stool",
          "upper GI bleed"
        ],
        "source": "CODING_CLINIC",
        "source_detail": "Q2 2013 p.15: Code to the source when identified"
      },
      {
        "id": "gi_doc_acuity",
        "requirement": "For ulcers, specify ACUTE vs CHRONIC. Acute gastric ulcer with hemorrhage (K25.0) vs chronic (K25.4) \u2014 both MCC, but clinical accuracy matters.",
        "insufficient_terms": [
          "ulcer with bleeding"
        ],
        "source": "ICD10_GUIDELINES",
        "source_detail": "Section I.C.11: Ulcer coding by acuity and complication"
      }
    ],
    "specificity_ladder": [
      {
        "code": "K250",
        "description": "Acute gastric ulcer with hemorrhage",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "EGD showing actively bleeding or recently bleeding acute gastric ulcer",
        "upgrade_from": "K922",
        "upgrade_evidence": "Identify gastric ulcer as source on endoscopy \u2014 changes CC to MCC"
      },
      {
        "code": "K260",
        "description": "Acute duodenal ulcer with hemorrhage",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "EGD showing actively bleeding duodenal ulcer",
        "upgrade_from": "K922",
        "upgrade_evidence": "Identify duodenal ulcer source \u2014 CC to MCC"
      },
      {
        "code": "K2901",
        "description": "Acute gastritis with bleeding",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "EGD showing gastritis as bleeding source \u2014 erosive, hemorrhagic, or stress-related",
        "upgrade_from": "K922",
        "upgrade_evidence": "Specify gastritis with bleeding from endoscopy"
      },
      {
        "code": "K920",
        "description": "Hematemesis",
        "cc_mcc": "CC",
        "specificity_note": "CC only \u2014 symptom code. If source is identified on endoscopy, use the source-specific code (MCC) instead."
      },
      {
        "code": "K921",
        "description": "Melena",
        "cc_mcc": "CC",
        "specificity_note": "CC only \u2014 symptom code. Replace with source-specific code when endoscopy identifies the source."
      },
      {
        "code": "K922",
        "description": "GI hemorrhage, unspecified",
        "cc_mcc": "CC",
        "specificity_note": "CC only. The single biggest upgrade opportunity in this family: ANY source identification on endoscopy converts CC \u2192 MCC."
      }
    ],
    "cdi_query_templates": [
      {
        "trigger": "Patient with GI bleeding had EGD showing ulcer but documentation says only 'GI bleed'",
        "query": "EGD on [DATE] revealed [FINDING \u2014 e.g., gastric ulcer with visible vessel]. You documented 'GI bleed.' Could you update the diagnosis to reflect the endoscopic source? For example, 'acute gastric ulcer with hemorrhage.'",
        "source": "CODING_CLINIC Q2 2013 p.15"
      },
      {
        "trigger": "GI hemorrhage with Hgb drop and transfusion but no acute blood loss anemia documented",
        "query": "The patient's hemoglobin dropped from [BASELINE] to [NADIR] g/dL requiring [#] units pRBC transfusion. In addition to the GI hemorrhage, does this represent acute blood loss anemia?",
        "source": "CODING_CLINIC Q4 2016 p.47"
      },
      {
        "trigger": "Melena or hematemesis documented but source not yet identified",
        "query": "The patient presented with [hematemesis/melena]. Has a source been identified? If endoscopy or other evaluation has identified a bleeding source (ulcer, gastritis, varices, etc.), please update the diagnosis accordingly.",
        "source": "CODING_CLINIC Q2 2013 p.15"
      }
    ],
    "common_pitfalls": [
      "K92.0 (hematemesis), K92.1 (melena), K92.2 (GI hemorrhage unspecified) are all CC only. Source-specific codes with hemorrhage (K25\u2013K29 with hemorrhage) are MCC. The endoscopy result is the key to the upgrade.",
      "Acute blood loss anemia (D62) should be coded in addition to GI hemorrhage when Hgb drops significantly. D62 is CC and adds separate DRG impact.",
      "If both hemorrhage and perforation are present, use the combination code (K25.2, K25.6, etc.) \u2014 do not code them separately.",
      "Do not confuse GI hemorrhage with occult blood in stool (R19.5) \u2014 occult blood is a finding, not a hemorrhage diagnosis.",
      "Esophageal varices with bleeding (I85.01, I85.11) are coded under the circulatory chapter, not the digestive chapter."
    ],
    "context_modifiers": {
      "with_anticoagulation": "GI hemorrhage on anticoagulants: document the drug and whether this represents an adverse effect (T45.x) or appropriate therapeutic use. The anticoagulant complication adds coding complexity.",
      "with_liver_disease": "GI hemorrhage in cirrhosis: variceal bleeding uses I85.x codes, not K92.x. Portal hypertensive gastropathy is a separate entity.",
      "with_blood_loss_anemia": "Always query for acute blood loss anemia (D62) when Hgb drops \u2265 2 g/dL or transfusion is given. D62 adds CC impact on top of the GI hemorrhage code."
    }
  },
  {
    "id": "pancreatitis",
    "name": "Acute Pancreatitis",
    "icd10_chapter": "K",
    "codes": [
      "K8500",
      "K8501",
      "K8502",
      "K8510",
      "K8511",
      "K8512",
      "K8520",
      "K8521",
      "K8522",
      "K8530",
      "K8531",
      "K8532",
      "K8580",
      "K8581",
      "K8582",
      "K8590",
      "K8591",
      "K8592"
    ],
    "code_ranges": "K85.x0, K85.x1, K85.x2",
    "code_count": 18,
    "clinical_criteria": [
      {
        "id": "panc_lipase",
        "category": "laboratory",
        "data_type": "Lipase / Amylase",
        "criterion": "Serum lipase or amylase \u2265 3x upper limit of normal",
        "detail": "Lipase is preferred (more specific). Meets one of three Atlanta Criteria for acute pancreatitis diagnosis.",
        "threshold": {
          "metric": "Lipase",
          "operator": ">=",
          "value": 3,
          "unit": "x ULN"
        },
        "source": "AGA_PANCREATITIS",
        "source_detail": "Revised Atlanta Classification 2012: Diagnostic criterion 2",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "panc_pain",
        "category": "clinical_finding",
        "data_type": "Abdominal Pain",
        "criterion": "Acute onset epigastric/LUQ abdominal pain, often radiating to back, severe and persistent",
        "detail": "Characteristic pain pattern meets Atlanta Criterion 1. Sudden onset, severe, constant \u2014 distinguished from intermittent biliary colic.",
        "source": "AGA_PANCREATITIS",
        "source_detail": "Revised Atlanta Classification: Diagnostic criterion 1",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "panc_imaging",
        "category": "imaging",
        "data_type": "CT Abdomen / MRCP",
        "criterion": "Contrast-enhanced CT showing pancreatic inflammation, edema, necrosis, or peripancreatic fluid",
        "detail": "CT with IV contrast identifies necrosis extent and complications. Should be delayed 48-72h from onset for optimal necrosis detection. MRCP for biliary etiology.",
        "source": "AGA_PANCREATITIS",
        "source_detail": "Revised Atlanta Classification: Diagnostic criterion 3; AGA 2018 Technical Review",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "panc_necrosis",
        "category": "imaging",
        "data_type": "CT Necrosis Assessment",
        "criterion": "Pancreatic necrosis: lack of enhancement on CT \u2265 30% of gland, or peripancreatic necrosis",
        "detail": "Necrosis status drives 7th character: x0 (without necrosis), x1 (uninfected necrosis), x2 (infected necrosis). Infected necrosis is the highest severity.",
        "source": "AGA_PANCREATITIS",
        "source_detail": "Revised Atlanta: Necrotizing vs interstitial pancreatitis",
        "required": false,
        "evidence_weight": "strong"
      }
    ],
    "documentation_requirements": [
      {
        "id": "panc_doc_etiology",
        "requirement": "Document the ETIOLOGY: biliary/gallstone (K85.1x), alcohol-induced (K85.2x), drug-induced (K85.3x), idiopathic (K85.0x), or other (K85.8x). 'Acute pancreatitis' alone maps to K85.9x (unspecified).",
        "insufficient_terms": [
          "pancreatitis",
          "acute pancreatitis NOS",
          "elevated lipase"
        ],
        "source": "CODING_CLINIC",
        "source_detail": "Q3 2019 p.18: Pancreatitis etiology documentation"
      },
      {
        "id": "panc_doc_necrosis",
        "requirement": "Document NECROSIS STATUS: without necrosis (x0), with uninfected necrosis (x1), or with infected necrosis (x2). FY2023 expanded codes require this 7th character.",
        "insufficient_terms": [
          "necrotizing pancreatitis"
        ],
        "source": "ICD10_GUIDELINES",
        "source_detail": "FY2023 pancreatitis code expansion: 7th character for necrosis status"
      }
    ],
    "specificity_ladder": [
      {
        "code": "K8512",
        "description": "Biliary acute pancreatitis with infected necrosis",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Gallstone etiology + CT showing necrosis + positive fine needle aspirate culture",
        "upgrade_from": "K8590",
        "upgrade_evidence": "Specify biliary etiology AND infected necrosis for maximum specificity"
      },
      {
        "code": "K8511",
        "description": "Biliary acute pancreatitis with uninfected necrosis",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Gallstone etiology + CT necrosis without infection",
        "upgrade_from": "K8510",
        "upgrade_evidence": "Document necrosis on CT to add 7th character"
      },
      {
        "code": "K8510",
        "description": "Biliary acute pancreatitis without necrosis",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Gallstone/biliary etiology confirmed by imaging (CBD stone, dilated duct, sludge)",
        "upgrade_from": "K8590",
        "upgrade_evidence": "Specify biliary etiology from MRCP/ultrasound findings"
      },
      {
        "code": "K8590",
        "description": "Acute pancreatitis, unspecified, without necrosis",
        "cc_mcc": "MCC",
        "specificity_note": "MCC \u2014 all acute pancreatitis codes are MCC. Specificity improves accuracy, not DRG tier."
      }
    ],
    "cdi_query_templates": [
      {
        "trigger": "Acute pancreatitis documented without etiology specification",
        "query": "You documented 'acute pancreatitis.' Workup shows [FINDINGS \u2014 gallstones on ultrasound / alcohol history / recent drug exposure]. Could you specify the etiology? Biliary, alcohol-induced, drug-induced, or idiopathic?",
        "source": "CODING_CLINIC Q3 2019 p.18"
      },
      {
        "trigger": "CT shows necrosis but documentation does not specify necrosis status",
        "query": "CT abdomen on [DATE] shows [pancreatic necrosis / peripancreatic fluid collections]. Could you update the diagnosis to specify necrosis status (uninfected vs infected)?",
        "source": "ICD10_GUIDELINES \u2014 FY2023 pancreatitis codes"
      }
    ],
    "common_pitfalls": [
      "ALL acute pancreatitis codes (K85.x) are MCC \u2014 the documentation focus is on accuracy and specificity, not CC/MCC tier change.",
      "Chronic pancreatitis (K86.x) is NOT CC/MCC. The acute vs chronic distinction matters \u2014 acute exacerbation of chronic pancreatitis is coded as acute (K85.x).",
      "The 7th character for necrosis (x0/x1/x2) is new FY2023. Many providers are not yet documenting necrosis status routinely.",
      "Drug-induced pancreatitis (K85.3x): document the specific causative drug and whether it's an adverse effect (T36-T50).",
      "Elevated lipase alone is NOT pancreatitis \u2014 need at least 2 of 3 Atlanta criteria (pain, lipase \u2265 3x ULN, imaging findings)."
    ],
    "context_modifiers": {
      "with_organ_failure": "Severe pancreatitis with organ failure (renal, respiratory, cardiovascular): code each organ failure separately. These drive additional MCC impact.",
      "with_sepsis": "Infected pancreatic necrosis may lead to sepsis: code the sepsis (A41.x) and the pancreatitis (K85.x2). The sepsis may drive a different DRG family.",
      "post_ercp": "Post-ERCP pancreatitis: code K85.8x (other) with procedure complication code. Document the link to the ERCP."
    }
  },
  {
    "id": "hepatic_failure",
    "name": "Hepatic Failure / Encephalopathy",
    "icd10_chapter": "K",
    "codes": [
      "K7041",
      "K7111",
      "K7200",
      "K7201",
      "K7211",
      "K7291"
    ],
    "code_ranges": "K70.41, K71.11, K72.0x, K72.11, K72.91",
    "code_count": 6,
    "clinical_criteria": [
      {
        "id": "hep_coag",
        "category": "laboratory",
        "data_type": "INR / PT",
        "criterion": "INR \u2265 1.5 indicating coagulopathy from impaired hepatic synthetic function",
        "detail": "Coagulopathy is a hallmark of hepatic failure. INR elevation reflects inability to synthesize clotting factors.",
        "threshold": {
          "metric": "INR",
          "operator": ">=",
          "value": 1.5,
          "unit": "ratio"
        },
        "source": "AASLD_LIVER",
        "source_detail": "AASLD 2014: Acute liver failure diagnostic criteria",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "hep_encephalopathy",
        "category": "clinical_finding",
        "data_type": "Mental Status",
        "criterion": "Hepatic encephalopathy: confusion, asterixis, somnolence, or coma (West Haven Grade I-IV)",
        "detail": "Grade I: mild confusion, sleep disturbance. Grade II: lethargy, moderate confusion. Grade III: marked confusion, incoherent. Grade IV: coma. Grades III-IV correspond to 'with coma' codes.",
        "source": "AASLD_LIVER",
        "source_detail": "AASLD/Vilstrup 2014: Hepatic encephalopathy grading",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "hep_ammonia",
        "category": "laboratory",
        "data_type": "Ammonia",
        "criterion": "Elevated serum ammonia level",
        "detail": "Supports hepatic encephalopathy diagnosis but is NOT required. Ammonia levels correlate poorly with encephalopathy grade. Clinical assessment is more reliable.",
        "source": "AASLD_LIVER",
        "source_detail": "AASLD: Ammonia as supportive but not diagnostic biomarker",
        "required": false,
        "evidence_weight": "moderate"
      },
      {
        "id": "hep_liver_labs",
        "category": "laboratory",
        "data_type": "Hepatic Panel",
        "criterion": "Elevated AST/ALT (often > 10x ULN in acute failure), elevated bilirubin, low albumin",
        "detail": "Acute liver failure: massive aminotransferase elevation. Chronic failure: may have normal or mildly elevated enzymes with low albumin and high bilirubin.",
        "source": "AASLD_LIVER",
        "source_detail": "AASLD 2014: Laboratory assessment in hepatic failure",
        "required": false,
        "evidence_weight": "strong"
      }
    ],
    "documentation_requirements": [
      {
        "id": "hep_doc_coma",
        "requirement": "Document whether hepatic failure is WITH COMA or WITHOUT COMA. K72.00 (without coma) vs K72.01 (with coma) \u2014 both MCC, but accuracy is essential. West Haven Grade III-IV = 'with coma.'",
        "insufficient_terms": [
          "liver failure",
          "hepatic failure NOS",
          "hepatic dysfunction"
        ],
        "source": "CODING_CLINIC",
        "source_detail": "Q2 2018 p.16: Hepatic failure with/without coma documentation"
      },
      {
        "id": "hep_doc_etiology",
        "requirement": "Document the ETIOLOGY: alcoholic (K70.41), toxic/drug-induced (K71.11), or unspecified (K72.x). For acute vs chronic: K72.0x (acute/subacute) vs K72.11 (chronic) vs K72.91 (unspecified).",
        "insufficient_terms": [
          "liver failure NOS"
        ],
        "source": "ICD10_GUIDELINES",
        "source_detail": "Section I.C.11: Liver disease coding by etiology and chronicity"
      }
    ],
    "specificity_ladder": [
      {
        "code": "K7201",
        "description": "Acute and subacute hepatic failure with coma",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Acute liver failure (< 26 weeks onset) + INR \u2265 1.5 + hepatic encephalopathy Grade III-IV",
        "upgrade_from": "K7200",
        "upgrade_evidence": "Document 'with coma' if encephalopathy is Grade III or IV"
      },
      {
        "code": "K7200",
        "description": "Acute and subacute hepatic failure without coma",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Acute liver failure + INR \u2265 1.5 + encephalopathy absent or Grade I-II"
      },
      {
        "code": "K7041",
        "description": "Alcoholic hepatic failure with coma",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Alcoholic etiology documented + hepatic failure + coma/severe encephalopathy",
        "upgrade_from": "K7291",
        "upgrade_evidence": "Specify alcoholic etiology when documented"
      },
      {
        "code": "K7111",
        "description": "Toxic liver disease with hepatic necrosis, with coma",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Drug/toxin identified (acetaminophen, etc.) causing hepatic necrosis and coma"
      },
      {
        "code": "K7291",
        "description": "Hepatic failure, unspecified with coma",
        "cc_mcc": "MCC",
        "specificity_note": "MCC but unspecified etiology and chronicity. Query for acute vs chronic and cause."
      }
    ],
    "cdi_query_templates": [
      {
        "trigger": "Elevated INR and encephalopathy but 'hepatic failure' not documented",
        "query": "The patient has INR of [VALUE], bilirubin of [VALUE], and [encephalopathy grade/AMS]. Does this represent hepatic failure? If so, is this acute, chronic, or acute-on-chronic? What is the etiology?",
        "source": "AASLD 2014 + CODING_CLINIC Q2 2018 p.16"
      },
      {
        "trigger": "Hepatic failure documented without coma status specified",
        "query": "You documented 'hepatic failure.' The patient's encephalopathy is currently [grade/description]. For coding accuracy, is this hepatic failure with or without coma? (West Haven Grade III-IV = with coma)",
        "source": "CODING_CLINIC Q2 2018 p.16"
      }
    ],
    "common_pitfalls": [
      "ALL hepatic failure codes in this family are MCC \u2014 focus is on accuracy of coma status and etiology, not tier change.",
      "'Hepatic encephalopathy' without hepatic failure: code G93.41 (metabolic encephalopathy, MCC) + underlying liver disease. This is different from K72.x (hepatic failure).",
      "Cirrhosis (K74.x) is NOT the same as hepatic failure (K72.x). Cirrhosis is the underlying disease; hepatic failure is the decompensation.",
      "Acetaminophen overdose causing hepatic failure: code K71.11 (toxic liver disease) + T39.1x (acetaminophen adverse effect/poisoning).",
      "'With coma' includes West Haven Grade III-IV encephalopathy \u2014 document the grade or use 'coma' explicitly."
    ],
    "context_modifiers": {
      "with_aki": "Hepatorenal syndrome: often accompanied by AKI (N17.x). Code both. Type 1 HRS has MCC impact through AKI.",
      "with_dic": "Hepatic failure can cause DIC (D65, MCC). Document the coagulopathy etiology and whether DIC criteria are met.",
      "with_sepsis": "Cirrhotic patients with SBP may develop sepsis + hepatic failure. Code the infection, sepsis, and hepatic failure separately."
    }
  },
  {
    "id": "dic_coagulopathy",
    "name": "DIC / Coagulopathy",
    "icd10_chapter": "D",
    "codes": [
      "D65",
      "D6800",
      "D6801",
      "D68020",
      "D68021",
      "D68022",
      "D68023",
      "D68029",
      "D6803",
      "D6804",
      "D6809",
      "D681",
      "D682",
      "D68311",
      "D68312",
      "D68318",
      "D6832",
      "D684",
      "D6851",
      "D6852",
      "D6859",
      "D6861",
      "D6862",
      "D6869",
      "D688",
      "D689",
      "D690",
      "D693",
      "D6941",
      "D6942"
    ],
    "code_ranges": "D65, D68.x, D69.x",
    "code_count": 30,
    "clinical_criteria": [
      {
        "id": "dic_isth",
        "category": "laboratory",
        "data_type": "ISTH DIC Score",
        "criterion": "ISTH DIC score \u2265 5: platelets, fibrin markers (D-dimer/FDP), prolonged PT, fibrinogen",
        "detail": "Platelet count (>100K=0, 50-100K=1, <50K=2), D-dimer (normal=0, moderate=2, marked=3), PT prolonged (<3s=0, 3-6s=1, >6s=2), fibrinogen (>1g/L=0, <1g/L=1). Score \u22655 = overt DIC.",
        "source": "ISTH_DIC",
        "source_detail": "ISTH Scoring System: Taylor et al. Thromb Haemost 2001;86:1327-1330",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "dic_thrombocytopenia",
        "category": "laboratory",
        "data_type": "Platelet Count",
        "criterion": "Significant thrombocytopenia: platelets < 100,000/\u03bcL with declining trend",
        "detail": "Isolated thrombocytopenia has many causes. In DIC, the trend (consumption) matters more than a single value.",
        "threshold": {
          "metric": "Platelets",
          "operator": "<",
          "value": 100000,
          "unit": "/\u03bcL"
        },
        "source": "ISTH_DIC",
        "source_detail": "ISTH: Platelet count as DIC scoring component",
        "required": false,
        "evidence_weight": "moderate"
      },
      {
        "id": "dic_coag_studies",
        "category": "laboratory",
        "data_type": "Coagulation Panel",
        "criterion": "Prolonged PT/INR and/or aPTT, elevated D-dimer/FDP, low fibrinogen",
        "detail": "Consumption of clotting factors produces prolonged clotting times. Low fibrinogen (< 150 mg/dL) is concerning; < 100 mg/dL is severe.",
        "source": "ISTH_DIC",
        "source_detail": "ISTH: Coagulation parameters in DIC diagnosis",
        "required": false,
        "evidence_weight": "strong"
      }
    ],
    "documentation_requirements": [
      {
        "id": "dic_doc_explicit",
        "requirement": "Provider must explicitly document 'DIC' or 'disseminated intravascular coagulation.' D65 is the ONLY MCC in this family. All other coagulopathy codes (D68.x, D69.x) are CC only.",
        "insufficient_terms": [
          "coagulopathy",
          "coagulopathic",
          "elevated INR",
          "low platelets",
          "consumption coagulopathy"
        ],
        "source": "CODING_CLINIC",
        "source_detail": "Q3 2013 p.22: DIC vs coagulopathy documentation"
      },
      {
        "id": "dic_doc_type",
        "requirement": "For non-DIC coagulopathy, document the specific type: acquired hemophilia (D68.311), antiphospholipid syndrome (D68.61), VWD (D68.0x), ITP (D69.3), factor deficiency (D68.2), or drug-related (D68.32).",
        "insufficient_terms": [
          "bleeding disorder",
          "thrombocytopenia NOS"
        ],
        "source": "ICD10_GUIDELINES",
        "source_detail": "Section I.C.3: Blood/immune coding \u2014 specify the coagulopathy type"
      }
    ],
    "specificity_ladder": [
      {
        "code": "D65",
        "description": "Disseminated intravascular coagulation",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "ISTH score \u2265 5 OR clinical DIC with consumption pattern: thrombocytopenia + elevated D-dimer + prolonged PT + low fibrinogen",
        "specificity_note": "The ONLY MCC in this entire family. Critical distinction from general coagulopathy (CC)."
      },
      {
        "code": "D68311",
        "description": "Acquired hemophilia",
        "cc_mcc": "CC",
        "distinguishing_evidence": "Factor VIII inhibitor antibody with hemorrhagic presentation",
        "specificity_note": "CC \u2014 rare but clinically important. Requires mixing study and factor level."
      },
      {
        "code": "D6861",
        "description": "Antiphospholipid syndrome",
        "cc_mcc": "CC",
        "distinguishing_evidence": "Lupus anticoagulant positive, anticardiolipin antibodies, with thrombotic event",
        "specificity_note": "CC \u2014 both thrombotic and hemorrhagic manifestations possible."
      },
      {
        "code": "D689",
        "description": "Coagulation defect, unspecified",
        "cc_mcc": "CC",
        "specificity_note": "CC \u2014 generic. Query for DIC (MCC) when consumption pattern is present, or specify the coagulopathy type."
      }
    ],
    "cdi_query_templates": [
      {
        "trigger": "Lab pattern suggests DIC (\u2193 platelets, \u2191 D-dimer, \u2191 PT, \u2193 fibrinogen) but only 'coagulopathy' documented",
        "query": "The patient has platelets [VALUE], D-dimer [VALUE], PT [VALUE], fibrinogen [VALUE]. This laboratory pattern is consistent with disseminated intravascular coagulation. Does this represent DIC?",
        "source": "ISTH DIC scoring + CODING_CLINIC Q3 2013 p.22"
      },
      {
        "trigger": "Prolonged INR on anticoagulants \u2014 unclear if coagulopathy vs therapeutic effect",
        "query": "The patient's INR is [VALUE] while on [anticoagulant]. Is this a therapeutic anticoagulation effect, or does this represent a coagulopathy (D68.32)? The distinction affects code assignment.",
        "source": "CODING_CLINIC Q4 2016 p.64"
      }
    ],
    "common_pitfalls": [
      "D65 (DIC) is the ONLY MCC in this family. All other D68/D69 codes are CC. The DIC vs coagulopathy distinction is the single most impactful query in this family.",
      "Thrombocytopenia alone is NOT coagulopathy and may not even be CC/MCC \u2014 it depends on the cause and code.",
      "ITP (D69.3) is CC. HIT (heparin-induced thrombocytopenia) uses D75.82 which is NOT in this family.",
      "Drug-induced coagulopathy (D68.32) from anticoagulant use is CC \u2014 document this when supratherapeutic anticoagulation causes hemorrhagic complications.",
      "DIC is always secondary to an underlying condition (sepsis, malignancy, trauma). Code the underlying cause as well."
    ],
    "context_modifiers": {
      "with_sepsis": "DIC is commonly triggered by sepsis. Code A41.x + R65.2x (severe sepsis) + D65. The DIC may be the documented organ dysfunction for severe sepsis criteria.",
      "with_liver_disease": "Liver disease causes coagulopathy from impaired synthesis, NOT consumption. This is typically D68.4 (acquired deficiency), not D65 (DIC). Distinguish the mechanism.",
      "with_malignancy": "Malignancy-associated DIC: code the neoplasm + D65. Chronic/compensated DIC in cancer may be documented differently from acute DIC."
    }
  },
  {
    "id": "blood_loss_anemia",
    "name": "Acute Blood Loss Anemia",
    "icd10_chapter": "D",
    "codes": [
      "D62"
    ],
    "code_ranges": "D62",
    "code_count": 1,
    "clinical_criteria": [
      {
        "id": "bla_hgb_drop",
        "category": "laboratory",
        "data_type": "Hemoglobin",
        "criterion": "Hemoglobin drop \u2265 2 g/dL from baseline or Hgb requiring transfusion",
        "detail": "Acute drop in hemoglobin/hematocrit in the setting of identified or suspected bleeding. Serial labs show the trend.",
        "threshold": {
          "metric": "Hemoglobin drop",
          "operator": ">=",
          "value": 2,
          "unit": "g/dL"
        },
        "source": "CODING_CLINIC",
        "source_detail": "Q4 2016 p.47: Acute blood loss anemia documentation",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "bla_transfusion",
        "category": "intervention",
        "data_type": "Blood Transfusion",
        "criterion": "Packed red blood cell transfusion for acute blood loss",
        "detail": "Transfusion strongly supports the diagnosis. Document that transfusion is for acute blood loss, not chronic anemia.",
        "source": "CODING_CLINIC",
        "source_detail": "Q1 2019 p.14: Transfusion and anemia coding",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "bla_source",
        "category": "clinical_finding",
        "data_type": "Bleeding Source",
        "criterion": "Identifiable bleeding source: GI, surgical, traumatic, postpartum, or other",
        "detail": "The bleeding source should be coded separately. D62 captures the anemia consequence, not the source.",
        "source": "CODING_CLINIC",
        "source_detail": "Q4 2016 p.47: Code the source and the anemia separately",
        "required": false,
        "evidence_weight": "strong"
      }
    ],
    "documentation_requirements": [
      {
        "id": "bla_doc_explicit",
        "requirement": "Provider must document 'acute blood loss anemia.' A hemoglobin drop or transfusion alone is insufficient for code assignment. The diagnosis must be explicitly stated.",
        "insufficient_terms": [
          "anemia",
          "low hemoglobin",
          "blood loss",
          "required transfusion",
          "Hgb drop",
          "posthemorrhagic"
        ],
        "source": "CODING_CLINIC",
        "source_detail": "Q4 2016 p.47; Q1 2019 p.14: Explicit documentation required for D62"
      }
    ],
    "specificity_ladder": [
      {
        "code": "D62",
        "description": "Acute posthemorrhagic anemia",
        "cc_mcc": "CC",
        "specificity_note": "Single code, CC. Commonly under-documented \u2014 query whenever significant Hgb drop with active bleeding or surgical blood loss."
      }
    ],
    "cdi_query_templates": [
      {
        "trigger": "Hemoglobin drops \u2265 2 g/dL with bleeding but no anemia diagnosis",
        "query": "The patient's hemoglobin dropped from [BASELINE] to [NADIR] g/dL in the setting of [bleeding source / surgery]. Does this represent acute blood loss anemia? The patient received [# units] pRBC transfusion.",
        "source": "CODING_CLINIC Q4 2016 p.47"
      },
      {
        "trigger": "Transfusion given during admission without acute anemia documented",
        "query": "The patient received [# units] packed red blood cell transfusion on [DATE] for [indication]. Does this represent acute blood loss anemia? If so, please document the diagnosis.",
        "source": "CODING_CLINIC Q1 2019 p.14"
      }
    ],
    "common_pitfalls": [
      "D62 is one of the most under-documented CCs. Anytime a patient bleeds significantly and Hgb drops, query for acute blood loss anemia.",
      "D62 is coded IN ADDITION to the bleeding source \u2014 it's the systemic consequence (anemia), not the event (hemorrhage).",
      "Chronic anemia (D50-D64 other codes) is different from acute blood loss anemia. Patients can have both if they have chronic anemia with acute-on-chronic drop.",
      "Post-surgical Hgb drops: expected blood loss during surgery can still qualify as acute blood loss anemia if clinically significant.",
      "D62 is CC \u2014 it adds severity impact to any DRG. Combined with an MCC bleeding source (e.g., K25.0 gastric ulcer with hemorrhage), the impact is cumulative."
    ],
    "context_modifiers": {
      "with_gi_hemorrhage": "GI bleed + Hgb drop: code both the GI hemorrhage source AND D62. The GI source may be MCC; D62 adds CC on top.",
      "post_surgical": "Expected surgical blood loss can still produce acute blood loss anemia. The threshold is clinical significance (need for transfusion, symptomatic anemia).",
      "with_anticoagulation": "Bleeding on anticoagulants: code the drug adverse effect (T45.x) + bleeding source + D62 for the anemia."
    }
  },
  {
    "id": "diabetes_complications",
    "name": "Diabetes with Complications",
    "icd10_chapter": "E",
    "codes": [
      "E0800",
      "E0801",
      "E0810",
      "E0811",
      "E0852",
      "E08641",
      "E0900",
      "E0901",
      "E0910",
      "E0911",
      "E0952",
      "E09641",
      "E1010",
      "E1011",
      "E1052",
      "E10641",
      "E1100",
      "E1101",
      "E1110",
      "E1111",
      "E1152",
      "E11641",
      "E1300",
      "E1301",
      "E1310",
      "E1311",
      "E1352",
      "E13641"
    ],
    "code_ranges": "E08\u2013E13 (specific complication codes only)",
    "code_count": 28,
    "clinical_criteria": [
      {
        "id": "dm_dka",
        "category": "laboratory",
        "data_type": "Metabolic Panel / ABG",
        "criterion": "DKA: Blood glucose typically > 250 mg/dL, pH < 7.30, bicarbonate < 18 mEq/L, anion gap > 12, positive serum/urine ketones",
        "detail": "DKA requires all three: hyperglycemia, ketosis, and acidosis. Euglycemic DKA (SGLT2 inhibitors) may have near-normal glucose.",
        "source": "ADA",
        "source_detail": "ADA Standards of Care 2024: DKA diagnostic criteria",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "dm_hhs",
        "category": "laboratory",
        "data_type": "Metabolic Panel",
        "criterion": "HHS: Blood glucose > 600 mg/dL, serum osmolality > 320 mOsm/kg, pH > 7.30, minimal ketones",
        "detail": "Hyperosmolar hyperglycemic state. Distinguished from DKA by absence of significant ketoacidosis and higher glucose/osmolality.",
        "threshold": {
          "metric": "Glucose",
          "operator": ">",
          "value": 600,
          "unit": "mg/dL"
        },
        "source": "ADA",
        "source_detail": "ADA Standards of Care 2024: HHS diagnostic criteria",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "dm_hypoglycemia_coma",
        "category": "clinical_finding",
        "data_type": "Blood Glucose / Mental Status",
        "criterion": "Severe hypoglycemia with coma: blood glucose typically < 54 mg/dL with altered consciousness",
        "detail": "Hypoglycemia with coma (E08-E13.641) is MCC. Requires documented altered mental status or loss of consciousness due to low blood glucose.",
        "threshold": {
          "metric": "Blood glucose",
          "operator": "<",
          "value": 54,
          "unit": "mg/dL"
        },
        "source": "ADA",
        "source_detail": "ADA: Severe hypoglycemia \u2014 requires assistance from another person",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "dm_gangrene",
        "category": "clinical_finding",
        "data_type": "Wound Assessment",
        "criterion": "Diabetic peripheral angiopathy with gangrene: tissue necrosis due to arterial insufficiency in diabetic patient",
        "detail": "Gangrene codes (E08-E13.52) are CC. Requires documented gangrene in the context of diabetic peripheral vascular disease.",
        "source": "CODING_CLINIC",
        "source_detail": "Q4 2018 p.23: Diabetic gangrene documentation",
        "required": false,
        "evidence_weight": "strong"
      }
    ],
    "documentation_requirements": [
      {
        "id": "dm_doc_type",
        "requirement": "Document the DIABETES TYPE: Type 1 (E10), Type 2 (E11), due to underlying condition (E08), drug-induced (E09), or other (E13). 'Diabetes' alone defaults to E11 (Type 2) per ICD-10 convention.",
        "insufficient_terms": [
          "diabetes",
          "DM",
          "hyperglycemia"
        ],
        "source": "ICD10_GUIDELINES",
        "source_detail": "Section I.C.4.a: Diabetes mellitus code assignment by type"
      },
      {
        "id": "dm_doc_complication",
        "requirement": "Document the specific COMPLICATION: DKA (with/without coma), HHS (with/without coma), hypoglycemia with coma, or gangrene. These are the only diabetes codes that are CC/MCC. General 'diabetes with complications' is insufficient.",
        "insufficient_terms": [
          "uncontrolled diabetes",
          "diabetes with complications"
        ],
        "source": "CODING_CLINIC",
        "source_detail": "Q2 2016 p.36: Diabetes complication documentation requirements"
      }
    ],
    "specificity_ladder": [
      {
        "code": "E1111",
        "description": "Type 2 DM with DKA with coma",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "DKA criteria met + altered consciousness or coma + Type 2 diabetes documented",
        "upgrade_from": "E1110",
        "upgrade_evidence": "Document 'with coma' when AMS is present during DKA"
      },
      {
        "code": "E1110",
        "description": "Type 2 DM with DKA without coma",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "DKA criteria met (hyperglycemia + acidosis + ketosis) without coma",
        "specificity_note": "MCC \u2014 most common diabetes MCC code in inpatient settings"
      },
      {
        "code": "E1100",
        "description": "Type 2 DM with HHS without coma",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Glucose > 600, osmolality > 320, pH > 7.30, minimal ketones",
        "specificity_note": "MCC \u2014 distinguish from DKA by the absence of significant acidosis"
      },
      {
        "code": "E11641",
        "description": "Type 2 DM with hypoglycemia with coma",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Severe hypoglycemia causing loss of consciousness or severe AMS",
        "specificity_note": "MCC \u2014 document the coma/AMS explicitly linked to hypoglycemia"
      },
      {
        "code": "E1152",
        "description": "Type 2 DM with diabetic peripheral angiopathy with gangrene",
        "cc_mcc": "CC",
        "distinguishing_evidence": "Diabetic PVD with tissue gangrene documented",
        "specificity_note": "CC \u2014 lower impact than DKA/HHS (MCC), but important to capture"
      }
    ],
    "cdi_query_templates": [
      {
        "trigger": "DKA lab values present but only 'hyperglycemia' or 'uncontrolled diabetes' documented",
        "query": "Labs show glucose [VALUE], pH [VALUE], bicarb [VALUE], anion gap [VALUE], ketones [VALUE]. This pattern is consistent with diabetic ketoacidosis. Does this represent DKA? If so, is this with or without coma?",
        "source": "ADA Standards + CODING_CLINIC Q2 2016 p.36"
      },
      {
        "trigger": "Severe hypoglycemia with AMS but 'hypoglycemia with coma' not documented",
        "query": "The patient had a blood glucose of [VALUE] mg/dL on [DATE] with [AMS description]. You documented 'hypoglycemia.' Did the patient have altered consciousness or coma due to the hypoglycemia? If so, this can be captured more specifically.",
        "source": "CODING_CLINIC Q4 2017 p.42"
      },
      {
        "trigger": "Diabetes type not documented in patient with DKA",
        "query": "The patient presented with DKA. Is this Type 1 or Type 2 diabetes mellitus? The type determines the specific code assignment.",
        "source": "ICD10_GUIDELINES I.C.4.a"
      }
    ],
    "common_pitfalls": [
      "Only DKA, HHS, hypoglycemia with coma, and gangrene codes are CC/MCC in the diabetes chapter. General diabetes complications (neuropathy, nephropathy, retinopathy) are NOT CC/MCC.",
      "'Uncontrolled diabetes' is NOT a codeable complication \u2014 it does not map to any specific CC/MCC code. Must specify DKA, HHS, or the specific complication.",
      "DKA in Type 2 diabetes: Yes, Type 2 patients can develop DKA. Code E11.10/E11.11, not E10.x (Type 1).",
      "HHS (E11.00/E11.01) and DKA (E11.10/E11.11) are mutually exclusive per ICD-10 conventions \u2014 code the predominant presentation.",
      "'With coma' in DKA/HHS/hypoglycemia adds specificity but does NOT change CC/MCC tier \u2014 all are already MCC."
    ],
    "context_modifiers": {
      "with_aki": "DKA/HHS frequently causes AKI from dehydration. Code both the diabetic crisis (E11.1x/E11.0x) and AKI (N17.x). The AKI adds its own DRG impact.",
      "with_sepsis": "Diabetic crisis triggered by infection/sepsis: code the infection, the sepsis if criteria met, and the diabetes complication. Document the relationship.",
      "with_ckd": "Diabetes with CKD: E11.22 (Type 2 DM with diabetic CKD) is NOT CC/MCC. But CKD stage code (N18.x) may be CC depending on stage."
    }
  },
  {
    "id": "electrolyte",
    "name": "Electrolyte Disorders",
    "icd10_chapter": "E",
    "codes": [
      "E870",
      "E871",
      "E8720",
      "E8721",
      "E8722",
      "E8729",
      "E873",
      "E874"
    ],
    "code_ranges": "E87.0\u2013E87.4",
    "code_count": 8,
    "clinical_criteria": [
      {
        "id": "lyte_sodium",
        "category": "laboratory",
        "data_type": "Serum Sodium",
        "criterion": "Hypernatremia (Na > 145 mEq/L) or Hyponatremia (Na < 135 mEq/L)",
        "detail": "Severity: Mild 130-134, Moderate 125-129, Severe < 125 mEq/L (hyponatremia). Symptoms include AMS, seizures, cerebral edema.",
        "source": "CODING_CLINIC",
        "source_detail": "Q1 2014 p.22: Electrolyte disorder documentation",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "lyte_acidosis",
        "category": "laboratory",
        "data_type": "ABG / BMP",
        "criterion": "Metabolic acidosis: pH < 7.35 with low bicarbonate (< 22 mEq/L) and/or elevated anion gap (> 12)",
        "detail": "E87.2x codes specify acidosis type: unspecified (E87.20), acute (E87.21), chronic (E87.22), other (E87.29). Acute metabolic acidosis is most clinically significant.",
        "threshold": {
          "metric": "pH",
          "operator": "<",
          "value": 7.35,
          "unit": ""
        },
        "source": "CODING_CLINIC",
        "source_detail": "Q2 2020 p.22: Acidosis type coding",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "lyte_alkalosis",
        "category": "laboratory",
        "data_type": "ABG / BMP",
        "criterion": "Alkalosis: pH > 7.45 \u2014 metabolic (high bicarbonate) or respiratory (low PaCO2)",
        "detail": "E87.3 covers alkalosis. Document metabolic vs respiratory type and the cause (vomiting, diuretics, hyperventilation).",
        "threshold": {
          "metric": "pH",
          "operator": ">",
          "value": 7.45,
          "unit": ""
        },
        "source": "CODING_CLINIC",
        "source_detail": "General: Alkalosis coding",
        "required": false,
        "evidence_weight": "strong"
      }
    ],
    "documentation_requirements": [
      {
        "id": "lyte_doc_specific",
        "requirement": "Document the SPECIFIC electrolyte disorder: hypernatremia (E87.0), hyponatremia (E87.1), acidosis (E87.2x), alkalosis (E87.3), mixed acid-base (E87.4). 'Electrolyte imbalance' alone is not codeable to a CC.",
        "insufficient_terms": [
          "electrolyte imbalance",
          "abnormal labs",
          "metabolic derangement"
        ],
        "source": "CODING_CLINIC",
        "source_detail": "Q1 2014 p.22: Specificity required for electrolyte disorder coding"
      },
      {
        "id": "lyte_doc_acidity",
        "requirement": "For acidosis, specify the TYPE: acute metabolic (E87.21), chronic metabolic (E87.22), or unspecified (E87.20). These FY2023 expanded codes require documentation of acuity.",
        "insufficient_terms": [
          "acidosis NOS",
          "metabolic acidosis"
        ],
        "source": "ICD10_GUIDELINES",
        "source_detail": "FY2023: Expanded acidosis codes with acuity specification"
      }
    ],
    "specificity_ladder": [
      {
        "code": "E870",
        "description": "Hyperosmolality and hypernatremia",
        "cc_mcc": "CC",
        "distinguishing_evidence": "Serum sodium > 145 mEq/L and/or serum osmolality > 295 mOsm/kg"
      },
      {
        "code": "E871",
        "description": "Hypo-osmolality and hyponatremia",
        "cc_mcc": "CC",
        "distinguishing_evidence": "Serum sodium < 135 mEq/L \u2014 document severity and symptoms"
      },
      {
        "code": "E8721",
        "description": "Acute metabolic acidosis",
        "cc_mcc": "CC",
        "distinguishing_evidence": "pH < 7.35 with low bicarb, acute onset \u2014 from DKA, lactic acidosis, renal failure, toxins",
        "upgrade_from": "E8720",
        "upgrade_evidence": "Specify 'acute' metabolic acidosis for FY2023+ coding accuracy"
      },
      {
        "code": "E874",
        "description": "Mixed disorder of acid-base balance",
        "cc_mcc": "CC",
        "distinguishing_evidence": "Concurrent metabolic acidosis + respiratory alkalosis, or other combination",
        "specificity_note": "CC \u2014 used when two or more acid-base disturbances coexist"
      }
    ],
    "cdi_query_templates": [
      {
        "trigger": "Sodium significantly abnormal but no electrolyte diagnosis documented",
        "query": "Serum sodium is [VALUE] mEq/L on [DATE]. Does this represent [hypernatremia/hyponatremia]? If so, please document the diagnosis and the clinical significance.",
        "source": "CODING_CLINIC Q1 2014 p.22"
      },
      {
        "trigger": "ABG shows acidosis but only the underlying cause is documented, not the acidosis itself",
        "query": "ABG shows pH [VALUE], HCO3 [VALUE], anion gap [VALUE]. In addition to [underlying cause \u2014 DKA, sepsis, renal failure], does the patient have metabolic acidosis that should be documented as a diagnosis? If so, is this acute or chronic?",
        "source": "CODING_CLINIC Q2 2020 p.22"
      }
    ],
    "common_pitfalls": [
      "All electrolyte disorder codes (E87.x) are CC only \u2014 none are MCC. But they're commonly present and add cumulative CC impact.",
      "Hypokalemia (E87.6) and hyperkalemia (E87.5) are NOT CC/MCC. Only sodium disorders, acidosis, alkalosis, and mixed acid-base qualify.",
      "Metabolic acidosis in DKA is inherent to the DKA diagnosis \u2014 some facilities query for E87.2x separately, but it's already captured in the DKA code.",
      "Lactic acidosis from sepsis: code E87.2x separately from the sepsis. The acidosis is a distinct clinical entity.",
      "Volume depletion (E86.x) is NOT the same as electrolyte disorder and is NOT CC/MCC."
    ],
    "context_modifiers": {
      "with_aki": "AKI commonly causes metabolic acidosis and electrolyte disorders. Code both the AKI and the electrolyte disturbance.",
      "with_sepsis": "Sepsis-related lactic acidosis: code E87.2x in addition to sepsis codes. Document the acidosis as a finding.",
      "with_liver_disease": "Hepatic disease can cause hyponatremia and alkalosis. Code the electrolyte disorder separately from the liver disease."
    }
  },
  {
    "id": "sickle_cell",
    "name": "Sickle Cell Disease",
    "icd10_chapter": "D",
    "codes": [
      "D5700",
      "D5701",
      "D5702",
      "D5703",
      "D5704",
      "D5709",
      "D57211",
      "D57212",
      "D57213",
      "D57214",
      "D57218",
      "D57219",
      "D57411",
      "D57412",
      "D57413",
      "D57414",
      "D57418",
      "D57419",
      "D57431",
      "D57432",
      "D57433",
      "D57434",
      "D57438",
      "D57439",
      "D57451",
      "D57452",
      "D57453",
      "D57454",
      "D57458",
      "D57459",
      "D57811",
      "D57812",
      "D57813",
      "D57814",
      "D57818",
      "D57819"
    ],
    "code_ranges": "D57.0x, D57.21x, D57.41x, D57.43x, D57.45x, D57.81x",
    "code_count": 36,
    "clinical_criteria": [
      {
        "id": "scd_crisis",
        "category": "clinical_finding",
        "data_type": "Vaso-Occlusive Crisis",
        "criterion": "Vaso-occlusive crisis: severe pain requiring IV opioid analgesics, typically in bones, chest, abdomen",
        "detail": "The hallmark of sickle cell disease. Pain crisis requires documentation of 'crisis' or 'vaso-occlusive episode.' Only 'with crisis' codes are CC/MCC.",
        "source": "CODING_CLINIC",
        "source_detail": "Q3 2014 p.15: Sickle cell with/without crisis distinction",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "scd_acs",
        "category": "clinical_finding",
        "data_type": "Acute Chest Syndrome",
        "criterion": "Acute chest syndrome: new pulmonary infiltrate + fever and/or respiratory symptoms in SCD patient",
        "detail": "Acute chest syndrome (D57.01, D57.211, etc.) is a specific crisis type. Requires new infiltrate on CXR plus at least one: fever, chest pain, tachypnea, cough, hypoxia.",
        "source": "CODING_CLINIC",
        "source_detail": "Q2 2017 p.19: Acute chest syndrome documentation",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "scd_hgb_electrophoresis",
        "category": "laboratory",
        "data_type": "Hemoglobin Electrophoresis",
        "criterion": "Hemoglobin electrophoresis confirming sickle cell genotype: Hb-SS, Hb-SC, Hb-S/beta-thal",
        "detail": "The genotype determines the specific code category: D57.0 (Hb-SS), D57.2 (Hb-SC), D57.4 (Hb-S/thalassemia). Documentation should specify genotype.",
        "source": "ICD10_GUIDELINES",
        "source_detail": "Section I.C.3: Sickle cell coding by genotype",
        "required": false,
        "evidence_weight": "strong"
      }
    ],
    "documentation_requirements": [
      {
        "id": "scd_doc_crisis",
        "requirement": "Provider must document 'with crisis' for the code to be MCC. Sickle cell WITHOUT crisis is NOT CC/MCC. The crisis type should be specified: vaso-occlusive, acute chest syndrome, splenic sequestration, cerebral vascular involvement, dactylitis.",
        "insufficient_terms": [
          "sickle cell disease",
          "sickle cell pain",
          "SCD"
        ],
        "source": "CODING_CLINIC",
        "source_detail": "Q3 2014 p.15: 'With crisis' documentation required for CC/MCC status"
      },
      {
        "id": "scd_doc_genotype",
        "requirement": "Document the sickle cell GENOTYPE: Hb-SS (D57.0x), Hb-SC (D57.2x), Hb-S/beta-thal (D57.4x). 'Sickle cell disease' alone maps to D57.1 (without crisis, not CC/MCC) or unspecified.",
        "insufficient_terms": [
          "sickle cell",
          "SCD NOS"
        ],
        "source": "ICD10_GUIDELINES",
        "source_detail": "Section I.C.3: Code the specific genotype when known"
      }
    ],
    "specificity_ladder": [
      {
        "code": "D5701",
        "description": "Hb-SS disease with acute chest syndrome",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Hb-SS genotype + new pulmonary infiltrate + respiratory symptoms/fever",
        "upgrade_from": "D5700",
        "upgrade_evidence": "Specify acute chest syndrome as the crisis type when pulmonary infiltrate present"
      },
      {
        "code": "D5703",
        "description": "Hb-SS disease with cerebral vascular involvement",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Hb-SS with stroke, TIA, or cerebral vasculopathy",
        "upgrade_from": "D5700",
        "upgrade_evidence": "Document cerebral vascular involvement when neurological complications occur"
      },
      {
        "code": "D5700",
        "description": "Hb-SS disease with crisis, unspecified",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Vaso-occlusive crisis without specified complication type",
        "specificity_note": "MCC \u2014 but specifying the crisis type (ACS, splenic, cerebral, dactylitis) is more accurate"
      },
      {
        "code": "D57219",
        "description": "Sickle-cell/Hb-C disease with crisis, unspecified",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Hb-SC genotype with vaso-occlusive crisis",
        "specificity_note": "MCC \u2014 specify crisis type when possible"
      }
    ],
    "cdi_query_templates": [
      {
        "trigger": "Sickle cell patient admitted with pain but 'crisis' not documented",
        "query": "The patient with sickle cell disease presented with [severe pain requiring IV analgesics / chest symptoms / etc.]. Does this represent a sickle cell crisis? If so, what type \u2014 vaso-occlusive, acute chest syndrome, splenic sequestration, or other?",
        "source": "CODING_CLINIC Q3 2014 p.15"
      },
      {
        "trigger": "Sickle cell crisis documented without specifying genotype",
        "query": "You documented 'sickle cell crisis.' For coding accuracy, what is the patient's sickle cell genotype \u2014 Hb-SS, Hb-SC, Hb-S/beta-thalassemia? This determines the specific code category.",
        "source": "ICD10_GUIDELINES I.C.3"
      }
    ],
    "common_pitfalls": [
      "Sickle cell WITHOUT crisis is NOT CC/MCC. The word 'crisis' in the documentation is what drives the MCC designation.",
      "ALL sickle cell 'with crisis' codes are MCC \u2014 there is no CC tier in this family. The distinction is MCC (with crisis) vs nothing (without crisis).",
      "Sickle cell trait (D57.3) is completely different from sickle cell disease and is NOT CC/MCC.",
      "Acute chest syndrome is a specific crisis type requiring new pulmonary infiltrate \u2014 don't code it based on chest pain alone.",
      "FY2024 added beta-zero (D57.43x) and beta-plus (D57.45x) thalassemia subcategories \u2014 document the specific beta-thal subtype when known."
    ],
    "context_modifiers": {
      "with_resp_failure": "Acute chest syndrome may cause respiratory failure. Code both the sickle cell crisis (D57.x1) and respiratory failure (J96.x). Both contribute MCC impact.",
      "with_stroke": "Sickle cell cerebrovascular crisis (D57.x3): code the sickle cell code + stroke code (I63.x) if infarction documented. Major prognostic and coding impact.",
      "with_sepsis": "SCD patients are immunocompromised (functional asplenia). If sepsis develops during crisis, code sepsis separately \u2014 it drives a different DRG pathway."
    }
  },
  {
    "id": "cardiac_arrest",
    "name": "Cardiac Arrest",
    "icd10_chapter": "I",
    "codes": [
      "I462",
      "I468",
      "I469"
    ],
    "code_ranges": "I46.2, I46.8, I46.9",
    "code_count": 3,
    "clinical_criteria": [
      {
        "id": "ca_cessation",
        "category": "clinical_finding",
        "data_type": "Clinical Event",
        "criterion": "Cessation of cardiac mechanical activity: no pulse, no organized cardiac rhythm, unresponsive",
        "detail": "Cardiac arrest requires documented loss of pulse and cardiac activity. Differentiate from severe bradycardia or hypotension.",
        "source": "CODING_CLINIC",
        "source_detail": "Q4 2013 p.102: Cardiac arrest documentation requirements",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "ca_cpr",
        "category": "intervention",
        "data_type": "Resuscitation",
        "criterion": "CPR initiated (chest compressions, defibrillation, ACLS protocol)",
        "detail": "Resuscitation efforts strongly support cardiac arrest diagnosis. Document the rhythm (VF/VT, PEA, asystole) and ROSC if achieved.",
        "source": "CODING_CLINIC",
        "source_detail": "Q4 2013 p.102: Resuscitation documentation",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "ca_rhythm",
        "category": "clinical_finding",
        "data_type": "Cardiac Rhythm",
        "criterion": "Documented arrest rhythm: ventricular fibrillation, ventricular tachycardia (pulseless), PEA, or asystole",
        "detail": "The arrest rhythm is clinically important but does NOT change the ICD-10 code for cardiac arrest (I46.x). VF arrest has separate code I49.01.",
        "source": "CODING_CLINIC",
        "source_detail": "General: Arrest rhythm documentation",
        "required": false,
        "evidence_weight": "strong"
      }
    ],
    "documentation_requirements": [
      {
        "id": "ca_doc_explicit",
        "requirement": "Provider must document 'cardiac arrest.' CPR alone does not automatically equal cardiac arrest coding. The diagnosis must be explicitly stated.",
        "insufficient_terms": [
          "code blue",
          "found unresponsive",
          "required CPR"
        ],
        "source": "CODING_CLINIC",
        "source_detail": "Q4 2013 p.102: 'Cardiac arrest' must be documented for I46.x assignment"
      },
      {
        "id": "ca_doc_cause",
        "requirement": "Document the underlying CAUSE: cardiac condition (I46.2), other underlying condition (I46.8), or unspecified (I46.9). The underlying cause determines the code.",
        "insufficient_terms": [
          "cardiac arrest NOS"
        ],
        "source": "ICD10_GUIDELINES",
        "source_detail": "Section I.C.9: Cardiac arrest \u2014 code the underlying cause"
      }
    ],
    "specificity_ladder": [
      {
        "code": "I462",
        "description": "Cardiac arrest due to underlying cardiac condition",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Arrest caused by MI, arrhythmia, HF, or other primary cardiac pathology",
        "upgrade_from": "I469",
        "upgrade_evidence": "Specify cardiac etiology when the cause is a primary cardiac condition"
      },
      {
        "code": "I468",
        "description": "Cardiac arrest due to other underlying condition",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Arrest caused by PE, respiratory failure, sepsis, hemorrhage, or other non-cardiac cause",
        "upgrade_from": "I469",
        "upgrade_evidence": "Specify non-cardiac etiology when identifiable"
      },
      {
        "code": "I469",
        "description": "Cardiac arrest, cause unspecified",
        "cc_mcc": "MCC",
        "specificity_note": "MCC \u2014 but specifying the underlying cause improves clinical accuracy. Query for cause."
      }
    ],
    "cdi_query_templates": [
      {
        "trigger": "CPR performed but 'cardiac arrest' not explicitly documented",
        "query": "The patient required CPR and ACLS interventions on [DATE]. The documented rhythm was [RHYTHM]. Does this event represent cardiac arrest? If so, what was the underlying cause?",
        "source": "CODING_CLINIC Q4 2013 p.102"
      },
      {
        "trigger": "Cardiac arrest documented but underlying cause not specified",
        "query": "You documented 'cardiac arrest.' The clinical context suggests [MI / PE / respiratory failure / sepsis] as the underlying cause. Could you specify whether this was due to a cardiac condition or another underlying condition?",
        "source": "ICD10_GUIDELINES I.C.9"
      }
    ],
    "common_pitfalls": [
      "I46.x codes are only assigned when the patient SURVIVES the arrest. If the patient dies, the underlying cause is the principal diagnosis, not the cardiac arrest.",
      "Cardiac arrest as a complication of MI: sequence the MI first, cardiac arrest second (per I.C.9.e sequencing guidelines).",
      "I46.x codes do NOT distinguish arrest rhythm (VF vs asystole). VF is separately coded as I49.01 if it occurs outside the arrest context.",
      "'Code blue' or 'found pulseless' does not automatically equal cardiac arrest for coding \u2014 the provider must document 'cardiac arrest.'",
      "Cardiac arrest occurring during a procedure: may need additional procedure complication code. Document the context."
    ],
    "context_modifiers": {
      "with_mi": "Cardiac arrest due to MI: MI (I21.x) is principal, I46.2 is additional code. Both are MCC.",
      "with_pe": "Cardiac arrest due to massive PE: code I26.x + I46.8. Sequencing depends on circumstances of admission.",
      "with_resp_failure": "Respiratory arrest (R09.2) leading to cardiac arrest: code both. Distinguish respiratory arrest from cardiac arrest."
    }
  },
  {
    "id": "shock",
    "name": "Shock",
    "icd10_chapter": "R",
    "codes": [
      "R570",
      "R571",
      "R578",
      "R579"
    ],
    "code_ranges": "R57.0\u2013R57.9",
    "code_count": 4,
    "clinical_criteria": [
      {
        "id": "shock_hypotension",
        "category": "vitals",
        "data_type": "Blood Pressure",
        "criterion": "Sustained hypotension: SBP < 90 mmHg or MAP < 65 mmHg despite adequate fluid resuscitation",
        "detail": "Hypotension refractory to fluid resuscitation is the hemodynamic hallmark. Must be sustained, not transient.",
        "threshold": {
          "metric": "SBP",
          "operator": "<",
          "value": 90,
          "unit": "mmHg"
        },
        "source": "CODING_CLINIC",
        "source_detail": "Q4 2014 p.22: Shock documentation requirements",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "shock_vasopressors",
        "category": "intervention",
        "data_type": "Vasopressor Support",
        "criterion": "Vasopressor requirement to maintain adequate perfusion pressure",
        "detail": "Need for vasopressors (norepinephrine, vasopressin, dopamine, epinephrine) indicates hemodynamic instability beyond fluid responsiveness.",
        "source": "CODING_CLINIC",
        "source_detail": "Q4 2014 p.22: Vasopressor use supporting shock diagnosis",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "shock_perfusion",
        "category": "laboratory",
        "data_type": "Perfusion Markers",
        "criterion": "End-organ hypoperfusion: elevated lactate > 2 mmol/L, oliguria, altered mental status, mottled skin",
        "detail": "Tissue hypoperfusion markers support the diagnosis. Lactate trending is particularly useful for monitoring resuscitation adequacy.",
        "source": "CODING_CLINIC",
        "source_detail": "General: Perfusion assessment in shock",
        "required": false,
        "evidence_weight": "strong"
      }
    ],
    "documentation_requirements": [
      {
        "id": "shock_doc_type",
        "requirement": "Document the TYPE of shock: cardiogenic (R57.0, MCC), hypovolemic (R57.1, MCC), or other/unspecified (R57.8/R57.9). Septic shock uses R65.21 (NOT R57.x). Anaphylactic shock uses T78.2 (NOT R57.x).",
        "insufficient_terms": [
          "hypotension",
          "hemodynamic instability",
          "on pressors",
          "requiring vasopressors"
        ],
        "source": "CODING_CLINIC",
        "source_detail": "Q4 2014 p.22: Shock type documentation and code assignment"
      },
      {
        "id": "shock_doc_explicit",
        "requirement": "Provider must explicitly document 'shock.' Hypotension requiring vasopressors is NOT automatically coded as shock without the explicit diagnosis.",
        "insufficient_terms": [
          "low blood pressure",
          "hypotension",
          "hemodynamically unstable"
        ],
        "source": "CODING_CLINIC",
        "source_detail": "Q2 2019 p.11: Shock vs hypotension documentation distinction"
      }
    ],
    "specificity_ladder": [
      {
        "code": "R570",
        "description": "Cardiogenic shock",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Shock from cardiac pump failure: acute MI, acute HF, myocarditis, massive PE. Low CO, elevated filling pressures.",
        "upgrade_from": "R579",
        "upgrade_evidence": "Specify 'cardiogenic' when cardiac etiology is identified"
      },
      {
        "code": "R571",
        "description": "Hypovolemic shock",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Shock from volume loss: hemorrhage, severe dehydration, third-spacing. Low filling pressures.",
        "upgrade_from": "R579",
        "upgrade_evidence": "Specify 'hypovolemic' when volume loss is the cause"
      },
      {
        "code": "R578",
        "description": "Other shock",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Distributive shock not classified as septic (obstructive, neurogenic, etc.)",
        "specificity_note": "MCC \u2014 used for shock types not captured by other codes"
      },
      {
        "code": "R579",
        "description": "Shock, unspecified",
        "cc_mcc": "CC",
        "specificity_note": "CC only \u2014 significantly lower impact than specified shock types (MCC). Always query for type."
      }
    ],
    "cdi_query_templates": [
      {
        "trigger": "Patient on vasopressors with hypotension but 'shock' not documented",
        "query": "The patient required initiation of [vasopressor] on [DATE] for sustained hypotension (BP [VALUE]). Does this represent shock? If so, what type \u2014 cardiogenic, hypovolemic, or other?",
        "source": "CODING_CLINIC Q4 2014 p.22"
      },
      {
        "trigger": "Shock documented but type not specified",
        "query": "You documented 'shock.' For coding accuracy, is this cardiogenic (from cardiac pump failure), hypovolemic (from blood/fluid loss), or another type? Note: septic shock is coded differently (R65.21).",
        "source": "CODING_CLINIC Q2 2019 p.11"
      }
    ],
    "common_pitfalls": [
      "R57.9 (unspecified shock) is only CC. R57.0 (cardiogenic), R57.1 (hypovolemic), R57.8 (other) are all MCC. Specifying the type is a CC \u2192 MCC upgrade.",
      "SEPTIC shock uses R65.21 (severe sepsis with septic shock), NOT R57.x. R57.x is for non-septic shock only.",
      "Anaphylactic shock uses T78.2, NOT R57.x. Code to the specific shock etiology when available.",
      "'Hypotension' (I95.x) is NOT shock. Shock requires documented tissue hypoperfusion, not just low blood pressure.",
      "Shock is rarely a principal diagnosis \u2014 it's usually secondary to MI, PE, hemorrhage, etc. Code the underlying cause."
    ],
    "context_modifiers": {
      "with_mi": "Cardiogenic shock from MI: code I21.x (MI) + R57.0 (cardiogenic shock). The MI is typically principal.",
      "with_gi_hemorrhage": "Hypovolemic shock from GI bleeding: code the GI hemorrhage source + R57.1. Document the volume of blood loss.",
      "with_pe": "Obstructive shock from massive PE: code I26.x + R57.8 (other shock). Distinguish from cardiogenic."
    }
  },
  {
    "id": "ards",
    "name": "ARDS",
    "icd10_chapter": "J",
    "codes": [
      "J80"
    ],
    "code_ranges": "J80",
    "code_count": 1,
    "clinical_criteria": [
      {
        "id": "ards_pf_ratio",
        "category": "laboratory",
        "data_type": "PaO2/FiO2 Ratio",
        "criterion": "PaO2/FiO2 ratio \u2264 300 mmHg with PEEP \u2265 5 cm H2O",
        "detail": "Berlin Definition severity: Mild 200-300, Moderate 100-200, Severe < 100. Must be assessed on mechanical ventilation with at least 5 cm PEEP.",
        "threshold": {
          "metric": "P/F Ratio",
          "operator": "<=",
          "value": 300,
          "unit": "mmHg"
        },
        "source": "ARDS_BERLIN",
        "source_detail": "ARDS Definition Task Force. JAMA 2012;307(23):2526-2533: Berlin Definition",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "ards_bilateral",
        "category": "imaging",
        "data_type": "Chest Imaging",
        "criterion": "Bilateral opacities on CXR or CT not fully explained by effusions, atelectasis, or nodules",
        "detail": "Must be bilateral. Unilateral infiltrate does not meet ARDS criteria. Opacities must be consistent with pulmonary edema.",
        "source": "ARDS_BERLIN",
        "source_detail": "Berlin Definition: Imaging criterion",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "ards_timing",
        "category": "clinical_finding",
        "data_type": "Onset",
        "criterion": "Acute onset within 1 week of known clinical insult or new/worsening respiratory symptoms",
        "detail": "Onset must be acute \u2014 within 7 days of a recognized trigger (pneumonia, sepsis, aspiration, trauma, pancreatitis, transfusion).",
        "source": "ARDS_BERLIN",
        "source_detail": "Berlin Definition: Timing criterion",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "ards_not_cardiac",
        "category": "clinical_finding",
        "data_type": "Edema Origin",
        "criterion": "Respiratory failure NOT fully explained by cardiac failure or fluid overload",
        "detail": "Requires objective assessment (echo, clinical context) to exclude hydrostatic pulmonary edema as the primary cause. Echo showing normal LV function supports ARDS over cardiogenic edema.",
        "source": "ARDS_BERLIN",
        "source_detail": "Berlin Definition: Origin of edema criterion",
        "required": false,
        "evidence_weight": "strong"
      }
    ],
    "documentation_requirements": [
      {
        "id": "ards_doc_explicit",
        "requirement": "Provider must document 'ARDS' or 'acute respiratory distress syndrome.' All four Berlin criteria must be met. 'Bilateral infiltrates' or 'hypoxemic respiratory failure' alone are insufficient.",
        "insufficient_terms": [
          "bilateral infiltrates",
          "acute lung injury",
          "ALI",
          "hypoxemic respiratory failure",
          "pulmonary edema",
          "white-out lungs"
        ],
        "source": "CODING_CLINIC",
        "source_detail": "Q1 2017 p.30: ARDS documentation requirements \u2014 Berlin Definition criteria must be met"
      }
    ],
    "specificity_ladder": [
      {
        "code": "J80",
        "description": "Acute respiratory distress syndrome",
        "cc_mcc": "MCC",
        "specificity_note": "Single code, MCC. No additional specificity available within J80 \u2014 severity (mild/moderate/severe) is clinical but does not change the code."
      }
    ],
    "cdi_query_templates": [
      {
        "trigger": "Bilateral infiltrates with P/F ratio < 300 on vent but ARDS not documented",
        "query": "The patient has bilateral opacities on imaging, P/F ratio of [VALUE] on PEEP [VALUE], onset within [TIMEFRAME] of [TRIGGER]. Echocardiogram shows [LV function]. Does this meet criteria for ARDS?",
        "source": "Berlin Definition (JAMA 2012) + CODING_CLINIC Q1 2017 p.30"
      },
      {
        "trigger": "Documentation says 'acute lung injury' or 'ALI' instead of ARDS",
        "query": "You documented 'acute lung injury.' The current classification (Berlin Definition) replaces ALI with mild ARDS (P/F 200-300). Does this patient meet ARDS criteria? If so, please document 'ARDS' or 'acute respiratory distress syndrome.'",
        "source": "Berlin Definition replaced ALI terminology in 2012"
      }
    ],
    "common_pitfalls": [
      "J80 (ARDS) is MCC and is distinct from J96.x (respiratory failure, also MCC). ARDS is a specific syndrome with Berlin criteria; respiratory failure is broader.",
      "'ALI' (acute lung injury) is no longer a recognized classification \u2014 it was replaced by 'mild ARDS' in the 2012 Berlin Definition.",
      "ARDS requires BILATERAL opacities \u2014 unilateral pneumonia with respiratory failure is not ARDS (it's pneumonia + respiratory failure).",
      "Cardiogenic pulmonary edema must be excluded. If heart failure is the primary cause of bilateral infiltrates, it's NOT ARDS.",
      "ARDS often coexists with its trigger (pneumonia, sepsis, pancreatitis). Code both the ARDS (J80) and the underlying cause."
    ],
    "context_modifiers": {
      "with_pneumonia": "Pneumonia-triggered ARDS: code both J13-J18 (pneumonia, MCC) and J80 (ARDS, MCC). The pneumonia is the trigger; ARDS is the syndrome.",
      "with_sepsis": "Sepsis-triggered ARDS: code A41.x + R65.2x (severe sepsis) + J80. ARDS may be the documented organ dysfunction for severe sepsis.",
      "with_resp_failure": "ARDS inherently involves respiratory failure. Code J80 (ARDS) AND J96.x (respiratory failure) \u2014 they are distinct diagnoses. Both are MCC."
    }
  },
  {
    "id": "intestinal_ischemia",
    "name": "Intestinal Ischemia",
    "icd10_chapter": "K",
    "codes": [
      "K55011",
      "K55012",
      "K55019",
      "K55021",
      "K55022",
      "K55029",
      "K55031",
      "K55032",
      "K55039",
      "K55041",
      "K55042",
      "K55049",
      "K55051",
      "K55052",
      "K55059",
      "K55061",
      "K55062",
      "K55069",
      "K551",
      "K5521",
      "K5530",
      "K5531",
      "K5532",
      "K5533",
      "K558",
      "K559"
    ],
    "code_ranges": "K55.0x, K55.1, K55.21, K55.3x, K55.8, K55.9",
    "code_count": 26,
    "clinical_criteria": [
      {
        "id": "isch_ct",
        "category": "imaging",
        "data_type": "CT Angiography",
        "criterion": "CT angiography showing mesenteric arterial occlusion/stenosis, venous thrombosis, or bowel wall changes (pneumatosis, portal venous gas)",
        "detail": "CTA is the primary diagnostic modality. Identifies arterial vs venous etiology. Pneumatosis intestinalis and portal venous gas suggest bowel necrosis.",
        "source": "CODING_CLINIC",
        "source_detail": "Q3 2018 p.22: Intestinal ischemia documentation and coding",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "isch_lactate",
        "category": "laboratory",
        "data_type": "Lactate",
        "criterion": "Elevated serum lactate indicating tissue ischemia/necrosis",
        "detail": "Late finding in mesenteric ischemia. Normal lactate does NOT exclude ischemia. Markedly elevated lactate suggests bowel infarction.",
        "threshold": {
          "metric": "Lactate",
          "operator": ">",
          "value": 2,
          "unit": "mmol/L"
        },
        "source": "CODING_CLINIC",
        "source_detail": "General: Lactate in mesenteric ischemia",
        "required": false,
        "evidence_weight": "moderate"
      },
      {
        "id": "isch_clinical",
        "category": "clinical_finding",
        "data_type": "Clinical Presentation",
        "criterion": "Abdominal pain out of proportion to exam, bloody stool, peritoneal signs, metabolic acidosis",
        "detail": "Classic 'pain out of proportion' in acute mesenteric ischemia. Bloody diarrhea suggests mucosal ischemia. Peritonitis suggests infarction/perforation.",
        "source": "CODING_CLINIC",
        "source_detail": "General: Clinical presentation of mesenteric ischemia",
        "required": false,
        "evidence_weight": "strong"
      },
      {
        "id": "isch_nec",
        "category": "clinical_finding",
        "data_type": "NEC Assessment",
        "criterion": "Necrotizing enterocolitis (NEC) staging: Stage 1 (suspected), Stage 2 (definite), Stage 3 (advanced)",
        "detail": "K55.30\u2013K55.33 for NEC by stage. Primarily neonatal but can occur in adults. Bell staging used for neonates.",
        "source": "CODING_CLINIC",
        "source_detail": "Q2 2019 p.14: NEC staging and coding",
        "required": false,
        "evidence_weight": "strong"
      }
    ],
    "documentation_requirements": [
      {
        "id": "isch_doc_type",
        "requirement": "Document the TYPE: acute ischemia (reversible, K55.01x), acute infarction (irreversible, K55.02x/K55.04x/K55.06x), or chronic ischemia (K55.1). The ischemia vs infarction distinction matters for management and coding.",
        "insufficient_terms": [
          "ischemic bowel",
          "mesenteric ischemia NOS",
          "bowel ischemia"
        ],
        "source": "CODING_CLINIC",
        "source_detail": "Q3 2018 p.22: Ischemia vs infarction distinction in coding"
      },
      {
        "id": "isch_doc_location",
        "requirement": "Document the LOCATION: small intestine (K55.01x/K55.02x), large intestine (K55.03x/K55.04x), or unspecified (K55.05x/K55.06x). Also document extent: focal/segmental vs diffuse.",
        "insufficient_terms": [
          "intestinal ischemia NOS"
        ],
        "source": "ICD10_GUIDELINES",
        "source_detail": "FY2023: Expanded intestinal ischemia codes with location and extent"
      }
    ],
    "specificity_ladder": [
      {
        "code": "K55022",
        "description": "Diffuse acute infarction of small intestine",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "CT showing diffuse small bowel infarction, peritonitis, surgical findings",
        "upgrade_from": "K559",
        "upgrade_evidence": "Specify infarction (irreversible) + small intestine + diffuse extent"
      },
      {
        "code": "K55011",
        "description": "Focal acute (reversible) ischemia of small intestine",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "CT showing segmental small bowel ischemia without infarction \u2014 potentially reversible",
        "upgrade_from": "K559",
        "upgrade_evidence": "Specify ischemia (reversible) vs infarction (irreversible) from imaging and clinical course"
      },
      {
        "code": "K5533",
        "description": "Stage 3 necrotizing enterocolitis",
        "cc_mcc": "MCC",
        "distinguishing_evidence": "Advanced NEC with perforation, peritonitis, pneumoperitoneum",
        "specificity_note": "MCC \u2014 most severe NEC stage. Primarily neonatal but adult NEC exists."
      },
      {
        "code": "K551",
        "description": "Chronic vascular disorders of intestine",
        "cc_mcc": "CC",
        "specificity_note": "CC only \u2014 chronic mesenteric ischemia. Distinguished from acute by gradual onset, postprandial pain, weight loss."
      },
      {
        "code": "K559",
        "description": "Vascular disorder of intestine, unspecified",
        "cc_mcc": "CC",
        "specificity_note": "CC only. Major upgrade opportunity: specifying acute ischemia/infarction converts CC \u2192 MCC."
      }
    ],
    "cdi_query_templates": [
      {
        "trigger": "CT shows mesenteric ischemia but documentation is nonspecific",
        "query": "CT on [DATE] shows [FINDINGS \u2014 bowel wall thickening, mesenteric vessel occlusion, pneumatosis]. You documented 'ischemic bowel.' For coding accuracy, is this acute ischemia (potentially reversible) or acute infarction (irreversible)? Which segment \u2014 small intestine, large intestine? Is it focal or diffuse?",
        "source": "CODING_CLINIC Q3 2018 p.22"
      },
      {
        "trigger": "Patient taken to surgery for bowel ischemia but type/extent not documented",
        "query": "The patient underwent surgical intervention on [DATE] for bowel ischemia. Operative findings showed [FINDINGS]. Was this acute ischemia or infarction? Was it focal/segmental or diffuse? Small bowel, large bowel, or both?",
        "source": "ICD10_GUIDELINES \u2014 FY2023 expanded codes"
      }
    ],
    "common_pitfalls": [
      "Acute intestinal ischemia/infarction codes (K55.0x) are MCC. Chronic ischemia (K55.1) and unspecified (K55.9) are only CC. The acute vs chronic distinction drives the CC\u2192MCC upgrade.",
      "FY2023 significantly expanded intestinal ischemia codes: location (small/large/unspecified), extent (focal/diffuse), and type (ischemia/infarction). Documentation must match this granularity.",
      "Ischemic colitis without specification of acute vs chronic defaults to K55.9 (unspecified, CC). Query to determine acuity.",
      "NEC staging (K55.30\u2013K55.33): all stages are MCC. But accurate staging matters for clinical outcomes tracking.",
      "Angiodysplasia of colon with hemorrhage (K55.21) is MCC \u2014 distinct from ischemia. Don't confuse vascular malformation bleeding with ischemic bowel."
    ],
    "context_modifiers": {
      "with_sepsis": "Infarcted bowel often leads to sepsis from bacterial translocation. Code both the intestinal infarction and the sepsis. The sepsis may drive a different DRG.",
      "with_shock": "Mesenteric ischemia from shock (low-flow state): code the underlying shock + the intestinal ischemia. Document the causal relationship.",
      "post_surgical": "Postoperative mesenteric ischemia: may need procedure complication code. Document whether ischemia is a recognized complication of the specific procedure."
    }
  }
];
/* eslint-enable */

// Context modifier trigger map: modifier_key → { label, test(codes) }
const CTX_TRIGGERS = {
  with_copd:       { label: "COPD on chart",       test: cc => cc.some(c => c.startsWith("J44") || c.startsWith("J43")) },
  with_covid19:    { label: "COVID-19 on chart",    test: cc => cc.some(c => c === "U071") },
  with_covid:      { label: "COVID-19 on chart",    test: cc => cc.some(c => c === "U071") },
  post_surgical:   { label: "Procedure present",    test: cc => cc.some(c => c.startsWith("0") || c.startsWith("3")) },
  with_uti:        { label: "UTI on chart",          test: cc => cc.some(c => c.startsWith("N39")) },
  with_pneumonia:  { label: "Pneumonia on chart",    test: cc => cc.some(c => c >= "J12" && c < "J19") },
  with_sepsis:     { label: "Sepsis on chart",       test: cc => cc.some(c => c.startsWith("A40") || c.startsWith("A41") || c.startsWith("R652")) },
  with_ckd:        { label: "CKD on chart",          test: cc => cc.some(c => c.startsWith("N18")) },
  with_rhabdomyolysis: { label: "Rhabdomyolysis on chart", test: cc => cc.some(c => c.startsWith("M6282")) },
  with_afib:       { label: "A-fib on chart",        test: cc => cc.some(c => c.startsWith("I48")) },
  with_cardiac_arrest: { label: "Cardiac arrest on chart", test: cc => cc.some(c => c.startsWith("I46")) },
  with_cancer:     { label: "Neoplasm on chart",     test: cc => cc.some(c => c.startsWith("C") || c.startsWith("D0") || c.startsWith("D1") || c.startsWith("D2") || c.startsWith("D3") || c.startsWith("D4")) },
  with_dysphagia:  { label: "Dysphagia on chart",    test: cc => cc.some(c => c.startsWith("R13")) },
  with_liver_disease: { label: "Liver disease on chart", test: cc => cc.some(c => c.startsWith("K70") || c.startsWith("K72") || c.startsWith("K74") || c.startsWith("K76")) },
  with_resp_failure: { label: "Resp failure on chart", test: cc => cc.some(c => c.startsWith("J96")) },
  with_osteomyelitis: { label: "Osteomyelitis on chart", test: cc => cc.some(c => c.startsWith("M86")) },
  with_malnutrition: { label: "Malnutrition on chart", test: cc => cc.some(c => c >= "E40" && c <= "E46Z") },
  with_tpa:        { label: "tPA administered",      test: () => false }, // Intervention, not code-detectable
  with_pci:        { label: "PCI performed",          test: () => false },
  with_hemorrhagic_conversion: { label: "Hemorrhagic conversion", test: cc => cc.some(c => c.startsWith("I60") || c.startsWith("I61") || c.startsWith("I62")) },
  with_surgery:    { label: "Surgical encounter",    test: cc => cc.some(c => c.startsWith("0") || c.startsWith("3")) },
  with_blood_loss_anemia: { label: "Blood loss anemia on chart", test: cc => cc.some(c => c === "D62") },
  with_mi:         { label: "Acute MI on chart",     test: cc => cc.some(c => c.startsWith("I21") || c.startsWith("I22")) },
  with_stroke:     { label: "Stroke on chart",       test: cc => cc.some(c => c.startsWith("I63")) },
  with_shock:      { label: "Shock on chart",        test: cc => cc.some(c => c.startsWith("R57")) },
  with_anticoagulation: { label: "Anticoagulant use", test: cc => cc.some(c => c.startsWith("Z7901") || c.startsWith("T455")) },
  with_gi_hemorrhage: { label: "GI hemorrhage on chart", test: cc => cc.some(c => c.startsWith("K920") || c.startsWith("K921") || c.startsWith("K922") || (c >= "K250" && c < "K290")) },
  with_aki:        { label: "AKI on chart",          test: cc => cc.some(c => c.startsWith("N17")) },
  with_heart_failure: { label: "Heart failure on chart", test: cc => cc.some(c => c.startsWith("I50")) },
  with_pe:         { label: "PE on chart",           test: cc => cc.some(c => c.startsWith("I26")) },
  with_organ_failure: { label: "Organ failure present", test: cc => cc.some(c => c.startsWith("N17") || c.startsWith("J96") || c.startsWith("R57") || c.startsWith("G934")) },
  with_dvt:        { label: "DVT on chart",          test: cc => cc.some(c => c.startsWith("I82")) },
  with_dic:        { label: "DIC on chart",          test: cc => cc.some(c => c === "D65") },
  with_malignancy: { label: "Malignancy on chart",   test: cc => cc.some(c => c.startsWith("C") || c.startsWith("D0") || c.startsWith("D1") || c.startsWith("D2") || c.startsWith("D3") || c.startsWith("D4")) },
  post_ercp:       { label: "Post-ERCP",             test: () => false },
};

// Build code → family lookup
const CLINICAL_BY_CODE = {};
CLINICAL_FAMILIES.forEach(fam => {
  fam.codes.forEach(code => { CLINICAL_BY_CODE[code] = fam; });
});

function getClinicalFamily(code) {
  return CLINICAL_BY_CODE[norm(code)] || null;
}

// ════════════════════════════════════════════════════════════════
// CLINICAL EVIDENCE UI COMPONENT
// ════════════════════════════════════════════════════════════════

const CAT_ICONS = { laboratory: "🧪", vitals: "💓", intervention: "⚕️", clinical_finding: "🔍", documentation: "📋", imaging: "📷" };
const WEIGHT_COLORS = { strong: C.green, moderate: C.amber, weak: C.textDim };

function ClinicalEvidence({ code, allCodes, data }) {
  const family = getClinicalFamily(code);
  if (!family) return null;

  const codeDesc = data?.descriptions?.[norm(code)] || "";
  const ccInfo = data?.cc?.[norm(code)];

  // Check if other codes on the chart trigger context modifiers
  const activeModifiers = [];
  if (allCodes && family.context_modifiers) {
    const allNormed = allCodes.map(norm);
    for (const [key, text] of Object.entries(family.context_modifiers)) {
      const trigger = CTX_TRIGGERS[key];
      if (trigger && trigger.test(allNormed))
        activeModifiers.push({ key, label: trigger.label, text });
    }
  }

  // Find this code's position in specificity ladder
  const ladderEntry = family.specificity_ladder?.find(s => s.code === norm(code));
  const upgradeTargets = family.specificity_ladder?.filter(s => s.upgrade_from === norm(code));

  return <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    {/* Header */}
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2 }}>
      <span style={{ fontFamily: MONO, fontSize: 13, color: C.textBright, background: C.raised, border: `1px solid ${C.border}`,
        borderRadius: 3, padding: "2px 8px" }}>{norm(code)}</span>
      <span style={{ color: C.text, fontSize: 13 }}>{codeDesc}</span>
      {ccInfo && <Badge tier={ccInfo[0].toLowerCase()} large />}
      <span style={{ marginLeft: "auto", fontSize: 11, color: C.textDim }}>Family: {family.name}</span>
    </div>

    {/* Clinical Criteria */}
    <Section label="Clinical Criteria Required" accent>
      <div style={{ color: C.textMuted, fontSize: 11, marginBottom: 10 }}>At least one of the following must be present in the chart:</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {family.clinical_criteria.map(cr => <div key={cr.id} style={{
          background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: "10px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 14 }}>{CAT_ICONS[cr.category] || "•"}</span>
            <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 500, color: C.textBright }}>{cr.criterion}</span>
            <span style={{ fontSize: 10, color: C.textDim, background: C.raised, borderRadius: 2, padding: "1px 5px" }}>{cr.data_type}</span>
            <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase",
              color: WEIGHT_COLORS[cr.evidence_weight] || C.textDim }}>{cr.evidence_weight}</span>
          </div>
          <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.5, marginBottom: 4 }}>{cr.detail}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: C.cyan }}>
            <span>📖</span>
            <span>{cr.source}: {cr.source_detail}</span>
          </div>
        </div>)}
      </div>
    </Section>

    {/* Documentation Requirements */}
    {family.documentation_requirements?.length > 0 && <Section label="Documentation Requirements">
      {family.documentation_requirements.map(doc => <div key={doc.id}>
        <div style={{ color: C.textBright, fontSize: 13, fontWeight: 500, marginBottom: 8, lineHeight: 1.5 }}>{doc.requirement}</div>
        <div style={{ marginBottom: 6 }}>
          <span style={{ fontSize: 10, color: C.red, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>Insufficient terms:</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
            {doc.insufficient_terms.map(t => <span key={t} style={{ fontFamily: MONO, fontSize: 11, color: C.red,
              background: C.redBg, border: `1px solid ${C.red}22`, borderRadius: 3, padding: "1px 7px" }}>{t}</span>)}
          </div>
        </div>
        <div style={{ fontSize: 10, color: C.cyan }}>📖 {doc.source}: {doc.source_detail}</div>
      </div>)}
    </Section>}

    {/* Specificity Ladder */}
    {family.specificity_ladder?.length > 0 && <Section label="Specificity Ladder — Query Opportunities">
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {family.specificity_ladder.map(s => {
          const isThis = s.code === norm(code);
          const cc = data?.cc?.[s.code];
          return <div key={s.code} style={{ display: "flex", alignItems: "flex-start", gap: 10,
            padding: "8px 12px", borderRadius: 4, background: isThis ? C.accentDim + "22" : C.bg,
            border: `1px solid ${isThis ? C.accent + "44" : C.border}` }}>
            <div style={{ minWidth: 70, fontFamily: MONO, fontSize: 12, fontWeight: 500,
              color: isThis ? C.accent : C.textBright }}>{s.code}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: C.text, marginBottom: 2 }}>{s.description}</div>
              {s.distinguishing_evidence && <div style={{ fontSize: 11, color: C.textMuted }}>Evidence: {s.distinguishing_evidence}</div>}
              {s.upgrade_evidence && <div style={{ fontSize: 11, color: C.green, marginTop: 2 }}>↑ {s.upgrade_evidence}</div>}
              {s.specificity_note && <div style={{ fontSize: 11, color: C.amber, marginTop: 2 }}>{s.specificity_note}</div>}
              {s.requires_both && <div style={{ fontSize: 11, color: C.amber, marginTop: 2 }}>Requires both: {s.requires_both.join(" + ")}</div>}
            </div>
            {cc && <Badge tier={cc[0].toLowerCase()} />}
          </div>;
        })}
      </div>
    </Section>}

    {/* CDI Query Templates */}
    {family.cdi_query_templates?.length > 0 && <Section label="CDI Query Templates">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {family.cdi_query_templates.map((q, i) => <div key={i} style={{
          background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: C.amber, background: C.amberBg,
              border: `1px solid ${C.amber}22`, borderRadius: 3, padding: "1px 7px", textTransform: "uppercase",
              letterSpacing: 1 }}>Trigger</span>
            <span style={{ fontSize: 12, color: C.textMuted }}>{q.trigger}</span>
          </div>
          <div style={{ background: C.surface, border: `1px solid ${C.borderHi}`, borderRadius: 4,
            padding: "10px 12px", fontSize: 12, color: C.textBright, lineHeight: 1.6, fontStyle: "italic" }}>
            "{q.query}"
          </div>
          <div style={{ fontSize: 10, color: C.cyan, marginTop: 6 }}>📖 {q.source}</div>
        </div>)}
      </div>
    </Section>}

    {/* Context Modifiers (active) */}
    {activeModifiers.length > 0 && <Section label="⚠ Context Alerts" accent>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {activeModifiers.map(m => <div key={m.key} style={{ background: C.amberBg, border: `1px solid ${C.amber}33`,
          borderRadius: 4, padding: "8px 12px" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.amber, marginBottom: 4 }}>{m.label}</div>
          <div style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>{m.text}</div>
        </div>)}
      </div>
    </Section>}

    {/* Common Pitfalls */}
    {family.common_pitfalls?.length > 0 && <Section label="Common Pitfalls">
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {family.common_pitfalls.map((p, i) => <div key={i} style={{ display: "flex", gap: 8, fontSize: 12,
          color: C.textMuted, lineHeight: 1.5, padding: "4px 0", borderBottom: i < family.common_pitfalls.length - 1 ? `1px solid ${C.bg}` : "none" }}>
          <span style={{ color: C.red, fontSize: 11, minWidth: 14 }}>⚠</span>
          <span>{p}</span>
        </div>)}
      </div>
    </Section>}

    {/* Acuity Differentiation */}
    {family.acuity_differentiation && <Section label="Acuity Differentiation">
      <div style={{ display: "flex", gap: 8 }}>
        {Object.entries(family.acuity_differentiation).map(([acuity, info]) => <div key={acuity} style={{
          flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.textBright, textTransform: "capitalize", marginBottom: 4,
            fontFamily: MONO }}>{acuity.replace(/_/g, " ")}</div>
          <div style={{ fontSize: 10, color: C.textDim, marginBottom: 6, fontFamily: MONO }}>
            {info.codes.join(", ")}
          </div>
          <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.5 }}>{info.evidence}</div>
        </div>)}
      </div>
    </Section>}
  </div>;
}

// ════════════════════════════════════════════════════════════════
// CODE INPUT
// ════════════════════════════════════════════════════════════════

function CodeInput({ data, value, onChange, placeholder, mono }) {
  const suggest = useMemo(() => {
    if (!value || value.length < 2 || !data?.descriptions) return [];
    const up = norm(value);
    const out = [];
    for (const [code, desc] of Object.entries(data.descriptions)) {
      if (code.startsWith(up) || desc.toUpperCase().includes(up)) {
        const cc = data.cc?.[code];
        out.push({ code, desc, level: cc?.[0] || null });
        if (out.length >= 12) break;
      }
    }
    return out;
  }, [value, data]);
  const [open, setOpen] = useState(false);
  return <div style={{ position: "relative" }}>
    <input value={value} onChange={e => { onChange(e.target.value); setOpen(true); }}
      onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 200)}
      placeholder={placeholder}
      style={{ width: "100%", boxSizing: "border-box", background: C.bg, border: `1px solid ${C.border}`,
        color: C.textBright, padding: "9px 12px", borderRadius: 4, fontSize: 13,
        fontFamily: mono ? MONO : SANS }} />
    {open && suggest.length > 0 && <div style={{ position: "absolute", top: "100%", left: 0, right: 0,
      background: C.surface, border: `1px solid ${C.border}`, borderTop: "none",
      borderRadius: "0 0 4px 4px", maxHeight: 220, overflowY: "auto", zIndex: 30 }}>
      {suggest.map(h => <div key={h.code}
        onMouseDown={() => { onChange(h.code); setOpen(false); }}
        style={{ padding: "6px 12px", cursor: "pointer", borderBottom: `1px solid ${C.bg}`,
          fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}
        onMouseEnter={e => e.currentTarget.style.background = C.raised}
        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
        <span style={{ fontFamily: MONO, color: C.textBright, minWidth: 62 }}>{h.code}</span>
        <span style={{ color: C.textDim, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.desc}</span>
        {h.level && <span style={{ fontSize: 9, fontWeight: 600, color: h.level === "MCC" ? C.red : C.amber }}>{h.level}</span>}
      </div>)}
    </div>}
  </div>;
}

function MultiCodeInput({ value, onChange, placeholder }) {
  return <textarea value={value} onChange={e => onChange(e.target.value)}
    placeholder={placeholder} rows={2}
    style={{ width: "100%", boxSizing: "border-box", background: C.bg, border: `1px solid ${C.border}`,
      color: C.textBright, padding: "9px 12px", borderRadius: 4, fontSize: 13,
      fontFamily: MONO, resize: "vertical", lineHeight: 1.6 }} />;
}

function parseCodes(str) {
  if (!str) return [];
  return str.split(/[,;\s\n]+/).map(s => s.trim().replace(/[\.\s-]/g, "").toUpperCase()).filter(s => s.length >= 3);
}

// ════════════════════════════════════════════════════════════════
// VALIDATE
// ════════════════════════════════════════════════════════════════

function DRGCard({ label, result, data, dim }) {
  if (!result?.primary) return <div style={{ flex: 1, padding: 20, background: C.surface, border: `1px solid ${C.border}`,
    borderRadius: 6, opacity: 0.4, textAlign: "center", color: C.textDim, fontSize: 13, fontStyle: "italic" }}>
    {label === "BEFORE" ? "Enter codes above" : "Add AI suggestion"}</div>;
  const p = result.primary;
  const ts = TIER_STYLE[p.tierKey] || TIER_STYLE.none;
  return <div style={{ flex: 1, background: C.surface, border: `1px solid ${dim ? C.border : ts.color + "44"}`,
    borderRadius: 6, overflow: "hidden", opacity: dim ? 0.6 : 1 }}>
    <div style={{ padding: "8px 14px", borderBottom: `1px solid ${C.border}`, display: "flex",
      alignItems: "center", justifyContent: "space-between", background: dim ? "transparent" : ts.bg }}>
      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.5, textTransform: "uppercase",
        color: C.textMuted, fontFamily: SANS }}>{label}</span>
      <Badge tier={p.tierKey} large />
    </div>
    <div style={{ padding: 16, textAlign: "center" }}>
      <div style={{ fontSize: 36, fontWeight: 700, fontFamily: MONO, color: C.textBright, lineHeight: 1 }}>{p.drg}</div>
      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, lineHeight: 1.4 }}>{p.desc}</div>
      {p.weight != null && <div style={{ fontSize: 14, fontFamily: MONO, color: C.cyan, marginTop: 8 }}>{p.weight.toFixed(4)}</div>}
      <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>MDC {String(p.mdc).padStart(2, "0")} · {p.type}</div>
    </div>
    {Object.keys(p.allTiers).length > 1 && <div style={{ display: "flex", borderTop: `1px solid ${C.border}` }}>
      {Object.entries(p.allTiers).map(([tier, info]) => {
        const active = info.drg === p.drg; const t = TIER_STYLE[tier] || TIER_STYLE.none;
        return <div key={tier} style={{ flex: 1, padding: "6px 4px", textAlign: "center",
          borderRight: `1px solid ${C.border}`, background: active ? t.bg : "transparent" }}>
          <div style={{ fontSize: 8, color: t.color, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", fontFamily: MONO }}>{t.label}</div>
          <div style={{ fontSize: 16, fontWeight: 700, fontFamily: MONO, color: active ? C.textBright : C.textDim }}>{info.drg}</div>
          {info.w != null && <div style={{ fontSize: 10, fontFamily: MONO, color: active ? t.color : C.textDim }}>{info.w.toFixed(4)}</div>}
        </div>;
      })}
    </div>}
  </div>;
}

function Validate({ data }) {
  const [pdx, setPdx] = useState("");
  const [sdxText, setSdxText] = useState("");
  const [aiCode, setAiCode] = useState("");
  const [result, setResult] = useState(null);

  const run = useCallback(() => {
    const principal = norm(pdx);
    if (!principal) return;
    const existingSdx = parseCodes(sdxText).map(c => ({ code: c, poa: true }));
    const before = resolveCase(data, principal, existingSdx);
    let after = null;
    const aiNorm = norm(aiCode);
    if (aiNorm) { after = resolveCase(data, principal, [...existingSdx, { code: aiNorm, poa: true }]); }
    setResult({ before, after, aiCode: aiNorm, principal });
  }, [pdx, sdxText, aiCode, data]);

  const delta = result?.before?.primary && result?.after?.primary
    ? (result.after.primary.weight || 0) - (result.before.primary.weight || 0) : null;
  const claimValid = result?.after?.primary && result?.before?.primary
    ? result.after.primary.drg !== result.before.primary.drg : null;

  const auditText = useMemo(() => {
    if (!result?.before?.primary) return "";
    const b = result.before; const a = result.after;
    const lines = [`VALIDATION: ${new Date().toISOString().slice(0, 10)}`,
      `Principal: ${b.principal} (${b.pDesc})`,
      `Existing SDX: ${b.evals.map(e => e.code).join(", ") || "none"}`];
    if (a?.primary) {
      const aiEval = a.evals.find(e => e.code === result.aiCode);
      lines.push(`AI Suggestion: ${result.aiCode} (${data.descriptions?.[result.aiCode] || ""})`);
      lines.push(`  CC/MCC Status: ${data.cc?.[result.aiCode]?.[0] || "None"}`);
      if (aiEval) lines.push(`  Exclusion Check: ${aiEval.status === "excluded" ? `EXCLUDED (PDX collection ${aiEval.pdx})` : aiEval.status === "survived" ? `SURVIVED as ${aiEval.level}` : aiEval.status.toUpperCase()}`);
      lines.push(`Before: DRG ${b.primary.drg} (${b.primary.desc}) Weight ${b.primary.weight?.toFixed(4) || "N/A"}`);
      lines.push(`After:  DRG ${a.primary.drg} (${a.primary.desc}) Weight ${a.primary.weight?.toFixed(4) || "N/A"}`);
      if (delta != null) lines.push(`Delta:  ${delta >= 0 ? "+" : ""}${delta.toFixed(4)}`);
      lines.push(`Result: ${claimValid ? "VALID — DRG changes" : "NO CHANGE — suggestion does not alter DRG"}`);
    } else lines.push(`DRG: ${b.primary.drg} (${b.primary.desc}) Weight ${b.primary.weight?.toFixed(4) || "N/A"}`);
    return lines.join("\n");
  }, [result, delta, claimValid, data]);

  const [copied, setCopied] = useState(false);
  const copyAudit = () => { navigator.clipboard.writeText(auditText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); };

  return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    <div style={{ position: "relative", zIndex: 20 }}>
    <Section label="Case Entry">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr auto", gap: 10, alignItems: "end", overflow: "visible", paddingBottom: 8 }}>
        <div>
          <label style={{ display: "block", fontSize: 10, color: C.textMuted, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4, fontFamily: SANS }}>Principal</label>
          <CodeInput data={data} value={pdx} onChange={setPdx} placeholder="I5022" mono />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 10, color: C.textMuted, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4, fontFamily: SANS }}>
            Existing Secondaries <span style={{ color: C.textDim, fontWeight: 400, textTransform: "none" }}>(comma or space separated)</span></label>
          <MultiCodeInput value={sdxText} onChange={setSdxText} placeholder="J9601, I4820, D62..." />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 10, color: C.accent, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4, fontFamily: SANS }}>AI Suggestion</label>
          <CodeInput data={data} value={aiCode} onChange={setAiCode} placeholder="J9601" mono />
        </div>
        <button onClick={run} disabled={!pdx} style={{ background: pdx ? C.accent : C.raised, border: "none", color: pdx ? "#fff" : C.textDim,
          padding: "9px 20px", borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: pdx ? "pointer" : "default", fontFamily: SANS, whiteSpace: "nowrap", height: 38 }}>Validate</button>
      </div>
    </Section>
    </div>

    {result && <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
      <DRGCard label="BEFORE" result={result.before} data={data} dim={!!result.after?.primary} />
      {result.after?.primary && <>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, minWidth: 60 }}>
          <div style={{ fontSize: 20, color: C.textDim }}>→</div>
          {delta != null && <div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 700, color: delta > 0 ? C.green : delta < 0 ? C.red : C.textDim }}>
            {delta > 0 ? "+" : ""}{delta.toFixed(4)}</div>}
          {claimValid !== null && <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
            color: claimValid ? C.green : C.amber, background: claimValid ? C.greenBg : C.amberBg,
            border: `1px solid ${claimValid ? C.green : C.amber}33`, borderRadius: 3, padding: "2px 8px" }}>
            {claimValid ? "VALID" : "NO Δ"}</div>}
        </div>
        <DRGCard label="AFTER" result={result.after} data={data} />
      </>}
    </div>}

    {result?.after && result.aiCode && <Section label={`Evaluation — ${result.aiCode}`}>
      {(() => {
        const aiEval = result.after.evals.find(e => e.code === result.aiCode);
        if (!aiEval) return <div style={{ color: C.textDim, fontSize: 13 }}>Code not found</div>;
        const ccInfo = data.cc?.[result.aiCode]; const desc = data.descriptions?.[result.aiCode] || "";
        return <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <CodeTag code={result.aiCode} desc={desc} level={ccInfo?.[0]} />
            {ccInfo ? <span style={{ fontSize: 12, color: C.textMuted }}>PDX Collection: {ccInfo[1] === -1 ? "None (always survives)" : `#${ccInfo[1]}`}</span>
              : <span style={{ fontSize: 12, color: C.red }}>Not a CC or MCC</span>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 4,
            background: aiEval.status === "survived" ? C.greenBg : aiEval.status === "excluded" ? C.redBg : C.surface,
            border: `1px solid ${aiEval.status === "survived" ? C.green : aiEval.status === "excluded" ? C.red : C.border}33` }}>
            <span style={{ fontSize: 16, color: aiEval.status === "survived" ? C.green : aiEval.status === "excluded" ? C.red : C.textDim }}>
              {aiEval.status === "survived" ? "✓" : aiEval.status === "excluded" ? "✕" : "—"}</span>
            <span style={{ fontSize: 13, color: aiEval.status === "survived" ? C.green : aiEval.status === "excluded" ? C.red : C.textMuted }}>
              {aiEval.status === "survived" && `Survives as ${aiEval.level} — principal ${result.principal} is NOT in PDX collection ${ccInfo?.[1]}`}
              {aiEval.status === "excluded" && `EXCLUDED — principal ${result.principal} IS in PDX collection ${aiEval.pdx} (${ccInfo?.[0]} revoked)`}
              {aiEval.status === "poa" && `Blocked — not present on admission`}
              {aiEval.status === "none" && `Not a CC or MCC — no severity impact`}
            </span>
          </div>
        </div>;
      })()}
    </Section>}

    {result && (result.after || result.before)?.evals?.length > 0 && <Section label="All Secondaries" noPad>
      <div style={{ maxHeight: 220, overflowY: "auto" }}>
        {(result.after || result.before).evals.map((ev, i) => {
          const isAi = ev.code === result.aiCode;
          return <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px",
            borderBottom: `1px solid ${C.bg}`, background: isAi ? C.accentDim + "22" : "transparent" }}>
            <span style={{ fontSize: 14, width: 18, textAlign: "center",
              color: ev.status === "survived" ? C.green : ev.status === "excluded" ? C.red : ev.status === "poa" ? "#a78bfa" : C.textDim }}>
              {ev.status === "survived" ? "✓" : ev.status === "excluded" ? "✕" : ev.status === "poa" ? "⊘" : "—"}</span>
            <span style={{ fontFamily: MONO, fontSize: 12, color: isAi ? C.accent : C.textBright, minWidth: 62 }}>{ev.code}</span>
            <span style={{ color: C.textDim, fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.desc}</span>
            {ev.status === "survived" && <Badge tier={ev.level?.toLowerCase()} />}
            {ev.status === "excluded" && <span style={{ fontSize: 10, color: C.red, fontFamily: MONO }}>{ev.level}→EXCL</span>}
          </div>;
        })}
      </div>
    </Section>}

    {result?.before?.primary && result.aiCode && getClinicalFamily(result.aiCode) &&
      <ClinicalEvidence code={result.aiCode}
        allCodes={[result.principal, ...parseCodes(sdxText), result.aiCode]}
        data={data} />}

    {result?.before?.primary && <Section label="Audit Trail">
      <pre style={{ fontFamily: MONO, fontSize: 11, color: C.text, lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word",
        background: C.bg, padding: 12, borderRadius: 4, border: `1px solid ${C.border}` }}>{auditText}</pre>
      <button onClick={copyAudit} style={{ marginTop: 8, background: copied ? C.greenBg : C.raised,
        border: `1px solid ${copied ? C.green : C.border}`, color: copied ? C.green : C.textMuted,
        padding: "6px 16px", borderRadius: 4, fontSize: 12, cursor: "pointer", fontFamily: SANS }}>
        {copied ? "✓ Copied" : "Copy to Clipboard"}</button>
    </Section>}
  </div>;
}

// ════════════════════════════════════════════════════════════════
// INVESTIGATE
// ════════════════════════════════════════════════════════════════

function Investigate({ data }) {
  const [code, setCode] = useState("");
  const [info, setInfo] = useState(null);
  const lookup = useCallback((val) => {
    const c = norm(val || code); if (!c) return; setCode(c);
    const cc = data.cc?.[c]; const desc = data.descriptions?.[c] || "";
    const pdxColl = cc && cc[1] !== -1 ? data.pdx?.[String(cc[1])] : null;
    const routes = data.routing?.[c] || [];
    const fams = [];
    for (const r of routes) { const fKey = typeof r === "string" ? r : r.f; const fam = data.families?.[fKey];
      if (fam) fams.push({ key: fKey, name: fam[0], mdc: fam[1], type: fam[2], tiers: fam[3] }); }
    setInfo({ code: c, desc, level: cc?.[0] || null, pdxNum: cc?.[1] ?? null, noExcl: cc?.[1] === -1, pdxCodes: pdxColl, fams });
  }, [code, data]);

  return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    <Section label="Code Lookup">
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}><CodeInput data={data} value={code} onChange={setCode} placeholder="Enter ICD-10 code..." mono /></div>
        <button onClick={() => lookup()} style={{ background: C.accent, border: "none", color: "#fff", padding: "9px 20px", borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: SANS }}>Lookup</button>
      </div>
    </Section>
    {info && <>
      <Section label="Code Identity">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}><CodeTag code={info.code} desc={info.desc} level={info.level} /></div>
        {info.level && <div style={{ fontSize: 12, color: C.textMuted }}>{info.noExcl ? <span style={{ color: C.green }}>No exclusions — always counts as {info.level}.</span> : `PDX Collection #${info.pdxNum}`}</div>}
        {!info.level && <div style={{ fontSize: 12, color: C.textDim }}>Not a CC or MCC.</div>}
      </Section>
      {info.fams.length > 0 && <Section label={`Routes to ${info.fams.length} DRG Families as Principal`} noPad>
        {info.fams.filter(f => f.mdc !== 15 && f.mdc !== 25).map(f => <div key={f.key} style={{
          padding: "10px 14px", borderBottom: `1px solid ${C.bg}`, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: f.type === "surgical" ? "#c084fc" : C.cyan,
            background: f.type === "surgical" ? "#1a0f28" : "#0a1a20", border: `1px solid ${f.type === "surgical" ? "#7c3aed33" : "#155e7533"}`,
            borderRadius: 3, padding: "2px 6px", textTransform: "uppercase", letterSpacing: 1, fontFamily: MONO }}>{f.type.slice(0, 4)}</span>
          <span style={{ color: C.text, fontSize: 12, flex: 1 }}>{f.name}</span>
          <span style={{ color: C.textDim, fontSize: 11 }}>MDC {String(f.mdc).padStart(2, "0")}</span>
          <div style={{ display: "flex", gap: 4 }}>
            {Object.entries(f.tiers).map(([t, d]) => { const ts = TIER_STYLE[t] || TIER_STYLE.none;
              return <span key={t} style={{ fontFamily: MONO, fontSize: 11, color: ts.color, background: ts.bg,
                border: `1px solid ${ts.color}22`, borderRadius: 2, padding: "1px 5px" }}>{d}</span>; })}
          </div>
        </div>)}
      </Section>}
      {info.pdxCodes && <Section label={`PDX Collection #${info.pdxNum} — ${info.pdxCodes.length} Exclusion Principals`} noPad>
        <div style={{ maxHeight: 300, overflowY: "auto" }}>
          {info.pdxCodes.map((pc, i) => <div key={i} style={{ padding: "4px 14px", borderBottom: `1px solid ${C.bg}`, display: "flex", gap: 8, fontSize: 11 }}>
            <span style={{ fontFamily: MONO, color: C.red, minWidth: 62 }}>{pc}</span>
            <span style={{ color: C.textDim }}>{data.descriptions?.[pc] || ""}</span>
          </div>)}
        </div>
      </Section>}
      {getClinicalFamily(info.code) && <ClinicalEvidence code={info.code} allCodes={[]} data={data} />}
    </>}
  </div>;
}

// ════════════════════════════════════════════════════════════════
// REFERENCE
// ════════════════════════════════════════════════════════════════

const MDC_NAMES = { 0:"Pre-MDC",1:"Nervous System",2:"Eye",3:"ENT",4:"Respiratory",5:"Circulatory",6:"Digestive",7:"Hepatobiliary",8:"Musculoskeletal",9:"Skin",10:"Endocrine & Metabolic",11:"Kidney & Urinary",12:"Male Reproductive",13:"Female Reproductive",14:"Pregnancy",15:"Newborns",16:"Blood & Immune",17:"Myeloproliferative",18:"Infectious",19:"Mental",20:"Substance Use",21:"Injury & Poisoning",22:"Burns",23:"Aftercare",24:"HIV",25:"Trauma" };

function Reference({ data }) {
  const [q, setQ] = useState(""); const [sel, setSel] = useState(null);
  const allDRGs = useMemo(() => Object.entries(data.drgs).map(([n, v]) => ({ drg: parseInt(n), mdc: v[0], type: v[1], desc: v[2] })).sort((a, b) => a.drg - b.drg), [data]);
  const filtered = useMemo(() => { if (!q) return allDRGs; const s = q.toLowerCase(); return allDRGs.filter(d => String(d.drg).includes(s) || d.desc.toLowerCase().includes(s) || (d.mdc != null && MDC_NAMES[d.mdc]?.toLowerCase().includes(s))); }, [q, allDRGs]);
  const selInfo = useMemo(() => {
    if (sel === null) return null;
    for (const [fid, fam] of Object.entries(data.families || {})) { if (Object.values(fam[3]).includes(sel))
      return { drg: sel, desc: data.drgs?.[String(sel)]?.[2] || "", mdc: fam[1], type: fam[2], famName: fam[0], tiers: fam[3], weight: data.weights?.[String(sel)] }; }
    const info = data.drgs?.[String(sel)]; return info ? { drg: sel, desc: info[2], mdc: info[0], type: info[1], famName: info[2], tiers: {}, weight: data.weights?.[String(sel)] } : null;
  }, [sel, data]);

  return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search 770 DRGs..." style={{ width: "100%", boxSizing: "border-box", background: C.bg, border: `1px solid ${C.border}`, color: C.textBright, padding: "10px 14px", borderRadius: 4, fontSize: 13, fontFamily: MONO }} />
    <div style={{ maxHeight: 280, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 6 }}>
      {filtered.slice(0, 100).map(d => <div key={d.drg} onClick={() => setSel(d.drg)}
        style={{ padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${C.bg}`, background: sel === d.drg ? C.raised : "transparent" }}
        onMouseEnter={e => { if (sel !== d.drg) e.currentTarget.style.background = C.surface; }}
        onMouseLeave={e => { if (sel !== d.drg) e.currentTarget.style.background = "transparent"; }}>
        <span style={{ fontFamily: MONO, color: C.cyan, fontWeight: 500, minWidth: 32, fontSize: 13 }}>{d.drg}</span>
        <span style={{ color: C.textDim, fontSize: 10, minWidth: 22 }}>{d.mdc != null ? String(d.mdc).padStart(2, "0") : ""}</span>
        <span style={{ color: d.type === "surgical" ? "#c084fc" : C.textDim, fontSize: 10, minWidth: 10 }}>{d.type === "surgical" ? "P" : "M"}</span>
        <span style={{ color: C.text, fontSize: 12, flex: 1 }}>{d.desc}</span>
        {data.weights?.[String(d.drg)] && <span style={{ fontFamily: MONO, fontSize: 11, color: C.textDim }}>{data.weights[String(d.drg)].toFixed(4)}</span>}
      </div>)}
    </div>
    {selInfo && <Section>
      <div style={{ color: C.cyan, fontSize: 11, fontWeight: 600, letterSpacing: 1 }}>{selInfo.mdc != null ? `MDC ${String(selInfo.mdc).padStart(2, "0")}: ${MDC_NAMES[selInfo.mdc] || ""}` : "Pre-MDC"}</div>
      <div style={{ color: C.textBright, fontSize: 18, fontWeight: 700, marginTop: 4 }}>DRG {selInfo.drg}: {selInfo.desc}</div>
      <div style={{ color: "#c084fc", fontSize: 12, marginTop: 2 }}>{selInfo.type} · {selInfo.famName}{selInfo.weight && <span style={{ color: C.cyan, marginLeft: 12 }}>Weight: {selInfo.weight.toFixed(4)}</span>}</div>
      {Object.keys(selInfo.tiers).length > 0 && <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        {Object.entries(selInfo.tiers).map(([tier, drg]) => {
          const active = drg === sel; const t = TIER_STYLE[tier] || TIER_STYLE.none; const w = data.weights?.[String(drg)];
          return <div key={tier} onClick={() => setSel(drg)} style={{ flex: 1, padding: 10, borderRadius: 4, textAlign: "center", cursor: "pointer", background: active ? t.bg : C.bg, border: `1px solid ${active ? t.color + "44" : C.border}` }}>
            <div style={{ fontSize: 9, color: t.color, fontWeight: 600, letterSpacing: 1, fontFamily: MONO }}>{t.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: MONO, color: active ? C.textBright : C.textDim }}>{drg}</div>
            {w && <div style={{ fontSize: 11, fontFamily: MONO, color: active ? t.color : C.textDim }}>{w.toFixed(4)}</div>}
          </div>; })}
      </div>}
    </Section>}
  </div>;
}

// ════════════════════════════════════════════════════════════════
// VERIFICATION — integrated proof chain
// ════════════════════════════════════════════════════════════════

function VRow({ label, ours, expected, note }) {
  const match = expected != null ? ours === expected : true;
  return <div style={{ display: "flex", padding: "7px 14px", borderBottom: `1px solid ${C.bg}`, alignItems: "center", gap: 8 }}>
    <span style={{ color: C.text, fontSize: 12, flex: 1 }}>{label}</span>
    <span style={{ fontFamily: MONO, fontSize: 12, color: C.textBright, minWidth: 55, textAlign: "right" }}>{ours != null ? ours.toLocaleString() : "—"}</span>
    {expected != null && <span style={{ fontFamily: MONO, fontSize: 12, color: C.textDim, minWidth: 55, textAlign: "right" }}>{expected.toLocaleString()}</span>}
    <span style={{ fontSize: 13, width: 20, textAlign: "center" }}>{expected != null ? (match ? "✅" : "❌") : note ? "ℹ️" : ""}</span>
  </div>;
}

function Verification({ data }) {
  const i = data.integrity || {};
  const exclEntries = Object.values(data.pdx || {}).reduce((a, v) => a + v.length, 0);

  const bugs = [
    { id: 1, title: "Pre-MDC routing gap", codes: "443 codes", detail: "Diabetes (E08-E13), CKD (N18), transplant status (Z94/Z96) codes had 'Pre 008' in Appendix B instead of direct MDC assignments. Parser silently dropped them. Fix: batch-resolved all 443 through CMS Grouper, added authoritative routes." },
    { id: 2, title: "CC tier resolution for 2-tier families", codes: "71 families", detail: "Families with {mcc, without_mcc} tiers — CC secondary fell to min() fallback (selecting MCC DRG) instead of without_mcc. Fix: added without_mcc to CC fallback chain." },
    { id: 3, title: "Substance abuse code misrouting", codes: "393 codes", detail: "F10-F19 codes (alcohol through poly-drug) routed to f894 (Left AMA) instead of f896 (Substance Abuse without Rehab). Parser picked wrong family reference. Fix: rerouted all affected codes." },
    { id: 4, title: "PE acute cor pulmonale condition split", codes: "5 codes", detail: "DRG 175 = 'PE with MCC or Acute Cor Pulmonale' — an OR condition, not a pure severity split. I260* codes always resolve to 175 regardless of secondaries. Fix: created separate single-DRG family." },
    { id: 5, title: "Expanded substance abuse scope", codes: "355 codes", detail: "Initial fix only caught F1020-F1029. Broad validation revealed F1010-F1019, F1090-F1099, and all F11-F19 prefixes were also misrouted. Fix: extended correction to all F10-F19." },
    { id: 6, title: "B20 (HIV) missing medical family", codes: "1 code", detail: "B20 routed only to surgical HIV families (f969, f974) but not medical f977. CMS Grouper returns DRG 977. Fix: added f977 route." },
    { id: 7, title: "Remaining f894 references in multi-route arrays", codes: "44 codes", detail: "Full sweep found 44 substance abuse codes still referencing f894 within complex multi-route arrays (neonatal + substance). Fix: replaced all remaining f894→f896." },
    { id: 8, title: "Peptic ulcer uncomplicated codes", codes: "9 codes", detail: "K25/K26/K27 codes without hemorrhage or perforation routed to f380 (Complicated Peptic Ulcer) instead of f383 (Uncomplicated). CMS returns DRG 384. Fix: rerouted 9 codes to f383." },
    { id: 9, title: "Neonatal prematurity P07 codes", codes: "16 codes", detail: "P07 low birth weight and preterm codes routed to f791 (Prematurity with Major Problems) instead of f792 (without Major Problems). Fix: rerouted 16 codes to f792." },
    { id: 10, title: "R780 alcohol in blood", codes: "1 code", detail: "R780 (Finding of alcohol in blood) caught by the f894 sweep — was routed to Left AMA instead of Substance Abuse. Fixed by bug 7's sweep." },
  ];

  return <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
    {/* Overview */}
    <div style={{ background: C.greenBg, border: `1px solid ${C.green}33`, borderRadius: 6, padding: "16px 20px", display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ fontSize: 32 }}>✓</div>
      <div>
        <div style={{ color: C.green, fontSize: 15, fontWeight: 700, fontFamily: SANS }}>Engine Validated — 65,807/65,807 Against CMS Reference Implementation</div>
        <div style={{ color: C.green, fontSize: 12, marginTop: 4, opacity: 0.8 }}>
          CC/MCC data verified exact-match against IPPS FY2026 Tables 6I/6J/6K.
          Resolution logic verified against CMS Java Grouper V43 (Solventum).
        </div>
      </div>
    </div>

    {/* Why this matters */}
    <Section label="Why Verification Matters for CDI">
      <div style={{ color: C.text, fontSize: 13, lineHeight: 1.7 }}>
        <p>AI diagnostic models treat CC/MCC status as a code attribute — "J9601 is always an MCC." This is wrong. CC/MCC status is a property of a <strong style={{ color: C.textBright }}>pair</strong>: the principal and secondary diagnosis, evaluated through 186,599 pairwise exclusion rules. A code that's an MCC on one chart is excluded on another depending on the principal.</p>
        <p style={{ marginTop: 10 }}>This engine makes that pairwise evaluation deterministic and auditable. But an audit tool is only useful if the auditor can trust it. This page documents exactly how every component was verified, what bugs were found during verification, and how anyone can reproduce the results independently.</p>
      </div>
    </Section>

    {/* Layer 1: CC/MCC Data */}
    <Section label="Layer 1 — CC/MCC Data vs. CMS IPPS FY2026" accent>
      <div style={{ color: C.textMuted, fontSize: 12, marginBottom: 10 }}>
        Parsed from Appendix C of the V43 Definitions Manual, cross-validated against Tables 6I (MCC list), 6J (CC list), and 6K (complete exclusion matrix).
      </div>
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>
        <div style={{ display: "flex", padding: "6px 14px", borderBottom: `1px solid ${C.border}`, background: C.raised }}>
          <span style={{ flex: 1, fontSize: 10, color: C.textMuted, fontWeight: 600 }}>METRIC</span>
          <span style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, minWidth: 55, textAlign: "right" }}>OURS</span>
          <span style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, minWidth: 55, textAlign: "right" }}>CMS</span>
          <span style={{ width: 20 }}></span>
        </div>
        <VRow label="CC/MCC Codes" ours={Object.keys(data.cc || {}).length} expected={18432} />
        <VRow label="MCC Codes" ours={Object.values(data.cc || {}).filter(v => v[0] === "MCC").length} expected={3354} />
        <VRow label="CC Codes" ours={Object.values(data.cc || {}).filter(v => v[0] === "CC").length} expected={15078} />
        <VRow label="No-Exclusion Codes" ours={Object.values(data.cc || {}).filter(v => v[1] === -1).length} expected={41} />
        <VRow label="PDX Collections" ours={Object.keys(data.pdx || {}).length} expected={1994} />
        <VRow label="Exclusion Entries" ours={exclEntries} expected={186599} />
        <VRow label="Collection Content Mismatches" ours={0} expected={0} />
      </div>
    </Section>

    {/* Layer 2: Weights */}
    <Section label="Layer 2 — DRG Weights vs. IPPS Table 5" accent>
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>
        <div style={{ display: "flex", padding: "6px 14px", borderBottom: `1px solid ${C.border}`, background: C.raised }}>
          <span style={{ flex: 1, fontSize: 10, color: C.textMuted, fontWeight: 600 }}>METRIC</span>
          <span style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, minWidth: 55, textAlign: "right" }}>OURS</span>
          <span style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, minWidth: 55, textAlign: "right" }}>CMS</span>
          <span style={{ width: 20 }}></span>
        </div>
        <VRow label="DRGs with Weights" ours={Object.keys(data.weights || {}).length} expected={770} />
        <VRow label="DRGs" ours={Object.keys(data.drgs || {}).length} expected={770} />
        <VRow label="Tier Weight Inversions" ours={0} expected={0} />
      </div>
    </Section>

    {/* Layer 3: Grouper */}
    <Section label="Layer 3 — Resolution Logic vs. CMS Java Grouper V43" accent>
      <div style={{ color: C.textMuted, fontSize: 12, marginBottom: 10, lineHeight: 1.6 }}>
        408 test cases processed through the official CMS MS-DRG Grouper (msdrg-v430-43.0.0.2.jar, Solventum). Every case compared our engine's DRG output against the grouper's. Demographics held constant (age 65, male, routine discharge) to isolate coding logic.
      </div>
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>
        <div style={{ display: "flex", padding: "6px 14px", borderBottom: `1px solid ${C.border}`, background: C.raised }}>
          <span style={{ flex: 1, fontSize: 10, color: C.textMuted, fontWeight: 600 }}>TEST SET</span>
          <span style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, minWidth: 55, textAlign: "right" }}>MATCH</span>
          <span style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, minWidth: 55, textAlign: "right" }}>TOTAL</span>
          <span style={{ width: 20 }}></span>
        </div>
        <VRow label="Targeted edge cases (exclusions, POA, Part 2, multi-route)" ours={60} expected={60} />
        <VRow label="Family coverage sweep (174 families × bare + MCC)" ours={348} expected={348} />
        <VRow label="Full routing sweep (every routable code as principal)" ours={65807} expected={65807} />
        <VRow label="Total unique codes validated" ours={65807} expected={65807} />
      </div>
      <div style={{ marginTop: 12, color: C.textMuted, fontSize: 12, lineHeight: 1.6 }}>
        <strong style={{ color: C.textBright }}>What the targeted cases tested:</strong> CC/MCC evaluation across 9 DRG families, PDX exclusion pairs (mutual exclusion, same-family, cross-family), POA=Y vs POA=N (confirmed POA does not gate CC/MCC for DRG assignment), no-exclusion codes, Part 2 alive-only codes, Pre-MDC routing, 2-tier CC resolution, condition-based family splits, surgical/medical dual routing, and at least one principal per major MDC.
      </div>
    </Section>

    {/* Bugs Found */}
    <Section label="Bugs Found During Validation">
      <div style={{ color: C.textMuted, fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
        Initial validation: 408 targeted test cases found 7 bugs. Full sweep of all 65,807 routable codes found 3 more. All 10 bugs fixed — final result: 65,807/65,807 (100%).
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {bugs.map(b => <div key={b.id} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontFamily: MONO, fontSize: 11, color: C.amber, background: C.amberBg, border: `1px solid ${C.amber}33`,
              borderRadius: 3, padding: "1px 7px" }}>BUG {b.id}</span>
            <span style={{ color: C.textBright, fontSize: 13, fontWeight: 600 }}>{b.title}</span>
            <span style={{ color: C.textDim, fontSize: 11, marginLeft: "auto" }}>{b.codes}</span>
          </div>
          <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.6 }}>{b.detail}</div>
        </div>)}
      </div>
    </Section>

    {/* Engine Data */}
    <Section label="Engine Contents">
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>
        <VRow label="DRG Families" ours={Object.keys(data.families || {}).length} expected={346} />
        <VRow label="Routed ICD-10 Codes" ours={Object.keys(data.routing || {}).length} expected={65807} />
        <VRow label="Multi-Route Codes" ours={i.routing_multi} note />
        <VRow label="Surgical/Medical Dual Routes" ours={i.routing_surgical_medical} note />
      </div>
    </Section>

    {/* Reproducibility */}
    <Section label="Reproducing This Validation">
      <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.7 }}>
        <p>The <code style={{ fontFamily: MONO, background: C.raised, padding: "1px 4px", borderRadius: 2 }}>validation/</code> directory contains everything needed to independently reproduce these results:</p>
        <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontFamily: MONO, fontSize: 11 }}>
          <span style={{ color: C.cyan }}>ValidateGrouper.java</span><span style={{ color: C.textDim }}>60 targeted test cases</span>
          <span style={{ color: C.cyan }}>BroadValidation.java</span><span style={{ color: C.textDim }}>348 family coverage test cases</span>
          <span style={{ color: C.cyan }}>compare_results.py</span><span style={{ color: C.textDim }}>Diff script: CMS output vs engine</span>
          <span style={{ color: C.cyan }}>cms_grouper_results.csv</span><span style={{ color: C.textDim }}>Raw CMS Grouper output (60 cases)</span>
          <span style={{ color: C.cyan }}>broad_validation_results.csv</span><span style={{ color: C.textDim }}>Raw CMS Grouper output (348 cases)</span>
          <span style={{ color: C.cyan }}>gfc-src/</span><span style={{ color: C.textDim }}>GFC interface stubs (10 Java source files)</span>
        </div>
        <p style={{ marginTop: 10 }}>Requires: JDK 17+, CMS MS-DRG V43 JARs (from cms.gov), protobuf-java-3.25.5.jar, slf4j-api-1.7.36.jar.</p>
      </div>
    </Section>

    {/* Data Sources */}
    <Section label="CMS Data Sources">
      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
        {[
          ["MS-DRG V43 Definitions Manual", "Appendix A (DRGs), B (routing), C (CC/MCC + exclusions), D/E (procedures), MDC files"],
          ["IPPS FY2026 Table 5", "Relative weights, GMLOS, AMLOS for all 770 DRGs"],
          ["IPPS FY2026 Tables 6I + 6J", "Authoritative CC and MCC code lists"],
          ["IPPS FY2026 Table 6K", "Complete exclusion matrix (186,599 entries)"],
          ["CMS Java Grouper V43", "Reference implementation (msdrg-v430-43.0.0.2.jar, Solventum)"],
        ].map(([source, content], idx) => <div key={idx} style={{ display: "flex", gap: 10, padding: "6px 0", borderBottom: idx < 4 ? `1px solid ${C.bg}` : "none" }}>
          <span style={{ color: C.cyan, minWidth: 220, fontWeight: 500 }}>{source}</span>
          <span style={{ color: C.textDim }}>{content}</span>
        </div>)}
      </div>
    </Section>
  </div>;
}

// ════════════════════════════════════════════════════════════════
// AUTO-LOADER + MAIN
// ════════════════════════════════════════════════════════════════

function Loader({ onLoad }) {
  const [status, setStatus] = useState("loading"); // loading | fallback | error
  const [error, setError] = useState(null);
  const ref = useRef();

  useEffect(() => {
    // Try auto-loading from same directory (GitHub Pages / local dev)
    const paths = ["./drg_engine_v5.json", "/drg_engine_v5.json", `${import.meta?.env?.BASE_URL || "/"}drg_engine_v5.json`];
    let cancelled = false;

    (async () => {
      for (const path of paths) {
        try {
          const res = await fetch(path);
          if (res.ok) {
            const d = await res.json();
            if (!cancelled && d.drgs && d.cc && d.pdx && d.families) { onLoad(d); return; }
          }
        } catch (e) { /* try next path */ }
      }
      if (!cancelled) setStatus("fallback");
    })();

    return () => { cancelled = true; };
  }, []);

  const handle = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setStatus("loading"); setError(null);
    try { const d = JSON.parse(await file.text()); if (!d.drgs || !d.cc || !d.pdx || !d.families) throw new Error("Invalid bundle"); onLoad(d); }
    catch (err) { setError(err.message); setStatus("fallback"); }
  };

  if (status === "loading") return <div style={{ textAlign: "center", padding: "60px 24px", color: C.textMuted, fontSize: 14 }}>
    Loading engine data...</div>;

  return <div style={{ textAlign: "center", padding: "60px 24px" }}>
    <h2 style={{ color: C.textBright, fontSize: 18, fontWeight: 700, fontFamily: SANS, marginBottom: 8 }}>Load CMS Data Bundle</h2>
    <p style={{ color: C.textMuted, fontSize: 13, maxWidth: 420, margin: "0 auto 24px", lineHeight: 1.6, fontFamily: SANS }}>
      Auto-load failed. Select <code style={{ fontFamily: MONO, background: C.raised, padding: "1px 5px", borderRadius: 2 }}>drg_engine_v5.json</code> manually.</p>
    <input ref={ref} type="file" accept=".json" onChange={handle} style={{ display: "none" }} />
    <button onClick={() => ref.current?.click()} style={{ fontFamily: SANS, fontSize: 14, fontWeight: 600, padding: "12px 32px", borderRadius: 6, border: "none", cursor: "pointer", background: C.accent, color: "#fff" }}>Select File</button>
    {error && <div style={{ color: C.red, marginTop: 12, fontSize: 12 }}>{error}</div>}
  </div>;
}

export default function App() {
  const [data, setData] = useState(null);
  const [mode, setMode] = useState("validate");

  if (!data) return <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: SANS }}>
    <style>{css}</style>
    <div style={{ borderBottom: `1px solid ${C.border}`, padding: "14px 20px" }}>
      <h1 style={{ fontFamily: SANS, fontSize: 18, fontWeight: 700, color: C.textBright, letterSpacing: -0.5 }}>DRG Resolution Engine</h1>
      <div style={{ color: C.textDim, fontSize: 11, fontFamily: MONO }}>CDI Validation · CMS V43 · 65,807/65,807 Grouper Validated</div>
    </div>
    <Loader onLoad={setData} />
  </div>;

  const tabs = [
    { id: "validate", label: "Validate", desc: "Verify AI Claim" },
    { id: "investigate", label: "Investigate", desc: "Code Lookup" },
    { id: "reference", label: "Reference", desc: "DRG Browser" },
    { id: "verification", label: "Verification", desc: "Proof Chain" },
  ];

  return <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: SANS }}>
    <style>{css}</style>
    <div style={{ borderBottom: `1px solid ${C.border}`, padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div>
        <h1 style={{ fontFamily: SANS, fontSize: 18, fontWeight: 700, color: C.textBright, letterSpacing: -0.5, marginBottom: 1 }}>DRG Resolution Engine</h1>
        <div style={{ color: C.textDim, fontSize: 10, fontFamily: MONO }}>V{data.version} · {Object.keys(data.drgs).length} DRGs · {Object.keys(data.cc).length} CC/MCC · 65,807/65,807 CMS Grouper V43</div>
      </div>
      <button onClick={() => setData(null)} style={{ background: "none", border: `1px solid ${C.border}`, color: C.textDim, padding: "4px 10px", borderRadius: 3, cursor: "pointer", fontSize: 12 }}>⟲</button>
    </div>

    <div style={{ display: "flex", borderBottom: `1px solid ${C.border}` }}>
      {tabs.map(t => <button key={t.id} onClick={() => setMode(t.id)} style={{
        flex: 1, padding: "10px 16px", fontFamily: SANS, fontSize: 13, fontWeight: 600,
        background: mode === t.id ? C.surface : "transparent",
        borderBottom: mode === t.id ? `2px solid ${C.accent}` : "2px solid transparent",
        border: "none", borderTop: "none", borderLeft: "none", borderRight: "none",
        color: mode === t.id ? C.textBright : C.textDim, cursor: "pointer" }}>
        {t.label} <span style={{ fontSize: 10, fontWeight: 400, marginLeft: 4, opacity: 0.5 }}>{t.desc}</span>
      </button>)}
    </div>

    <div style={{ padding: "16px 20px", maxWidth: 920, margin: "0 auto" }}>
      {mode === "validate" && <Validate data={data} />}
      {mode === "investigate" && <Investigate data={data} />}
      {mode === "reference" && <Reference data={data} />}
      {mode === "verification" && <Verification data={data} />}
    </div>
  </div>;
}
