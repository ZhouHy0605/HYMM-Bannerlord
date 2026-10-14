"""Export native clothing IDs and compatibility, not game meshes/textures.
Usage: python tools/export-armory.py <Bannerlord installation>
"""
import sys, json, re, hashlib
from pathlib import Path
import xml.etree.ElementTree as ET

root = Path(sys.argv[1]) / 'Modules/Native/ModuleData'
out = Path(__file__).resolve().parents[1] / 'public/armory-catalog.json'
strings = {}
for f in (root / 'Languages/CNs').glob('*.xml'):
    for s in ET.parse(f).iter('string'):
        strings[s.get('id')] = s.get('text', '')
def name(s):
    match = re.match(r'\{=([^}]+)\}(.*)', s or '')
    return strings.get(match[1], match[2]) if match else s
items = {x.get('id'): x for x in ET.parse(root/'mpitems.xml').getroot()}
chars = {x.get('id'): x for x in ET.parse(root/'mpcharacters.xml').getroot()}
cosmetics = list(ET.parse(root/'mpcosmetics.xml').getroot())
slot_types = {'HeadArmor':'Head', 'BodyArmor':'Body', 'LegArmor':'Leg', 'HandArmor':'Gloves', 'Cape':'Cape'}
cultures = [{'id':i,'name':n} for i,n in [('empire','帝国'),('vlandia','瓦兰迪亚'),('sturgia','斯特吉亚'),('battania','巴旦尼亚'),('aserai','阿塞莱'),('khuzait','库赛特')]]
catalog_items = {}
for c in cosmetics:
    item = items.get(c.get('id'))
    if c.get('type') != 'Clothing' or item is None or item.get('Type') not in slot_types: continue
    catalog_items[c.get('id')] = dict(id=c.get('id'), name=name(item.get('name')), slot=slot_types[item.get('Type')], replaces=[x.get('id') for x in c.findall('Replace/Item')], itemless=[dict(classId=x.get('troop'),slot=x.get('slot')) for x in c.findall('Replace/Itemless')])
classes = []
for c in ET.parse(root/'mpclassdivisions.xml').getroot():
    if c.tag != 'MPClassDivision': continue
    hero = chars[c.get('hero')]
    culture = hero.get('culture','').removeprefix('Culture.')
    if culture not in {x['id'] for x in cultures}: continue
    base = {x.get('slot'):x.get('id').removeprefix('Item.') for x in hero.findall('.//equipment') if x.get('slot') in slot_types.values()}
    possible = set(base.values())
    # Only equipment alternatives usable by the player in Skirmish (not captain troops).
    for p in c.findall('Perks/Perk'):
        if p.get('game_mode') not in ('all','skirmish'): continue
        for x in p.findall('OnSpawnEffect'):
            if x.get('type') == 'AlternativeEquipmentOnSpawn' and x.get('target') == 'Player' and x.get('slot') in slot_types.values():
                possible.add(x.get('item'))
    allowed = [i for i,x in catalog_items.items() if possible.intersection(x['replaces']) or any(t['classId']==c.get('id') for t in x['itemless'])]
    classes.append(dict(id=c.get('id'), name=name(hero.get('name')), culture=culture, group=hero.get('default_group'), items=allowed, defaults={s:name(items[i].get('name')) for s,i in base.items() if i in items}))
assert len(classes) >= 40 and len({c['culture'] for c in classes})==6
used = {i for c in classes for i in c['items']}
data = dict(version=1, sourceHash=hashlib.sha256(b''.join((root/f).read_bytes() for f in ['mpcosmetics.xml','mpclassdivisions.xml','mpcharacters.xml','mpitems.xml'])).hexdigest(), cultures=cultures, slots=[dict(id=i,name=n) for i,n in [('Head','头部'),('Body','上身'),('Cape','肩部'),('Gloves','手部'),('Leg','腿部')]], classes=classes, items=[x for i,x in catalog_items.items() if i in used])
out.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(dict(classes=len(classes),items=len(used),byCulture={c['id']:sum(x['culture']==c['id'] for x in classes) for c in cultures}),ensure_ascii=False))
