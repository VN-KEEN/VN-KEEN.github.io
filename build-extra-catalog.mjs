import {writeFile} from 'node:fs/promises';
const items=[];
const rarityMap={rarity_common:['consumer',1],rarity_uncommon:['industrial',2],rarity_rare:['milspec',3],rarity_mythical:['restricted',4],rarity_legendary:['classified',5],rarity_ancient:['covert',6]};
for(const [source,category] of [['graffiti','sprays'],['crates','crates']]){
 const response=await fetch(`https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/${source}.json`);
 if(!response.ok)throw new Error('Dataset unavailable: '+source);
 const data=await response.json();
 for(const item of data){
  if(!item.image||!item.name)continue;
  const [rarity,rarityScore]=rarityMap[item.rarity?.id]||['common',1];
  items.push({id:1000000+items.length,name:item.name,category,subType:category==='sprays'?'Graffiti':item.type||'Container',weaponClass:'',rarity,rarityScore,image:item.image});
 }
}
// Names, types, rarity labels and image URLs verified at https://stash.clash.gg/pets.
for(const [name,slug,type,rarityLabel] of [
 ['Chicken Egg','chicken-egg','Egg','Chưa có độ hiếm'],
 ['Chicken Feed','chicken-feed','Feed','Chưa có độ hiếm'],
 ['Pet Chick','pet-chick','Pet','Rare'],
 ['Pet Chicken | Catalana','pet-chicken-catalana','Pet','Rare'],
 ['Pet Chicken | Silkie','pet-chicken-silkie','Pet','Rare'],
 ['Pet Chicken | Polish','pet-chicken-polish','Pet','Rare']
]) {
 items.push({id:1000000+items.length,name,category:'pet',subType:type,weaponClass:'',rarity:type==='Pet'?'milspec':'consumer',rarityScore:type==='Pet'?3:1,rarityLabel,image:'https://img.clash.gg/stash/pets-'+slug,source:'https://stash.clash.gg/pets'});
}
await writeFile('catalog_extra.js','// Sources: ByMykel/CSGO-API (Sprays, Crates); stash.clash.gg/pets (Pets).\nwindow.CS2_SKIN_CATALOG.push(...'+JSON.stringify(items)+');\n');
console.log(JSON.stringify(Object.fromEntries(['sprays','crates','pet'].map(c=>[c,items.filter(i=>i.category===c).length]))));
