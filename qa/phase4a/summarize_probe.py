"""Print a compact summary of qa/phase2/probe.mjs results.json (title, KPIs, chips, layout, network)."""
import json
import sys

sys.stdout.reconfigure(encoding="utf-8")

R = json.load(open(sys.argv[1], encoding='utf-8'))
for name, r in R.items():
    print('==', name, r['search'][:160])
    print('   title:', r['title'], '| captions:', r['captions'])
    kpis = r['kpis'][0] if r['kpis'] else []
    print('   kpis:', [(k['label'], k['value'], k['sub']) for k in kpis])
    print('   chips:', [c['text'] for c in r['chips']], '| overflow', r['overflow'],
          '| small', [(s['name'][:20], s['w'], s['h']) for s in r['small']][:4])
    print('   source line:', (r['source'] or '')[:160])
    print('   requests', r['requests'], 'console', r['console'][:2])
    if r.get('table'):
        print('   table head:', r['table']['head'])
