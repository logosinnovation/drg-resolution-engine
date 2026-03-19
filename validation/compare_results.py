#!/usr/bin/env python3
"""
Compare CMS Grouper output against our DRG Resolution Engine.

Usage:
  python3 compare_results.py cms_grouper_results.csv drg_engine_v4.json

Input: CSV from ValidateGrouper.java with columns:
  test_id,principal,secondaries,cms_drg,cms_mdc,cms_severity,cms_medsurg,cms_base_drg,sdx_severities

Output: Per-case comparison showing matches, mismatches, and root cause analysis.
"""

import json, csv, sys, re

def norm(c):
    return c.replace('.','').replace(' ','').replace('-','').upper()

def resolve_medical(data, principal, secondaries):
    """Resolve case using our engine, returning medical path result."""
    p = norm(principal)
    routes = data['routing'].get(p, [])
    if not routes:
        return None
    
    # Parse routes
    parsed = []
    for r in routes:
        if isinstance(r, str):
            fam = data['families'].get(r)
            if fam: parsed.append({'fam': r, 'mdc': fam[1], 'type': fam[2]})
        elif isinstance(r, dict):
            parsed.append({'fam': r['f'], 'mdc': r['m'], 'type': r['t']})
    
    # Filter to primary routes (non-neonatal, non-trauma)
    primary = [r for r in parsed if r['mdc'] not in (15, 25)]
    if not primary: primary = parsed
    
    # Evaluate secondaries
    highest = None
    for sec in secondaries:
        s = norm(sec['code'])
        cc = data['cc'].get(s)
        if not cc: continue
        level, pdx_coll = cc
        if pdx_coll != -1:
            coll = data['pdx'].get(str(pdx_coll), [])
            if p in coll: continue
        poa = sec.get('poa', True)
        if poa == False: continue
        if level == 'MCC': highest = 'MCC'
        elif level == 'CC' and highest != 'MCC': highest = 'CC'
    
    # Resolve each route
    results = []
    for route in primary:
        fam = data['families'].get(route['fam'])
        if not fam: continue
        name, mdc, typ, tiers = fam[0], fam[1], fam[2], fam[3]
        
        if highest == 'MCC':
            drg = tiers.get('mcc') or tiers.get('cc_mcc') or tiers.get('single')
        elif highest == 'CC':
            drg = tiers.get('cc') or tiers.get('cc_mcc') or tiers.get('single')
        else:
            drg = tiers.get('base') or tiers.get('without_mcc') or tiers.get('single')
        
        if not drg:
            drg = min(tiers.values()) if tiers else None
        
        results.append({
            'drg': drg,
            'mdc': mdc,
            'type': typ,
            'family': name,
            'severity': highest or 'NON_CC',
        })
    
    return results

def main():
    if len(sys.argv) < 3:
        print("Usage: python3 compare_results.py cms_grouper_results.csv drg_engine_v4.json")
        sys.exit(1)
    
    csv_file = sys.argv[1]
    json_file = sys.argv[2]
    
    with open(json_file) as f:
        data = json.load(f)
    
    matches = 0
    mismatches = 0
    errors = 0
    total = 0
    
    mismatch_details = []
    
    with open(csv_file) as f:
        reader = csv.DictReader(f)
        for row in reader:
            total += 1
            test_id = row['test_id']
            principal = row['principal']
            sdx_str = row['secondaries']
            cms_drg = row['cms_drg']
            cms_mdc = row['cms_mdc']
            cms_severity = row['cms_severity']
            cms_medsurg = row['cms_medsurg']
            
            if 'ERROR' in str(cms_drg) or 'NO_OUTPUT' in str(cms_drg):
                errors += 1
                continue
            
            cms_drg_int = int(cms_drg)
            
            # Parse secondaries
            secondaries = []
            if sdx_str:
                for s in sdx_str.split(';'):
                    s = s.strip()
                    if not s: continue
                    poa = True
                    if '(POA=N)' in s:
                        poa = False
                        s = s.replace('(POA=N)','').replace('(POA=Y)','')
                    elif '(POA=Y)' in s:
                        s = s.replace('(POA=Y)','')
                    secondaries.append({'code': s.strip(), 'poa': poa})
            
            # Run our engine
            our_results = resolve_medical(data, principal, secondaries)
            
            if not our_results:
                mismatches += 1
                mismatch_details.append({
                    'test': test_id, 'principal': principal,
                    'reason': 'NO_ROUTE', 'cms_drg': cms_drg_int, 'our_drg': None
                })
                continue
            
            # Check if CMS DRG matches ANY of our paths
            our_drgs = [r['drg'] for r in our_results]
            
            if cms_drg_int in our_drgs:
                matches += 1
            else:
                mismatches += 1
                mismatch_details.append({
                    'test': test_id,
                    'principal': principal,
                    'secondaries': sdx_str,
                    'cms_drg': cms_drg_int,
                    'cms_mdc': cms_mdc,
                    'cms_severity': cms_severity,
                    'cms_medsurg': cms_medsurg,
                    'our_paths': our_results,
                    'our_drgs': our_drgs,
                    'reason': 'DRG_MISMATCH',
                })
    
    # Report
    print("=" * 70)
    print("CMS GROUPER vs OUR ENGINE — VALIDATION REPORT")
    print("=" * 70)
    print(f"Total test cases:  {total}")
    print(f"CMS errors/skip:   {errors}")
    print(f"Compared:          {total - errors}")
    print(f"Matches:           {matches}")
    print(f"Mismatches:        {mismatches}")
    accuracy = matches / (total - errors) * 100 if (total - errors) > 0 else 0
    print(f"Accuracy:          {accuracy:.1f}%")
    print()
    
    if mismatch_details:
        print("=" * 70)
        print("MISMATCH DETAILS")
        print("=" * 70)
        for m in mismatch_details:
            print(f"\nTest {m['test']}: Principal={m['principal']}")
            if 'secondaries' in m:
                print(f"  Secondaries: {m.get('secondaries','')}")
            print(f"  CMS:  DRG {m['cms_drg']} (MDC {m.get('cms_mdc','?')}, {m.get('cms_severity','?')}, {m.get('cms_medsurg','?')})")
            if m.get('our_paths'):
                for p in m['our_paths']:
                    marker = '→' if p['drg'] != m['cms_drg'] else '✓'
                    print(f"  Ours: DRG {p['drg']} ({p['type']}, {p['family'][:40]}) {marker}")
            elif m.get('reason') == 'NO_ROUTE':
                print(f"  Ours: NO ROUTE FOUND")
            print(f"  Reason: {m['reason']}")
    
    print()
    print("=" * 70)
    if mismatches == 0:
        print("✅ ALL CASES MATCH — Engine validated against CMS Grouper")
    else:
        print(f"⚠ {mismatches} mismatches found — investigate each one")
    print("=" * 70)

if __name__ == '__main__':
    main()
