import json,re
from pathlib import Path
root=Path(__file__).resolve().parents[1];src=root/'.work/progression'
src.mkdir(parents=True,exist_ok=True)
from urllib.request import urlopen
source_files=['include/constants/flags.h','include/constants/opponents.h','src/data/region_map/region_map_sections.json','src/data/region_map/region_map_layout.h','data/maps/map_groups.json']
for path in source_files:
 target=src/path.replace('/','_')
 if not target.exists():
  with urlopen('https://raw.githubusercontent.com/pret/pokeemerald/master/'+path,timeout=30) as response:target.write_bytes(response.read())
flags=(src/'include_constants_flags.h').read_text();trainers=(src/'include_constants_opponents.h').read_text()
def flag(name):
 if name.startswith('FLAG_BADGE'):return 0x866+int(name[10:12])
 if name=='FLAG_SYS_GAME_CLEAR':return 0x864
 if name=='FLAG_SYS_POKEMON_GET':return 0x860
 return int(re.search(r'^#define '+name+r'\s+(0x[0-9A-Fa-f]+|\d+)',flags,re.M)[1],0)
def trainer(name):return 0x500+int(re.search(r'^#define TRAINER_'+name+r'\s+(\d+)',trainers,re.M)[1])
objectives=[]
def add(id,label,kind,section,ids):objectives.append(dict(id=id,label=label,kind=kind,section='MAPSEC_'+section,flags=ids))
def story(id,label,section,f):add(id,label,'story',section,[flag(f)])
story('starter','Premier Pokémon reçu','LITTLEROOT_TOWN','FLAG_SYS_POKEMON_GET')
story('rival103','Rival • Route 103','ROUTE_103','FLAG_DEFEATED_RIVAL_ROUTE103')
add('woods','Sbire Aqua • Bois Clémenti','story','PETALBURG_WOODS',[trainer('GRUNT_PETALBURG_WOODS')])
badges=[('Roche • Roxanne','RUSTBORO_CITY'),('Poing • Bastien','DEWFORD_TOWN'),('Dynamo • Voltère','MAUVILLE_CITY'),('Chaleur • Adriane','LAVARIDGE_TOWN'),('Balancier • Norman','PETALBURG_CITY'),('Plume • Alizée','FORTREE_CITY'),('Esprit • Lévy et Tatia','MOSSDEEP_CITY'),('Pluie • Juan','SOOTOPOLIS_CITY')]
for i,(label,section) in enumerate(badges,1):add('badge'+str(i),'Badge '+label,'badge',section,[0x866+i])
for args in [('goods','Marchandises Devon récupérées','RUSTURF_TUNNEL','FLAG_RECOVERED_DEVON_GOODS'),('letter','Lettre remise à Pierre','GRANITE_CAVE','FLAG_DELIVERED_STEVEN_LETTER'),('museum','Musée • marchandises livrées','SLATEPORT_CITY','FLAG_DELIVERED_DEVON_GOODS'),('wally','Timmy • Lavandia','MAUVILLE_CITY','FLAG_DEFEATED_WALLY_MAUVILLE'),('chimney','Max • Mont Chimnée','MT_CHIMNEY','FLAG_DEFEATED_EVIL_TEAM_MT_CHIMNEY'),('scope','Devon Scope reçu','ROUTE_120','FLAG_RECEIVED_DEVON_SCOPE'),('magma','Repaire Magma • Groudon éveillé','MAGMA_HIDEOUT','FLAG_GROUDON_AWAKENED_MAGMA_HIDEOUT'),('aqua','Repaire Aqua terminé','AQUA_HIDEOUT','FLAG_TEAM_AQUA_ESCAPED_IN_SUBMARINE'),('space','Centre spatial • Team Magma vaincue','MOSSDEEP_CITY','FLAG_DEFEATED_MAGMA_SPACE_CENTER'),('cavern','Caverne Fondmer • Kyogre libéré','SEAFLOOR_CAVERN','FLAG_KYOGRE_ESCAPED_SEAFLOOR_CAVERN'),('rayquaza','Crise apaisée • Cascade reçue','SOOTOPOLIS_CITY','FLAG_RECEIVED_HM_WATERFALL'),('wallyroad','Timmy • Route Victoire','VICTORY_ROAD','FLAG_DEFEATED_WALLY_VICTORY_ROAD')]:story(*args)
for route in (110,119):add('rival'+str(route),'Rival • Route '+str(route),'story','ROUTE_'+str(route),[trainer(f'{who}_ROUTE_{route}_{starter}') for who in ('MAY','BRENDAN') for starter in ('MUDKIP','TREECKO','TORCHIC')])
add('weather','Sarah • Centre Météo','story','ROUTE_119',[trainer('SHELLY_WEATHER_INSTITUTE')])
for id,label in [('SIDNEY','Damien'),('PHOEBE','Spectra'),('GLACIA','Glacia'),('DRAKE','Aragon')]:add(id.lower(),label+' • Conseil 4','league','EVER_GRANDE_CITY',[flag('FLAG_DEFEATED_ELITE_4_'+id),flag('FLAG_SYS_GAME_CLEAR')])
add('champion','Marc • Panthéon','champion','EVER_GRANDE_CITY',[flag('FLAG_SYS_GAME_CLEAR')])
order=['starter','rival103','woods','badge1','goods','badge2','letter','museum','rival110','wally','badge3','chimney','badge4','badge5','weather','rival119','scope','badge6','magma','aqua','badge7','space','cavern','rayquaza','badge8','wallyroad','sidney','phoebe','glacia','drake','champion']
objectives.sort(key=lambda o:order.index(o['id']))
sections=json.loads((src/'src_data_region_map_region_map_sections.json').read_text())['map_sections'];groups=json.loads((src/'data_maps_map_groups.json').read_text());names=json.loads((root/'emulator/profiles/game-data.json').read_text())['maps']['fr']
norm=lambda s:re.sub('[^a-z0-9]','',s.lower())
lookup={norm(s['id'][7:]):s for s in sections if s.get('width',0)>0 and s.get('height',0)>0}
locations={}
for gi,group in enumerate(groups['group_order']):
 for mi,name in enumerate(groups[group]):
  key=norm(name.split('_')[0]);exact=lookup.get(norm(name));section=exact or lookup.get(key)
  if not section and name.startswith('Underwater_Route'):section=lookup.get(norm(name.replace('Underwater_Route','UNDERWATER_')))
  if section:locations[f'{gi}:{mi}']=section['id']
for mi,name in enumerate(groups[groups['group_order'][0]][:50]):
 section=lookup[norm(name)];section['label']=names[f'0:{mi}'];section['kind']='town' if mi<16 else ('water' if int(name[5:]) in [105,106,107,108,109,122,*range(124,135)] else 'route')
layout=[re.findall(r'MAPSEC_\w+',row) for row in (src/'src_data_region_map_region_map_layout.h').read_text().splitlines() if '{MAPSEC_' in row]
result=dict(version=1,flagsOffset=0x1270,objectives=objectives,sections=[s for s in sections if s.get('width',0)>0 and s.get('height',0)>0],layout=layout,locations=locations,sources=['https://bulbapedia.bulbagarden.net/wiki/Walkthrough:Pok%C3%A9mon_Emerald','https://www.pokepedia.fr/Pok%C3%A9mon_Version_%C3%89meraude','https://github.com/pret/pokeemerald'])
(root/'emulator/profiles/progression.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
(root/'packages/shared/src/progression-data.ts').write_text('// Generated from pokeemerald flags, region map and map groups. See docs/progressions.md.\nexport const progressionData='+json.dumps(result,ensure_ascii=False)+';\n')
print(len(objectives),'objectifs;',len(locations),'cartes localisées;',len(layout),'lignes géographiques')

