"""
Vercel Python serverless function: ingest Alma posts via webhook.

POST /api/ingest-alma
  Headers: X-Ingest-Secret: <INGEST_SECRET>
  Body:    { "html": "...", "subject": "..." }

Parsing logic ported UNCHANGED from alma_pipeline_final.py (validated parser).
SQLite removed — writes to Supabase via REST upsert on date.
"""

import json
import os
import re
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler

from bs4 import BeautifulSoup

MONTHS = {'jan':1,'feb':2,'mar':3,'apr':4,'may':5,'jun':6,
          'jul':7,'aug':8,'sep':9,'oct':10,'nov':11,'dec':12}
TARGET = {'SPX','ES','SPY','VIX','IWM','QQQ'}

# ─────────────────────────────────────────────────────────────────────────────
# DATE PARSING  (unchanged from alma_pipeline_final.py)
# ─────────────────────────────────────────────────────────────────────────────
def parse_date_from_metadata(html_content):
    """
    Email-exported posts (no post-ID, no DDMonYY filename) embed an exact
    ISO timestamp in a 'post-date' meta attribute — more precise than the
    filename convention. Not present in the older RAR-sourced posts.
    """
    m = re.search(r'post-date"\s+title="(\d{4}-\d{2}-\d{2})T', html_content)
    return m.group(1) if m else None

def classify_post(fname):
    """Return 'intraday', 'weekly', or 'commentary' based on filename."""
    fl = fname.lower()
    if 'weekly' in fl or 'week' in fl: return 'weekly'
    if 'intraday' in fl or 'fomc-day' in fl or 'cpi-day' in fl or \
       'nfp-day' in fl or 'opex' in fl: return 'intraday'
    return 'intraday'  # default for ambiguous

# ─────────────────────────────────────────────────────────────────────────────
# CENTROID + PIVOT EXTRACTOR  (unchanged)
# ─────────────────────────────────────────────────────────────────────────────
def _id_get_num(patterns, text, lo=3000, hi=12000):
    for p in patterns:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            try:
                v = float(m.group(m.lastindex).replace(',',''))
                if lo < v < hi: return v
            except: pass
    return None

def expand_shorthand(text):
    """
    Fix: 'X/YY' shorthand where YY is a 2-digit fragment meaning the last two
    digits of a number sharing X's prefix (e.g. '5967/70' -> '5967/5970').
    Only expands when the second number has fewer digits than the first AND
    is not already a plausible standalone price (i.e. < 1000).
    """
    def repl(m):
        first, second = m.group(1), m.group(2)
        if len(second) < len(first) and float(second) < 1000:
            prefix_len = len(first) - len(second)
            expanded = first[:prefix_len] + second
            return f"{first}/{expanded}"
        return m.group(0)
    return re.sub(r'\b(\d{4,5})/(\d{1,3})\b', repl, text)

CENTROID_PATS = [
    (r'centroid is (?:priced as|the) (?:the )?most supportive[^.]{0,60}(?:\.\s*|\s+)[Ii]t is at\s*([\d,]+\.?\d+)\s*[-–]\s*([\d,]+\.?\d+)', 'range'),
    (r'centroid[^.]{0,120}is in the\s*([\d,]+\.?\d+)\s*[-–]\s*([\d,]+\.?\d+)', 'range'),
    (r'([\d,]+\.?\d+)\s*/\s*([\d,]+\.?\d+)[^.]{0,40}(?:as the centroid|as centroid|range as the centroid)', 'range'),
    (r'centroid[^.]{0,200}?[Ii]t is at\s*([\d,]+\.?\d+)\s*[-–]\s*([\d,]+\.?\d+)', 'range'),
    (r'([\d,]+\.?\d+)\s*[-–]\s*([\d,]+\.?\d+)[^.]{0,40}(?:as the centroid|as centroid)', 'range'),
    (r'([\d,]+\.?\d+)\s+as (?:the )?(?:main pivot and )?centroid', 'single'),
    (r'([\d,]+\.?\d+)\s+is the centroid', 'single'),
    (r'(?:net|main)\s+centroid\s+(?:is\s+)?([\d,]+\.?\d+)', 'single'),
    (r'centroid of\s+(?:the\s+)?(?:(?:whole|this|daily|speed|entire)\s+)*(?:positioning|position|profile|speed profile|speed positioning|whole positioning)?\s*(?:is\s+|falls?\s+to\s+|:)?\s*([\d,]+\.?\d+)', 'single'),
    (r'with (?:a )?centroid of\s*([\d,]+\.?\d+)', 'single'),
    (r'centroid\s+(?:is at|is|at|falls?\s+to|lies?\s+in\s+the)\s+(?:the\s+)?([\d,]+\.?\d+)', 'single'),
    (r'(?:around|below|above)\s+(?:the\s+)?(?:daily\s+)?centroid of\s*([\d,]+\.?\d+)', 'single'),
    (r'centering around the centroid of\s*([\d,]+\.?\d+)', 'single'),
    (r'centroid[^.]{0,80}?[Ii]t is at\s*([\d,]+\.?\d+)(?!\s*[-–])', 'single'),
    # NEW: "Coding the center at X" — vocabulary gap found in Feb 10 case
    (r'[Cc]oding the center at\s*([\d,]+\.?\d+)', 'single'),
    (r'([\d,]+\.?\d+)\s+as (?:the\s+)?center\b', 'single'),
    (r'~?([\d,]+\.?\d+)\s+as center\b', 'single'),
    (r'butterfly with\s*~?([\d,]+\.?\d+)\s+as center', 'single'),
    (r'centroid[^.\n]{0,60}?([\d]{4,5}\.?\d{0,2})', 'single'),
    (r'([\d]{4,5}\.?\d{0,2})[^.\n]{0,40}centroid', 'single'),
]
PROXY_PATS = [
    (r'([\d,]+\.?\d+)\s*/\s*([\d,]+\.?\d+)[^.]{0,40}(?:as the main pivot|main pivot)', 'range'),
    (r'flag\s+([\d,]+\.?\d+)\s*/\s*([\d,]+\.?\d+)', 'range'),
    (r'([\d,]+\.?\d+)\s+(?:area\s+)?as (?:the|our|my)? ?main pivot', 'single'),
    (r'main (?:daily\s+)?pivot\s+(?:for[^.]{0,40})?(?:is at|is|at|:)?\s*([\d,]+\.?\d+)', 'single'),
    # NEW: reversed order — value BEFORE "main pivot" phrase
    (r'([\d,]+\.?\d+)\s+(?:as\s+)?(?:the\s+)?main (?:daily\s+)?pivot(?:\s+lvl)?', 'single'),
    (r'([\d,]+\.?\d+)\s+as (?:our|the|my)\s+main pivot(?:\s+level)?', 'single'),
    (r'coding\s*([\d,]+\.?\d+)\s+the main (?:daily\s+)?pivot', 'single'),
]

def extract_centroid(text):
    text = expand_shorthand(text)
    for p, k in CENTROID_PATS:
        m = re.search(p, text, re.IGNORECASE)
        if not m: continue
        try:
            if k == 'range' and m.lastindex >= 2:
                c1,c2 = float(m.group(1).replace(',','')), float(m.group(2).replace(',',''))
                if 3000<c1<12000 and 3000<c2<12000 and 0<abs(c1-c2)<400:
                    return round((c1+c2)/2,2), True, 'centroid'
            else:
                v = float(m.group(m.lastindex).replace(',',''))
                if 3000<v<12000: return v, False, 'centroid'
        except: pass
    for p, k in PROXY_PATS:
        m = re.search(p, text, re.IGNORECASE)
        if not m: continue
        try:
            if k == 'range' and m.lastindex >= 2:
                c1,c2 = float(m.group(1).replace(',','')), float(m.group(2).replace(',',''))
                if 3000<c1<12000 and 3000<c2<12000 and 0<abs(c1-c2)<300:
                    return round((c1+c2)/2,2), True, 'main_pivot_proxy'
            else:
                v = float(m.group(m.lastindex).replace(',',''))
                if 3000<v<12000: return v, False, 'main_pivot_proxy'
        except: pass
    m = re.search(r'(?:IC|iron condor)[^.]{0,80}?(\d{4,5})[^.]{0,30}?(\d{4,5})[^.]{0,60}?(\d{4,5})[^.]{0,30}?(\d{4,5})', text, re.IGNORECASE)
    if m:
        try:
            vals = sorted([float(m.group(i)) for i in range(1,5)])
            if all(3000<v<12000 for v in vals):
                return round((vals[1]+vals[2])/2,2), False, 'IC_center_proxy'
        except: pass
    return None, False, None

def extract_zero_vanna(text):
    return _id_get_num([
        r'(?:zero vanna|vanna flip|vanna line)[^.]{0,80}?([\d,]+\.?\d+)',
        # NEW: reversed order — value BEFORE the phrase
        r'([\d,]+\.?\d+)\s+is a zero vanna lvl',
        r'([\d,]+\.?\d+)\s+(?:is\s+)?(?:the\s+)?zero vanna(?:\s+lvl|\s+line)?',
    ], text)

def extract_charm_flip(text):
    return _id_get_num([r'[Cc]harm flip[^.]{0,60}?([\d,]+\.?\d+)',
                     r'([\d,]+\.?\d+)\s+(?:is\s+)?(?:the\s+)?charm flip'], text)

UP_PATS = [
    r'([\d,]+\.?\d+)\s*\(upside pivot\)', r'([\d,]+\.?\d+)\s*\(this is the upside pivot\)',
    r'(?:break through|above)\s*([\d,]+\.?\d+)\s+to the upside',
    r'[Tt]o the upside,?[^.]{0,40}?([\d,]+\.?\d+)',
    r'([\d,]+\.?\d+)\s+as the upside resistance',
    r'([\d,]+\.?\d+)\s+for upside gamma',
    r'[Uu]pside target is\s*([\d,]+\.?\d+)[^.]{0,60}upside pivot',
    r'([\d,]+\.?\d+)\s+(?:is\s+)?the upside pivot', r'([\d,]+\.?\d+)\s+(?:the\s+)?upside pivot',
    r'([\d,]+\.?\d+)\s+as the upside (?:pivot|one)', r'call pivot[^.]{0,60}?([\d,]+\.?\d+)',
    r'bull pivot[^.]{0,60}?([\d,]+\.?\d+)',
    r'pivot zone to the upside at\s*([\d,]+\.?\d+)\s*[-–]\s*([\d,]+\.?\d+)',
    r'key pivot (?:zone\s+)?to the upside at\s*([\d,]+\.?\d+)',
    r'to the upside[^.]{0,40}?([\d,]+\.?\d+)\s+is (?:the\s+)?(?:main\s+)?pivot',
    r'break above\s*([\d,]+\.?\d+)',
    r'[Uu]pside pivot[^.]{0,80}?([\d,]+\.?\d+)', r'[Uu]pside pivot is (?:also\s+)?(?:at\s+)?([\d,]+\.?\d+)',
]
DN_PATS = [
    r'([\d,]+\.?\d+)\s*\(downside pivot\)',
    r'break through\s*([\d,]+\.?\d+)\s+to the downside',
    r'[Tt]o the downside,?\s+(?:it is\s+)?(?:the\s+)?([\d,]+\.?\d+)',
    r'([\d,]+\.?\d+),?\s+also a pivot',
    r'([\d,]+\.?\d+)[^.:]{0,30}?downside gamma',
    r'([\d,]+\.?\d+)\s+(?:is\s+)?the downside pivot',
    r'([\d,]+\.?\d+)\s+(?:the\s+)?downside pivot', r'([\d,]+\.?\d+)\s+(?:line\s+)?as (?:the\s+)?downside pivot',
    r'bear pivot[^.]{0,60}?([\d,]+\.?\d+)',
    r'[Dd]ownside pivot[^.]{0,20}?([\d,]+\.?\d+)\s*[-–]\s*([\d,]+\.?\d+)',
    r'[Dd]ownside pivot is (?:at\s+)?([\d,]+\.?\d+)', r'[Dd]ownside pivot at\s*([\d,]+\.?\d+)',
    r'([\d,]+\.?\d+)[^.]{0,40}?for downside pivot', r'to the downside[^.]{0,20}?([\d,]+\.?\d+)\s+is (?:the\s+)?pivot',
    r'[Dd]ownside pivot[^.]{0,80}?([\d,]+\.?\d+)',
]

def _id_get_level(patterns, text, lo=3000, hi=12000, exclude=None):
    text = expand_shorthand(text)
    for p in patterns:
        m = re.search(p, text, re.IGNORECASE)
        if not m: continue
        try:
            if m.lastindex >= 2:
                v1,v2 = float(m.group(1).replace(',','')), float(m.group(2).replace(',',''))
                if lo<v1<hi and lo<v2<hi:
                    mid = round((v1+v2)/2,3)
                    if exclude is None or abs(mid-exclude)>5: return mid
            v = float(m.group(m.lastindex).replace(',',''))
            if lo<v<hi and (exclude is None or abs(v-exclude)>5): return v
        except: pass
    return None

def extract_upside_pivot(text):
    return _id_get_level(UP_PATS, text)

def extract_downside_pivot(text, exclude=None):
    return _id_get_level(DN_PATS, text, exclude=exclude)

# ─────────────────────────────────────────────────────────────────────────────
# SIGMA BAND EXTRACTOR  (unchanged)
# ─────────────────────────────────────────────────────────────────────────────
def extract_sigma(text):
    results = {}
    # Modern format
    for m in re.finditer(
        r'=== (\w+) closed at ([\d.,]+)\s*===\s*'
        r'99\.73%,\s*([\d.]+),\s*,\s*([\d.]+),\s*95\.4%,\s*([\d.]+),\s*Risk level,\s*([\d.]+),'
        r'\s*68\.2%,\s*([\d.]+),\s*68\.2%,\s*([\d.]+),\s*Risk level,\s*([\d.]+),'
        r'\s*95\.4%,\s*([\d.]+),\s*,\s*([\d.]+),\s*99\.73%,\s*([\d.]+)', text):
        inst = m.group(1)
        if inst not in TARGET: continue
        close = float(m.group(2).replace(',',''))
        v = [float(m.group(i)) for i in range(3,13)]
        ctr = (v[4]+v[5])/2
        results[inst] = dict(close_prev=close, center=round(ctr,4),
                              s3_upper=v[0], s2_upper=v[2], risk_upper=v[3], s1_upper=v[4],
                              s1_lower=v[5], risk_lower=v[6], s2_lower=v[7], s3_lower=v[9],
                              s1_pct=round((v[4]-v[5])/ctr*100,4),
                              s2_pct=round((v[2]-v[7])/ctr*100,4))
    # Legacy format
    if not results:
        for m in re.finditer(
            r'\b(SPX|ES(?:=F)?|SPY|VIX|IWM|QQQ)\s*99\.73%,\s*([\d.]+),\s*,\s*([\d.]+),'
            r'\s*95\.4%,\s*([\d.]+),\s*Risk level,\s*([\d.]+),\s*68\.2%,\s*([\d.]+),'
            r'\s*68\.2%,\s*([\d.]+),\s*Risk level,\s*([\d.]+),\s*95\.4%,\s*([\d.]+),'
            r'\s*,\s*([\d.]+),\s*99\.73%,\s*([\d.]+)', text):
            inst = m.group(1).replace('=F','')
            if inst not in TARGET or inst in results: continue
            v = [float(m.group(i)) for i in range(2,12)]
            ctr = (v[4]+v[5])/2
            results[inst] = dict(close_prev=None, center=round(ctr,4),
                                  s3_upper=v[0], s2_upper=v[2], risk_upper=v[3], s1_upper=v[4],
                                  s1_lower=v[5], risk_lower=v[6], s2_lower=v[7], s3_lower=v[9],
                                  s1_pct=round((v[4]-v[5])/ctr*100,4),
                                  s2_pct=round((v[2]-v[7])/ctr*100,4))
    return results

# ─────────────────────────────────────────────────────────────────────────────
# WEEKLY EXTRACTOR  (unchanged)
# ─────────────────────────────────────────────────────────────────────────────
def _wk_get_num(patterns, text, lo=3000, hi=12000):
    for p in patterns:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            try:
                v = float(m.group(m.lastindex).replace(',',''))
                if lo < v < hi: return v
            except: pass
    return None

def _wk_get_range_mid(patterns, text, lo=3000, hi=12000):
    for p in patterns:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            try:
                v1 = float(m.group(1).replace(',',''))
                v2 = float(m.group(2).replace(',',''))
                if lo<v1<hi and lo<v2<hi and 0<abs(v1-v2)<400:
                    return round((v1+v2)/2, 3)
            except: pass
    return None

def extract_weekly(full_text):
    # ── STEP 1: SECTION SLICING ──────────────────────────────────────────
    marker = re.search(r'WEEKLY POSITIONING|WEEKLY POST', full_text)
    level_text = full_text[marker.start():] if marker else full_text

    # ── STEP 2: STRIP SENTIMENT-PIVOT BLOCK ──────────────────────────────
    sent_m = re.search(r'Sentiment-based pivots?[^.]{0,350}', level_text, re.IGNORECASE)
    range_text = level_text
    if sent_m:
        range_text = level_text[:sent_m.start()] + level_text[sent_m.end():]

    # ── CENTROID (incl. "main focus" vocabulary gap) ─────────────────────
    centroid = _wk_get_range_mid([
        r'centroid[^.]{0,80}?(?:falls? in|is in|:)\s*(?:the\s+)?([\d,]+\.?\d*)\s*[-–]\s*([\d,]+\.?\d*)',
    ], level_text)
    centroid_is_range = centroid is not None
    if not centroid:
        centroid = _wk_get_num([
            r'centroid[^.]{0,80}?(?:is at|at|falls?\s+to|of|:)\s*([\d,]+\.?\d+)',
            r'centroid\s+of\s+the[^.]{0,60}?([\d,]+\.?\d+)',
            r'with (?:a )?centroid of\s*([\d,]+\.?\d+)',
            r'main focus\s+(?:at|is|:)?\s*([\d,]+\.?\d+)',                     # NEW
            r'([\d,]+\.?\d+)[^.]{0,10}very close[^.]{0,60}?main focus',        # NEW variant
        ], level_text)

    # ── NET ZERO SPEED (kept distinct from centroid) ─────────────────────
    net_zero_speed = _wk_get_num([
        r'net[- ]zero speed[^.]{0,60}?([\d,]+\.?\d+)',
        r'net zero speed output[^.]{0,60}?([\d,]+\.?\d+)',
        r'zero speed[^.]{0,60}?([\d,]+\.?\d+)',
    ], level_text)

    # ── POSITIONAL PIVOT+TARGET PAIRS (dominant format ~Aug 2025 onward) ───
    dn_pair = re.search(
        r'[Dd]ownside pivot is (?:at\s+)?([\d,]+\.?\d+)[^.]{0,15}?'
        r'(?:Target is|with target of|target of)\s*([\d,]+\.?\d+)', level_text)
    up_pair = re.search(
        r'[Uu]pside pivot is (?:at\s+)?([\d,]+\.?\d+)[^.]{0,15}?'
        r'(?:Target is|with target of|target of)\s*([\d,]+\.?\d+)', level_text)

    # ── PIVOTS (incl. zone/range midpoint) ────────────────────────────────
    downside_pivot = float(dn_pair.group(1)) if dn_pair else None
    if not downside_pivot:
        downside_pivot = _wk_get_range_mid([
            r'[Dd]ownside pivot[^.]{0,20}?(?:is at|is|:)?\s*([\d,]+\.?\d+)\s*[-–]\s*([\d,]+\.?\d+)',
        ], level_text)
    if not downside_pivot:
        downside_pivot = _wk_get_num([
            r'[Dd]ownside pivot[^.]{0,60}?([\d,]+\.?\d+)',
            r'[Dd]ownside pivot is (?:at\s+)?([\d,]+\.?\d+)',
            r'([\d,]+\.?\d+)\s*[.\s]*This is the downside pivot',   # reversed order
            r'([\d,]+\.?\d+)\s+(?:is\s+)?(?:the\s+)?downside pivot',  # reversed order
        ], level_text)

    upside_pivot = float(up_pair.group(1)) if up_pair else None
    if not upside_pivot:
        upside_pivot = _wk_get_range_mid([
            r'[Uu]pside pivot[^.]{0,20}?(?:is at|is|:)?\s*([\d,]+\.?\d+)\s*[-–]\s*([\d,]+\.?\d+)',
        ], level_text)
    if not upside_pivot:
        upside_pivot = _wk_get_num([
            r'[Uu]pside pivot[^.]{0,60}?([\d,]+\.?\d+)',
            r'[Uu]pside pivot is (?:at\s+)?([\d,]+\.?\d+)',
            r'([\d,]+\.?\d+)\s*[.\s]*This is the upside pivot',   # reversed order
            r'([\d,]+\.?\d+)\s+(?:is\s+)?(?:the\s+)?upside pivot',  # reversed order
            r'spot should break above\s*([\d,]+\.?\d+)',           # alt phrasing
        ], level_text)

    # ── TARGETS ──────────────────────────────────────────────────────────
    downside_target = float(dn_pair.group(2)) if dn_pair else None
    if not downside_target:
        downside_target = _wk_get_num([
            r'[Dd]ownside target(?:\s*\d)?[^.]{0,20}?(?:is|:)?\s*([\d,]+\.?\d+)',
            r'primal downside target[^.]{0,60}?([\d,]+\.?\d+)',
            r'downside target that it says is\s*([\d,]+\.?\d+)',
            r'squeeze (?:down|towards|to)[^.]{0,40}?([\d,]+\.?\d+)',
        ], level_text)
    upside_target = float(up_pair.group(2)) if up_pair else None
    if not upside_target:
        upside_target = _wk_get_num([
            r'[Uu]pside target(?:\s*\d)?[^.]{0,20}?(?:is|:)?\s*([\d,]+\.?\d+)',
            r'primal upside target[^.]{0,60}?([\d,]+\.?\d+)',
            r'squeeze up towards\s*([\d,]+\.?\d+)',
            r'towards\s*([\d,]+\.?\d+)\s+gamma-wise',
        ], level_text)


    tl = level_text.lower()
    sent = None
    if re.search(r'bad news[^.]{0,40}?(?:don.t exist|doesn.t exist|not exist|are not exist)', tl): sent='extreme_complacency'
    elif re.search(r'bad news[^.]{0,30}?good news[^.]{0,60}?bad news', tl): sent='bad_good'
    elif re.search(r'bad news[^.]{0,20}?bad news|bad news are bad news|bad news is bad news', tl): sent='bad_bad'
    elif re.search(r'bad news[^.]{0,20}?good news|bad news is good news|bad news are good news', tl): sent='bad_good'

    # ── WEEKLY VOL RANGES (fixed: bidirectional instrument-number order) ──
    range_text = re.sub(r'(?<=[a-z0-9])(SPX|ES|SPY|VIX|IWM|QQQ)(?=:)', r' \1', range_text)

    weekly_ranges = {}
    # Form B FIRST: "X - Y for SPX"
    for m in re.finditer(
        r'([\d,]+\.?\d+)\s*[-–]\s*([\d,]+\.?\d+)\s+for\s+(SPX|ES(?:=F)?|SPY|VIX|IWM|QQQ)\b',
        range_text, re.IGNORECASE):
        inst = m.group(3).upper().replace('=F','')
        if inst not in TARGET or inst in weekly_ranges: continue
        try:
            hi_v = float(m.group(1).replace(',',''))
            lo_v = float(m.group(2).replace(',',''))
            if hi_v < lo_v: hi_v, lo_v = lo_v, hi_v
            if 3 < lo_v < 15000 and 3 < hi_v < 15000:
                weekly_ranges[inst] = dict(upper=hi_v, lower=lo_v, moe=None)
        except: pass

    # Form A SECOND: "SPX: X - Y"
    for m in re.finditer(
        r'\b(SPX|ES(?:=F)?|SPY|VIX|IWM|QQQ)[^:.\n]{0,10}:?\s*'
        r'([\d,]+\.?\d+)\s*[-–]\s*([\d,]+\.?\d+)(?:[;,\s]+(?:margin[^.]{0,30}?)?([\d,]+\.?\d+))?',
        range_text, re.IGNORECASE):
        inst = m.group(1).upper().replace('=F','')
        if inst not in TARGET or inst in weekly_ranges: continue
        try:
            hi_v = float(m.group(2).replace(',',''))
            lo_v = float(m.group(3).replace(',',''))
            if hi_v < lo_v: hi_v, lo_v = lo_v, hi_v
            moe = float(m.group(4).replace(',','')) if m.group(4) else None
            if 3 < lo_v < 15000 and 3 < hi_v < 15000:
                weekly_ranges[inst] = dict(upper=hi_v, lower=lo_v, moe=moe)
        except: pass

    fly = None
    if re.search(r'long fly', tl[:6000]): fly='long_fly'
    elif re.search(r'short fly', tl[:6000]): fly='short_fly'

    rev_prob = None
    m2 = re.search(r'(?:reversion model|probability)[^.]{0,60}?(\d{2,3}\.?\d*)%', level_text, re.IGNORECASE)
    if m2:
        try:
            v = float(m2.group(1))
            if 50 < v < 100: rev_prob = v
        except: pass

    vix_pin = None
    m3 = re.search(r'VIX[^.]{0,60}?(?:pin|pinned)[^.]{0,40}?([\d.]+)', level_text, re.IGNORECASE)
    if m3:
        try:
            v = float(m3.group(1))
            if 5 < v < 80: vix_pin = v
        except: pass

    return dict(
        weekly_centroid=centroid, weekly_centroid_is_range=int(bool(centroid_is_range)),
        net_zero_speed=net_zero_speed,
        weekly_downside_pivot=downside_pivot, weekly_upside_pivot=upside_pivot,
        weekly_downside_target=downside_target, weekly_upside_target=upside_target,
        reversion_prob=rev_prob,
        reversion_target=_wk_get_num([r'(?:reversion)[^.]{0,120}?(?:target|towards?)\s+(?:of\s+)?([\d,]+\.?\d+)'], level_text),
        fly_pattern=fly, sentiment_regime=sent, vix_pin=vix_pin,
        momentum_threshold=_wk_get_num([r'(?:market|SPX)[^.]{0,60}?(?:should|must|needs?)[^.]{0,60}?(?:produce|perform|achieve)[^.]{0,40}?([\d,]+\.?\d+)'], level_text),
        weekly_ranges=weekly_ranges,
        used_section_slice=marker is not None,
    )

# ─────────────────────────────────────────────────────────────────────────────
# POST PARSING (adapted from parse_post: HTML string + subject, no filesystem)
# ─────────────────────────────────────────────────────────────────────────────
def parse_post_html(raw_html, subject):
    ptype = classify_post(subject)
    date = parse_date_from_metadata(raw_html)
    text = BeautifulSoup(raw_html, 'html.parser').get_text()

    if ptype == 'weekly':
        rec = extract_weekly(text)
        wr  = rec.pop('weekly_ranges', {})
        rec.pop('used_section_slice', None)  # debug-only field, not a DB column
        rec.update(date=date, post_id=None, filename=subject)
        for inst in TARGET:
            r = wr.get(inst, {})
            rec[f'{inst}_weekly_upper'] = r.get('upper')
            rec[f'{inst}_weekly_lower'] = r.get('lower')
            rec[f'{inst}_weekly_moe']   = r.get('moe')
        return 'weekly', date, rec

    # Intraday
    centroid, cis_range, csrc = extract_centroid(text)
    up_piv = extract_upside_pivot(text)
    dn_piv = extract_downside_pivot(text, exclude=up_piv)
    up_tgt = _id_get_level([r'[Uu]pside[^.]{0,160}?target[^.]{0,80}?([\d,]+\.?\d+)'], text)
    dn_tgt = _id_get_level([r'[Dd]ownside[^.]{0,160}?target[^.]{0,80}?([\d,]+\.?\d+)',
                         r'primal target of\s+([\d,]+\.?\d+)'], text)
    zv  = extract_zero_vanna(text)
    cf  = extract_charm_flip(text)

    tl = text[:5000].lower()
    pt = None
    if re.search(r'\bic\b[^.]{0,80}?\d{4}|iron condor', tl): pt='IC'
    elif 'short fly' in tl: pt='short_fly'
    elif 'long fly' in tl:  pt='long_fly'
    elif 'risk reversal' in tl: pt='risk_reversal'
    elif 'short ratio call' in tl: pt='short_ratio_call'

    sz = text[:6000].lower()
    ns = None
    if re.search(r'(?:net\s+)?speed[^.]{0,80}?(?:flat.to.)?negative', sz): ns='negative'
    elif re.search(r'(?:net\s+)?speed[^.]{0,80}?positive', sz): ns='positive'
    m2 = re.search(r'(?:net\s+)?slope[^.]{0,20}?(-?\d+\.?\d*)%', text, re.IGNORECASE)
    nss = float(m2.group(1)) if m2 else None
    bias = 'neutral'
    bz = text[:5000].lower()
    if re.search(r'main bet[^.]{0,150}?(?:\bup\b|squeeze up|grind.*up|upside|upward)', bz): bias='bullish'
    elif re.search(r'main bet[^.]{0,150}?(?:\bdown\b|decline|lower|downside)', bz): bias='bearish'

    bands = extract_sigma(text)
    rec = dict(date=date, post_id=None, filename=subject,
               centroid=centroid, centroid_is_range=int(bool(cis_range)),
               centroid_source=csrc,
               upside_pivot=up_piv, downside_pivot=dn_piv,
               upside_target=up_tgt, downside_target=dn_tgt,
               zero_vanna=zv, charm_flip=cf,
               pattern_type=pt, net_speed=ns,
               net_speed_slope_pct=nss, directional_bias=bias)
    for inst in TARGET:
        b = bands.get(inst, {})
        for k,v in (b or {}).items():
            rec[f'{inst}_{k}'] = v

    return 'intraday', date, rec

# ─────────────────────────────────────────────────────────────────────────────
# SUPABASE UPSERT (REST API, on_conflict=date)
# ─────────────────────────────────────────────────────────────────────────────
def supabase_upsert(table, rec):
    url = os.environ.get('SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:
        raise RuntimeError('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured')
    # Drop None values except date (matches upsert_post column selection)
    row = {k: v for k, v in rec.items() if v is not None or k == 'date'}
    req = urllib.request.Request(
        f"{url}/rest/v1/{table}?on_conflict=date",
        data=json.dumps([row]).encode(),
        headers={
            'apikey': key,
            'Authorization': f'Bearer {key}',
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates',
        },
        method='POST')
    try:
        with urllib.request.urlopen(req) as r:
            if r.status not in (200, 201):
                raise RuntimeError(f'Supabase HTTP {r.status}')
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'Supabase {e.code}: {e.read().decode()[:300]}')

# ─────────────────────────────────────────────────────────────────────────────
# HTTP HANDLER (Vercel Python runtime)
# ─────────────────────────────────────────────────────────────────────────────
class handler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        secret = os.environ.get('INGEST_SECRET')
        if not secret:
            return self._send(500, {'success': False, 'error': 'INGEST_SECRET not configured'})
        if self.headers.get('X-Ingest-Secret') != secret:
            return self._send(401, {'success': False, 'error': 'Invalid or missing X-Ingest-Secret'})

        try:
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length) or b'{}')
        except Exception:
            return self._send(400, {'success': False, 'error': 'Invalid JSON body'})

        html = body.get('html')
        subject = body.get('subject', '')
        if not html:
            return self._send(400, {'success': False, 'error': 'Missing "html" in body'})

        try:
            ptype, date, rec = parse_post_html(html, subject)
        except Exception as e:
            return self._send(500, {'success': False, 'error': f'Parse failure: {e}'})

        if not date:
            return self._send(422, {'success': False, 'error':
                'No date found — post-date meta tag missing from HTML', 'type': ptype})

        missing = []
        if ptype == 'intraday':
            if rec.get('centroid') is None: missing.append('centroid')
            if rec.get('upside_pivot') is None: missing.append('upside_pivot')
            if rec.get('downside_pivot') is None: missing.append('downside_pivot')
        else:
            if rec.get('weekly_centroid') is None: missing.append('weekly_centroid')
            if rec.get('weekly_upside_pivot') is None: missing.append('weekly_upside_pivot')
            if rec.get('weekly_downside_pivot') is None: missing.append('weekly_downside_pivot')

        table = 'intraday_posts' if ptype == 'intraday' else 'weekly_posts'
        try:
            supabase_upsert(table, rec)
        except Exception as e:
            return self._send(502, {'success': False, 'error': str(e), 'type': ptype, 'date': date})

        resp = {'success': True, 'date': date, 'type': ptype}
        if ptype == 'intraday':
            resp['centroid'] = rec.get('centroid')
        else:
            resp['centroid'] = rec.get('weekly_centroid')
        if missing:
            resp['warnings'] = f"Fields not extracted: {', '.join(missing)}"
        return self._send(200, resp)
