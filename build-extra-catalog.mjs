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
for(const [name,x,y] of [['Chicken Egg',554,314],['Chicken Chick',876,314],['Chicken Catalana',554,575],['Chicken Silkie',876,575]]) {
 items.push({id:1000000+items.length,name,category:'pet',subType:'Pet',weaponClass:'',rarity:'restricted',rarityScore:4,image:'images/features/pet.png',petCrop:[x,y,289,214]});
}
await writeFile('catalog_extra.js','// Source: ByMykel/CSGO-API; Pet overview supplied by site owner.\nwindow.CS2_SKIN_CATALOG.push(...'+JSON.stringify(items)+');\n');
console.log(JSON.stringify(Object.fromEntries(['sprays','crates','pet'].map(c=>[c,items.filter(i=>i.category===c).length]))));
