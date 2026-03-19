/*
 * CMS MS-DRG Grouper Validation Harness
 * 
 * SETUP:
 * 1. Place all JARs in a /lib folder:
 *    - msdrg-v430-43_0_0_2.jar
 *    - msdrg-model-v2-2_10_0.jar
 *    - msdrg-binary-access-1_4_2.jar
 *    - Utility-1_1_1.jar
 *    - gfc-base-api-3.4.9.jar (from https://github.com/solventum-oss/GFC-Grouper-Foundation-Classes/releases)
 *    - protobuf-java-3.25.5.jar (from Maven Central)
 *    - slf4j-api-1.7.36.jar (from Maven Central)
 *    - slf4j-simple-1.7.36.jar (from Maven Central, optional but prevents warnings)
 *
 * 2. Compile:
 *    javac -cp "lib/*" ValidateGrouper.java
 *
 * 3. Run:
 *    java -cp "lib/*:." ValidateGrouper > cms_grouper_results.csv
 *
 * Output: CSV with columns: test_id,principal,secondaries,cms_drg,cms_mdc,cms_severity,cms_medsurg,cms_base_drg
 */

import gov.agency.msdrg.model.v2.MsdrgOption;
import gov.agency.msdrg.model.v2.MsdrgRuntimeOption;
import gov.agency.msdrg.model.v2.RuntimeOptions;
import gov.agency.msdrg.model.v2.enumeration.*;
import gov.agency.msdrg.model.v2.transfer.MsdrgClaim;
import gov.agency.msdrg.model.v2.transfer.input.*;
import gov.agency.msdrg.model.v2.transfer.output.*;
import gov.agency.msdrg.v430.MsdrgComponent;
import com.mmm.his.cer.foundation.model.GfcPoa;
import java.util.*;

public class ValidateGrouper {

    static MsdrgComponent component;

    public static void main(String[] args) throws Exception {
        MsdrgRuntimeOption runtimeOptions = new MsdrgRuntimeOption();
        RuntimeOptions options = new RuntimeOptions();
        options.setPoaReportingExempt(MsdrgHospitalStatusOptionFlag.NON_EXEMPT);
        options.setComputeAffectDrg(MsdrgAffectDrgOptionFlag.COMPUTE);
        options.setMarkingLogicTieBreaker(MarkingLogicTieBreaker.CLINICAL_SIGNIFICANCE);
        runtimeOptions.put(MsdrgOption.RUNTIME_OPTION_FLAGS, options);
        component = new MsdrgComponent(runtimeOptions);

        // CSV header
        System.out.println("test_id,principal,secondaries,cms_drg,cms_mdc,cms_severity,cms_medsurg,cms_base_drg,sdx_severities");

        int id = 0;

        // ═══ CORE CDI TEST CASES ═══
        // Heart Failure family (291-293)
        run(++id, "I5022", new String[]{"J9601"});          // HF + Resp Failure MCC
        run(++id, "I5022", new String[]{"I4820"});           // HF + Chronic AFib CC
        run(++id, "I5022", new String[]{});                  // HF bare
        run(++id, "I5022", new String[]{"J9601","I4820","I5021","D62","E119"});  // HF + mixed (exclusion test)
        run(++id, "I5021", new String[]{"I5022"});           // Acute HF + Chronic HF (mutual exclusion)

        // Pneumonia family (193-195)
        run(++id, "J189", new String[]{"J9601"});            // Pneumonia + Resp Failure MCC
        run(++id, "J189", new String[]{"I4820"});            // Pneumonia + CC
        run(++id, "J189", new String[]{});                   // Pneumonia bare
        run(++id, "J181", new String[]{"A419"});             // Lobar pneumonia + Sepsis

        // AMI family (280-285)
        run(++id, "I214", new String[]{"A419"});             // NSTEMI + Sepsis MCC
        run(++id, "I214", new String[]{"D62"});              // NSTEMI + Anemia CC
        run(++id, "I214", new String[]{});                   // NSTEMI bare
        run(++id, "I2101", new String[]{"J9601"});           // STEMI + Resp Failure

        // GI Hemorrhage (377-379)
        run(++id, "K920", new String[]{"A419","K921"});      // Hematemesis + Sepsis + Melena (excl test)
        run(++id, "K920", new String[]{"D62"});              // Hematemesis + Anemia CC
        run(++id, "K920", new String[]{});                   // Hematemesis bare

        // COPD (190-192)
        run(++id, "J441", new String[]{"J9601"});            // COPD + Resp Failure MCC
        run(++id, "J440", new String[]{"J441"});             // COPD w/ infection + COPD exac (excl test)
        run(++id, "J441", new String[]{});                   // COPD bare

        // Renal Failure (682-684) — dual route test
        run(++id, "N179", new String[]{"J9601","D62"});      // AKI + Resp Failure + Anemia
        run(++id, "N179", new String[]{"I4820"});            // AKI + CC
        run(++id, "N179", new String[]{});                   // AKI bare

        // Sepsis (870-872)
        run(++id, "A419", new String[]{"R6520"});            // Sepsis + Severe Sepsis
        run(++id, "A419", new String[]{});                   // Sepsis bare

        // Diabetes complications
        run(++id, "E1165", new String[]{"J9601"});           // T2DM hyperglycemia + Resp Failure
        run(++id, "E1122", new String[]{"N186"});            // T2DM CKD + ESRD

        // Stroke (64-66)
        run(++id, "I6340", new String[]{"R6520"});           // Cerebral infarction + Severe Sepsis
        run(++id, "I6340", new String[]{"I4820"});           // Cerebral infarction + AFib CC
        run(++id, "I6340", new String[]{});                  // Cerebral infarction bare

        // ═══ POA TESTS ═══
        run_poa(++id, "I5022", "J9601", GfcPoa.N);          // HF + Resp Failure POA=N
        run_poa(++id, "I5022", "J9601", GfcPoa.Y);          // HF + Resp Failure POA=Y (control)
        run_poa(++id, "J189", "A419", GfcPoa.N);            // Pneumonia + Sepsis POA=N

        // ═══ NO-EXCLUSION CODES ═══
        run(++id, "I5022", new String[]{"J1282"});           // HF + COVID pneumonia (MCC, no excl)
        run(++id, "J189", new String[]{"Z1621"});            // Pneumonia + Vancomycin resistance (CC, no excl)
        run(++id, "I214", new String[]{"D89833"});           // NSTEMI + Cytokine release G3 (CC, no excl)

        // ═══ FRACTURE CODES (previously missing from parse) ═══
        run(++id, "S72001A", new String[]{"S82001K"});       // Hip fx + Patella fx subsequent (CC)
        run(++id, "M8000XA", new String[]{"M8000XK"});       // Osteoporosis fx + subsequent encounter

        // ═══ SURGICAL vs MEDICAL ROUTING ═══
        run(++id, "A0221", new String[]{"R6520"});           // Salmonella meningitis (surg+med routes)
        run(++id, "A0224", new String[]{"A419"});            // Salmonella osteomyelitis

        // ═══ EDGE CASES ═══
        run(++id, "I469", new String[]{});                   // Cardiac arrest (Part 2 - alive only)
        run(++id, "I5022", new String[]{"I469"});            // HF + Cardiac arrest (Part 2 code as secondary)

        // ═══ BROAD COVERAGE — one principal per MDC ═══
        run(++id, "G309", new String[]{"J9601"});            // MDC 01 - Alzheimer's + MCC
        run(++id, "H269", new String[]{});                   // MDC 02 - Cataract
        run(++id, "J329", new String[]{});                   // MDC 03 - Chronic sinusitis
        run(++id, "J449", new String[]{"E119"});             // MDC 04 - COPD unspec
        run(++id, "I2510", new String[]{"E1165"});           // MDC 05 - Coronary atherosclerosis
        run(++id, "K5900", new String[]{"D62"});             // MDC 06 - Constipation
        run(++id, "K8019", new String[]{});                  // MDC 07 - Gallstones
        run(++id, "M5416", new String[]{});                  // MDC 08 - Radiculopathy
        run(++id, "L089", new String[]{"A419"});             // MDC 09 - Cellulitis + Sepsis
        run(++id, "E1165", new String[]{});                  // MDC 10 - T2DM hyperglycemia
        run(++id, "N390", new String[]{});                   // MDC 11 - UTI
        run(++id, "N40", new String[]{});                    // MDC 12 - BPH (use N401 if N40 invalid)
        run(++id, "N921", new String[]{});                   // MDC 13 - Menorrhagia
        run(++id, "O34219", new String[]{});                 // MDC 14 - Cesarean scar
        run(++id, "F329", new String[]{});                   // MDC 19 - Depression
        run(++id, "F1020", new String[]{});                  // MDC 20 - Alcohol dependence
        run(++id, "S72001A", new String[]{});                // MDC 21 - Hip fracture
        run(++id, "T3011XA", new String[]{});                // MDC 22 - Burn
        run(++id, "Z5189", new String[]{});                  // MDC 23 - Aftercare
        
        component.close();
        System.err.println("Complete: " + id + " test cases processed.");
    }

    static void run(int id, String pdx, String[] sdxCodes) throws Exception {
        List<MsdrgInputDxCode> sdx = new ArrayList<>();
        for (String s : sdxCodes) sdx.add(new MsdrgInputDxCode(s, GfcPoa.Y));
        process(id, pdx, sdxCodes, sdx);
    }

    static void run_poa(int id, String pdx, String sdxCode, GfcPoa poa) throws Exception {
        List<MsdrgInputDxCode> sdx = new ArrayList<>();
        sdx.add(new MsdrgInputDxCode(sdxCode, poa));
        process(id, pdx, new String[]{sdxCode + "(POA=" + poa + ")"}, sdx);
    }

    static void process(int id, String pdx, String[] sdxLabels, List<MsdrgInputDxCode> sdx) throws Exception {
        try {
            MsdrgInput input = MsdrgInput.builder()
                .withPrincipalDiagnosisCode(new MsdrgInputDxCode(pdx, GfcPoa.Y))
                .withAdmissionDiagnosisCode(new MsdrgInputDxCode(pdx, GfcPoa.Y))
                .withSecondaryDiagnosisCodes(sdx)
                .withAgeInYears(65)
                .withSex(MsdrgSex.MALE)
                .withDischargeStatus(MsdrgDischargeStatus.HOME_SELFCARE_ROUTINE)
                .build();

            MsdrgClaim claim = new MsdrgClaim(input);
            component.process(claim);

            Optional<MsdrgOutputData> out = claim.getOutput();
            if (out.isPresent()) {
                MsdrgOutputData o = out.get();
                
                // Collect SDX severity flags
                StringBuilder sdxSev = new StringBuilder();
                for (int i = 0; i < o.getSdxOutput().size(); i++) {
                    MsdrgOutputDxCode sdxOut = o.getSdxOutput().get(i);
                    if (sdxSev.length() > 0) sdxSev.append("|");
                    sdxSev.append(sdxOut.getInputDxCode().getValue())
                           .append("=")
                           .append(sdxOut.getFinalSeverityUsage());
                }

                System.out.println(id + "," + pdx + "," + String.join(";", sdxLabels)
                    + "," + o.getFinalDrg().getValue()
                    + "," + o.getFinalMdc().getValue()
                    + "," + o.getFinalSeverity()
                    + "," + o.getFinalMedSugType()
                    + "," + o.getFinalBaseDrg().getValue()
                    + "," + sdxSev);
            } else {
                System.out.println(id + "," + pdx + "," + String.join(";", sdxLabels) + ",NO_OUTPUT,,,,");
            }
        } catch (Exception e) {
            System.out.println(id + "," + pdx + "," + String.join(";", sdxLabels) + ",ERROR:" + e.getMessage() + ",,,,");
        }
    }
}
