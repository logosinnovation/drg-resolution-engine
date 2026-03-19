# Verification Methodology

This document describes how the DRG Resolution Engine was verified against authoritative CMS sources at every layer. The verification is structured as a chain of trust: raw CMS data → parsed engine data → logic validation against the CMS reference implementation.

## Verification Architecture

The engine has three independent layers, each verified separately:

```
Layer 1: CC/MCC Data        → Verified against IPPS FY2026 Tables 6I, 6J, 6K
Layer 2: DRG Weights/LOS    → Verified against IPPS FY2026 Table 5
Layer 3: Resolution Logic   → Verified against CMS Java Grouper V43 (408 test cases)
```

Layers 1 and 2 are **data verification** — confirming that what we parsed matches the authoritative source exactly. Layer 3 is **logic verification** — confirming that given the same inputs, our engine produces the same DRG as the CMS reference implementation.

---

## Layer 1: CC/MCC Data Verification

### Source Material

The CC/MCC layer was parsed from two independent sources and cross-validated:

| Source | Content | Role |
|--------|---------|------|
| Appendix C of the MS-DRG V43 Definitions Manual | CC/MCC code list, PDX collection assignments, collection membership | Primary parse source |
| IPPS FY2026 Tables 6I, 6J, 6K (authoritative) | Separate CC list, MCC list, complete exclusion matrix | Validation authority |

### Verification Process

**Step 1: Parse Appendix C** from the Definitions Manual text files. This produces:
- A list of codes with their CC or MCC designation
- A PDX collection number for each code
- The membership of each PDX collection (which diagnosis codes are in it)

**Step 2: Parse Tables 6I (MCC list) and 6J (CC list)** from the IPPS Final Rule. These are independent CMS publications that list every CC and MCC code separately.

**Step 3: Parse Table 6K (complete exclusion matrix)** from the IPPS Final Rule. This lists every CC/MCC code, its PDX collection assignment, and every code in that collection.

**Step 4: Cross-validate** every field between the two sources.

### Results

| Metric | Our Parse | Authoritative | Match |
|--------|-----------|---------------|-------|
| Total CC/MCC codes | 18,432 | 18,432 (Tables 6I + 6J) | Exact |
| MCC codes | 3,354 | 3,354 (Table 6I) | Exact |
| CC codes | 15,078 | 15,078 (Table 6J) | Exact |
| PDX collections | 1,994 | 1,994 (Table 6K) | Exact |
| Total exclusion entries | 186,599 | 186,599 (Table 6K) | Exact |
| Collection content mismatches | 0 | — | Zero |
| PDX assignment mismatches | 0 | — | Zero |

Every code's CC/MCC designation, every PDX collection assignment, and every exclusion entry was verified against the authoritative IPPS tables with zero discrepancies.

### Parse Bugs Found and Fixed

During parsing, two bugs were discovered and corrected:

**Bug 1 — Comma in code counts.** The original regex `(\d+)` didn't match entries like "5,561 codes" in PDX collection references. Fix: changed pattern to `([\d,]+)`. This recovered 5,573 fracture-related codes (K/P/M/N/Q/R suffixes) that were silently dropped.

**Bug 2 — "No Excl" format.** 41 codes have zero exclusions and always survive as CC/MCC regardless of principal. These appear in Appendix C as "No Excl" instead of the standard collection reference format. The parser only matched `0004:76 codes` pattern. Fix: added a second pattern for `No Excl`. These 41 codes are assigned PDX collection -1 in the engine, which signals "skip exclusion check — always survives."

Both bugs were identified by comparing parsed counts against Tables 6I/6J/6K totals. The count mismatch exposed the parsing error, and the fix was verified by re-running the cross-validation.

---

## Layer 2: DRG Weight Verification

### Source Material

| Source | Content |
|--------|---------|
| IPPS FY2026 Final Rule Table 5 | Relative weights, GMLOS, AMLOS for all 770 DRGs |

### Verification Process

Table 5 was parsed from the official CMS Excel file (`CMS-1833-F_Table_5.xlsx`). Each of the 770 DRGs was matched by number, and the weight, geometric mean length of stay (GMLOS), and arithmetic mean length of stay (AMLOS) were extracted.

### Results

| Metric | Count | Status |
|--------|-------|--------|
| DRGs with weights | 770 | All 770 matched |
| Weight mismatches | 0 | — |
| Tier weight ordering violations | 0 (475 correct, 2 ties) | No inversions |

Tier weight ordering was verified: for every DRG family with multiple tiers, MCC weight ≥ CC weight ≥ Base weight. Two families have tied weights between tiers (expected — some conditions have equal resource intensity regardless of complications). Zero inversions were found.

---

## Layer 3: CMS Java Grouper Validation

This is the critical validation layer. Layers 1 and 2 verify that we parsed the data correctly. Layer 3 verifies that our resolution **logic** is correct — that given the same claim inputs, we produce the same DRG as the official CMS grouper.

### CMS Java Grouper Setup

The CMS distributes a reference implementation of the MS-DRG grouper as compiled Java JAR files:

| JAR | Version | Purpose |
|-----|---------|---------|
| msdrg-v430-43_0_0_2.jar | 43.0.0.2 | Grouper implementation + embedded binary data |
| msdrg-model-v2-2_10_0.jar | 2.10.0 | Data model and transfer objects |
| msdrg-binary-access-1_4_2.jar | 1.4.2 | Binary data access layer |
| Utility-1_1_1.jar | 1.1.1 | CMS utility classes |
| protobuf-java-3.25.5.jar | 3.25.5 | Google Protocol Buffers (data serialization) |
| slf4j-api-1.7.36.jar | 1.7.36 | Logging framework |

The grouper also requires the GFC (Grouper Foundation Classes) framework, an open-source library published by Solventum at https://github.com/3mcloud/GFC-Grouper-Foundation-Classes. Rather than building the full GFC project, we created stub implementations of the 10 required interfaces and abstract classes by analyzing the grouper JAR bytecode for all references to `com.mmm.his.cer.foundation.*`:

| GFC Class | Purpose |
|-----------|---------|
| `GfcPoa` (enum) | Present on Admission indicator values |
| `FoundationException` | Checked exception base class |
| `FoundationRuntimeException` | Unchecked exception base class |
| `ComponentRuntime<K>` | Runtime options container (extends HashMap) |
| `IClaim` (interface) | Claim marker interface |
| `Claim` (abstract) | Claim base class |
| `Processable<C,K,R>` (interface) | Component processing interface |
| `ComponentName` (interface) | Component identifier |
| `ComponentVersion` (interface) | Version identifier |
| `ComponentPackage` (interface) | Package path customization |

These stubs were compiled using the `javax.tools.JavaCompiler` API available in the JRE, then linked against the CMS grouper JARs.

### Test Case Design

408 test cases were designed in two phases:

**Phase 1: Targeted Edge Cases (60 cases)**

These cases were designed to probe specific failure surfaces:

| Category | Cases | What it tests |
|----------|-------|---------------|
| CC/MCC evaluation | 22 | Codes that should survive, be excluded, or produce specific tiers across 9 DRG families (HF, pneumonia, AMI, GI hemorrhage, COPD, renal failure, sepsis, diabetes, stroke) |
| PDX exclusion matrix | 8 | Known exclusion pairs: mutual exclusion (I5021/I5022), same-family exclusion (J440/J441), cross-family exclusion (K920/K921) |
| POA gating | 3 | Same secondary with POA=Y vs POA=N (confirmed: POA does not gate CC/MCC for DRG assignment; it only triggers HAC processing) |
| No-exclusion codes | 3 | COVID pneumonia (J1282), vancomycin resistance (Z1621), cytokine release (D89833) — codes with PDX collection -1 that always survive |
| Previously missing codes | 2 | Fracture subsequent encounter codes (S82001K, M8000XK) recovered after the comma parse bug fix |
| Part 2 (alive-only) codes | 2 | Cardiac arrest (I469) — MCC only if discharged alive |
| Multi-route diagnoses | 2 | Salmonella codes with surgical + medical routing |
| Broad MDC coverage | 17 | At least one principal per major MDC to verify routing breadth |

**Phase 2: Family Coverage Sweep (348 cases)**

For every DRG family with a testable principal diagnosis code, two cases were run:
- The principal alone (no secondaries) — tests base/without_mcc tier resolution
- The principal + J9601 (acute respiratory failure with hypoxia) as MCC secondary — tests MCC tier resolution

This covered 174 distinct DRG families × 2 = 348 cases.

### Test Case Parameters

Every test case used consistent demographics to isolate coding logic from age/sex/discharge branching:

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Age | 65 years | Adult, no pediatric/neonatal branching |
| Sex | Male | Avoids OB/GYN routing |
| Discharge Status | Home/Self-Care (Routine) | Standard discharge, no transfer logic |
| POA (all codes) | Y (unless specifically testing POA=N) | Standard POA |
| Procedure Codes | None | Tests medical DRG path (no surgical routing) |

### Execution

Each test case was processed through the CMS Java Grouper using the V43 API:

```java
MsdrgRuntimeOption runtimeOptions = new MsdrgRuntimeOption();
RuntimeOptions options = new RuntimeOptions();
options.setPoaReportingExempt(MsdrgHospitalStatusOptionFlag.NON_EXEMPT);
options.setComputeAffectDrg(MsdrgAffectDrgOptionFlag.COMPUTE);
options.setMarkingLogicTieBreaker(MarkingLogicTieBreaker.CLINICAL_SIGNIFICANCE);
runtimeOptions.put(MsdrgOption.RUNTIME_OPTION_FLAGS, options);
MsdrgComponent component = new MsdrgComponent(runtimeOptions);

// For each test case:
MsdrgInput input = MsdrgInput.builder()
    .withPrincipalDiagnosisCode(new MsdrgInputDxCode(pdx, GfcPoa.Y))
    .withAdmissionDiagnosisCode(new MsdrgInputDxCode(pdx, GfcPoa.Y))
    .withSecondaryDiagnosisCodes(sdxList)
    .withAgeInYears(65)
    .withSex(MsdrgSex.MALE)
    .withDischargeStatus(MsdrgDischargeStatus.HOME_SELFCARE_ROUTINE)
    .build();

MsdrgClaim claim = new MsdrgClaim(input);
component.process(claim);
MsdrgOutputData output = claim.getOutput().get();
// Compare: output.getFinalDrg().getValue() vs our engine's DRG
```

The grouper output includes the final DRG, MDC, severity level, med/surg type, base DRG, and per-code severity flags (MCC, CC, MCC_EXCLUDED, CC_EXCLUDED, NEITHER). These per-code flags confirmed our exclusion matrix results at the individual code level.

### Results

**Phase 1: 60/60 (100%)**
**Phase 2: 348/348 (100%)**
**Combined: 408/408 (100%)**

### Bugs Found During Validation

The validation process exposed five bugs in the engine, all fixed before final results:

**Bug 1 — Pre-MDC routing gap (443 codes).** Diabetes codes (E08-E13), CKD codes (N18), and transplant status codes (Z94, Z96) have `Pre 008` in Appendix B instead of direct MDC assignments. Our Appendix B parser only captured direct `MDC XX DRG-DRG` entries and silently dropped the `Pre` prefix codes. Fix: batch-resolved all 443 codes through the CMS Grouper to get their authoritative DRG family assignments, then added those routes. Routing table grew from 65,364 to 65,807 codes.

**Bug 2 — CC tier resolution for 2-tier families.** 71 DRG families use the pattern `{mcc, without_mcc}` — there is no explicit `cc` tier. When a CC secondary survived, the resolution logic fell through to a `min()` fallback that selected the MCC DRG instead of `without_mcc`. Fix: added `tiers.without_mcc` to the CC fallback chain, ahead of `tiers.single`. One-line change.

**Bug 3 — Substance abuse code misrouting (393 codes).** F10-F19 codes (alcohol, opioids, cannabis, sedatives, cocaine, stimulants, hallucinogens, nicotine, inhalants, poly-drug) were parsed as routing to family f894 (Alcohol/Drug Abuse, Left AMA) instead of f896 (Alcohol/Drug Abuse without Rehabilitation Therapy). Root cause: Appendix B parser picked up the wrong family reference for these code ranges. Fix: rerouted all 393 codes from f894 to f896.

**Bug 4 — Pulmonary embolism condition-based split.** DRG 175 is described as "Pulmonary Embolism **with MCC or Acute Cor Pulmonale**" — an OR condition. Codes I2601-I2609 (PE with acute cor pulmonale) always resolve to DRG 175 regardless of secondaries, because the condition itself satisfies the DRG criteria independent of severity. Our engine treated this as a standard 2-tier family, resolving I260* without secondaries to DRG 176 (without MCC). Fix: created a separate single-DRG family for acute cor pulmonale PE codes.

**Bug 5 — Additional F10* codes missed in initial fix.** The first substance abuse fix only corrected F1020-F1029 (20 codes). The broad validation sweep revealed F1010-F1019 and F1090-F1099 were also misrouted (38 additional F10* codes), plus all of F11-F19 (355 codes). Fix: extended the routing correction to all F10-F19 prefixes.

### Validation Limitations

This validation covers medical DRG paths only (no procedure codes). Surgical DRG routing depends on ICS-10-PCS procedure codes, which were not included in test cases. The engine shows both surgical and medical paths when a principal routes to both family types, but surgical path selection is not validated against the CMS Grouper.

Test cases use fixed demographics (age 65, male, routine discharge). Age-specific routing (neonatal, pediatric), sex-specific routing (OB/GYN), and discharge-status-dependent logic are not covered.

The engine does not implement:
- Medicare Code Editor (MCE) edits (invalid code detection, age/sex conflicts)
- Hospital Acquired Condition (HAC) processing
- Transfer DRG payment adjustments
- Outlier payment calculations

---

## Reproducing the Validation

### Prerequisites

- Java JDK 17+ (or JRE 21+ with `javax.tools.JavaCompiler` available)
- CMS MS-DRG V43 Standalone JARs (from cms.gov)
- Python 3.8+

### Files

| File | Purpose |
|------|---------|
| `ValidateGrouper.java` | 60 targeted test cases |
| `BroadValidation.java` | 348 family coverage test cases |
| `compare_results.py` | Diff script comparing CMS output vs engine |
| `cms_grouper_results.csv` | Raw CMS Grouper output (60 cases) |
| `broad_validation_results.csv` | Raw CMS Grouper output (348 cases) |
| `drg_engine_v5.json` | Engine data file being validated |

### Steps

```bash
# 1. Compile GFC stubs (10 Java source files in gfc-src/)
#    These are interface/abstract class stubs, not the full GFC project

# 2. Compile test harnesses against CMS JARs + GFC stubs
javac -cp "lib/*:classes" ValidateGrouper.java
javac -cp "lib/*:classes" BroadValidation.java

# 3. Run through CMS Grouper
java -cp "lib/*:classes:." ValidateGrouper > cms_grouper_results.csv
java -cp "lib/*:classes:." BroadValidation > broad_validation_results.csv

# 4. Compare against engine
python3 compare_results.py cms_grouper_results.csv drg_engine_v5.json
python3 compare_results.py broad_validation_results.csv drg_engine_v5.json
```

### Expected Output

```
ORIGINAL 60: 60/60 (100.0%)
BROAD 348: 348/348 (100.0%)
```

---

## Appendix: CMS Java Grouper API Note

During validation, a discrepancy was found between the API documentation and the compiled binary. The API guide (pbl161_msdrg_java_api.pdf) documents the method as `getFinalMedSurgType()`. The actual compiled method name in `MsdrgOutputData.class` is `getFinalMedSugType()` (missing the 'r' in "Surg"). This is a typo in the Solventum binary, not a functional issue. Code referencing the API doc will fail to compile; use `getFinalMedSugType()`.
