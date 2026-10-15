import test from 'node:test';
import assert from 'node:assert/strict';
import {clientMasonryLayout} from '../web/album-layout.mjs';

test('Masonry handles empty and small selections without unused columns',()=>{
 assert.deepEqual(clientMasonryLayout([],900),{items:[],columns:1,height:0});
 const single=clientMasonryLayout([{width:3000,height:2000}],560);
 assert.equal(single.columns,1);assert.equal(single.items[0].width,560);
 assert.equal(single.height,374);
 assert.equal(clientMasonryLayout([{width:300,height:200},{width:200,height:300}],860).columns,2);
});
test('900 mixed photos reserve image space, without overlap or changed reading order',()=>{
 const photos=Array.from({length:916},(_,i)=>({width:i%3?3000:2000,height:i%3?2000:3000}));
 for(const [width,columns,gap] of [[1120,3,16],[342,2,8]]){
  const {items,height}=clientMasonryLayout(photos,width,columns,gap);
  assert.equal(items.length,photos.length);
  for(let i=0;i<items.length;i++){
   const card=items[i];
   assert.ok(card.left>=0&&card.left+card.width<=width+.01);
   assert.ok(card.height>=card.width*photos[i].height/photos[i].width);
   assert.ok(card.top+card.height<=height);
   if(i)assert.ok(card.top>=items[i-1].top,'Visual rows follow original photo order');
   const previous=items.slice(0,i).findLast(other=>other.left===card.left);
   if(previous)assert.ok(card.top>=previous.top+previous.height+gap,'Cards never overlap');
  }
  const bottoms=Array.from({length:columns},(_,column)=>items.filter(card=>Math.abs(card.left-column*(items[0].width+gap))<.01).at(-1)).map(card=>card.top+card.height);
  assert.ok(Math.max(...bottoms)-Math.min(...bottoms)<=Math.max(...items.map(card=>card.height))+gap);
 }
});
test('Missing or invalid dimensions use a finite landscape placeholder',()=>{
 const photos=[{}, {width:0,height:0},{width:-1,height:4},{width:Infinity,height:4}];
 const result=clientMasonryLayout(photos,320,2,8);
 assert.ok(Number.isFinite(result.height));
 for(const item of result.items)assert.equal(item.height,104);
});
