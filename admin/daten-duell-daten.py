# Baut daten-duell/daten.json aus OWID-CSVs (CC BY 4.0) + Flächen aus wahre-groesse/laender.json.
# Aufruf: python3 -I duell_daten.py <owid-dir> <geo-dir> <laender.json> <ausgabe.json>
import csv, json, sys, os
owid, geo, laender_p, out = sys.argv[1:5]
codes = json.load(open(os.path.join(geo, 'codes.json')))
a3a2 = {c[1]: c[0] for c in codes}
laender = json.load(open(laender_p, encoding='utf-8'))
name = {l['a']: l['n'] for l in laender if l['a']}
flaeche = {l['a']: l['km'] for l in laender if l['a']}

KENN = [
  # id, datei, spalte, frage, einheit, nachkommastellen
  ('einwohner', 'population', 'Population', 'mehr Einwohner', 'Einwohner', 0),
  ('lebenserwartung', 'life-expectancy', 'Life expectancy', 'die höhere Lebenserwartung', 'Jahre', 1),
  ('co2', 'co-emissions-per-capita', 'CO₂ emissions per capita', 'mehr CO₂-Ausstoss pro Kopf', 't CO₂ pro Person und Jahr', 1),
  ('kinder', 'children-per-woman-un', 'Fertility rate', 'mehr Kinder pro Frau', 'Kinder pro Frau', 1),
  ('internet', 'share-of-individuals-using-the-internet', 'Share of the population using the Internet', 'den grösseren Anteil Internetnutzer', '% der Bevölkerung', 0),
  ('wald', 'forest-area-as-share-of-land-area', 'Share of land covered by forest', 'mehr Wald (Anteil der Landfläche)', '% der Landfläche', 0),
  ('fleisch', 'meat-supply-per-person', 'Per capita consumption of meat', 'mehr Fleischkonsum pro Person', 'kg pro Person und Jahr', 0),
  ('bip', 'gdp-per-capita-worldbank', 'GDP per capita', 'das höhere Einkommen (BIP pro Kopf)', 'internationale $ pro Person', 0),
  ('median', 'median-age', 'Median age', 'die ältere Bevölkerung (Medianalter)', 'Jahre (Medianalter)', 1),
  ('stadt', 'share-of-population-urban', 'Urban', 'mehr Stadtbevölkerung (Anteil)', '% in Städten', 0),
]
daten = {}
jahre = {}
for kid, datei, spalte, frage, einheit, nk in KENN:
    best = {}
    with open(os.path.join(owid, datei + '.csv'), encoding='utf-8') as f:
        for row in csv.DictReader(f):
            a3 = row.get('Code') or ''
            if len(a3) != 3 or a3 not in a3a2: continue
            try: y = int(row['Year']); v = float(row[spalte])
            except (ValueError, KeyError, TypeError): continue
            if y > 2025: continue
            if a3 not in best or y > best[a3][0]: best[a3] = (y, v)
    for a3, (y, v) in best.items():
        a2 = a3a2[a3]
        if a2 not in name: continue
        daten.setdefault(a2, {})[kid] = round(v, nk) if nk else round(v)
        jahre.setdefault(kid, {}).setdefault(y, 0)
        jahre[kid][y] += 1
for a2, km in flaeche.items():
    if a2 in daten: daten[a2]['flaeche'] = km
kenn = [{'id': 'flaeche', 'frage': 'die grössere Fläche', 'einheit': 'km²', 'nk': 0, 'jahr': None}]
for kid, datei, spalte, frage, einheit, nk in KENN:
    j = max(jahre[kid].items(), key=lambda kv: kv[1])[0]
    kenn.append({'id': kid, 'frage': frage, 'einheit': einheit, 'nk': nk, 'jahr': j, 'owid': datei})
res = {
  'quelle': 'Our World in Data (CC BY 4.0), Fläche: Natural Earth', 'stand': '2026-11-22',
  'kennzahlen': kenn,
  'laender': {a2: {'n': name[a2], 'w': w} for a2, w in sorted(daten.items()) if len(w) >= 6},
}
json.dump(res, open(out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(len(res['laender']), 'Länder', os.path.getsize(out), 'Bytes')
print({k['id']: k['jahr'] for k in kenn})
print(res['laender']['CH'])
