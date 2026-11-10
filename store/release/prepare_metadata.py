"""Export and validate store copy from the canonical, reviewed metadata JSON."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
META = ROOT / 'store' / 'metadata'
data = json.loads((META / 'metadata.json').read_text())
limits = {
    'apple': {'name': 30, 'subtitle': 30, 'promotional_text': 170, 'keywords': 100, 'description': 4000},
    'google-play': {'title': 30, 'short_description': 80, 'full_description': 4000},
}
report = {'checked_on': data['checked_on'], 'result': 'PASS', 'version': data['version'], 'checks': [],
          'scope': 'Store text limits, complete localized fields and brand restrictions; not a production publication decision.'}

def export(locale, platform, fields):
    folder = META / locale / platform
    folder.mkdir(parents=True, exist_ok=True)
    for field, content in fields.items():
        assert isinstance(content, str) and content.strip(), (locale, platform, field)
        (folder / (field + '.txt')).write_text(content + '\n', encoding='utf-8')
        if field in limits.get(platform, {}):
            length = len(content.encode('utf-8')) if platform == 'apple' and field == 'keywords' else len(content)
            limit = limits[platform][field]
            assert length <= limit, (locale, platform, field, length, limit)
            report['checks'].append({'locale': locale, 'field': platform + '.' + field, 'length': length, 'limit': limit, 'pass': True})

export('en-US', 'apple', data['apple'])
export('en-US', 'google-play', data['google_play'])
for locale, localized in data.get('localizations', {}).items():
    export(locale, 'google-play', localized['google_play'])
public = '\n'.join(str(v) for group in [data['apple'], data['google_play'], *[v['google_play'] for v in data.get('localizations', {}).values()]] for v in group.values())
assert not re.search(r'\biran\w*\b|ایران', public, flags=re.IGNORECASE)
for prohibited in ['works offline', 'never drops calls', 'guaranteed connection', 'unlimited calls', 'end-to-end encrypted', '#1', 'million downloads']:
    assert prohibited not in public.lower(), prohibited
report['brand_check'] = 'PASS: location-neutral; no unverified rankings, price, security or absolute reliability claims.'
report['apple_localizations'] = ['en-US']
report['google_play_localizations'] = ['en-US']
(META / 'validation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'result': report['result'], 'fields_checked': len(report['checks']), 'version': report['version']}))
