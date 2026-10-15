import test from 'node:test';
import assert from 'node:assert/strict';
import {adminVisiblePhotos,selectedFileNames} from '../web/admin-proofing.mjs';

const album={sections:[{id:'ceremony'},{id:'party'}],photos:[
 {id:'b',section_id:'party',position:0,original:'CC-0002.JPG',caption:'Đón dâu',selected:true},
 {id:'a',section_id:'ceremony',position:1,original:'CC-0001.JPG',caption:'Lễ cưới',selected:true},
 {id:'c',section_id:'ceremony',position:2,original:'CC-0003.JPG',caption:'Đón dâu',selected:false},
 {id:'d',section_id:null,position:0,original:'CC-0004.JPG',selected:true}
]};

test('Studio search combines filename or accent-insensitive caption with section and customer picks',()=>{
 assert.deepEqual(adminVisiblePhotos(album,'all','DON DAU',true).map(p=>p.id),['b']);
 assert.deepEqual(adminVisiblePhotos(album,'ceremony','don dau').map(p=>p.id),['c']);
 assert.deepEqual(adminVisiblePhotos(album,'all','cc-0001.jpg',true).map(p=>p.id),['a']);
 assert.deepEqual(adminVisiblePhotos(album,'unassigned','',true).map(p=>p.id),['d']);
 assert.deepEqual(adminVisiblePhotos(album,'ceremony','missing'),[]);
});

test('Filename export includes every selected original in section order independently of current search',()=>{
 adminVisiblePhotos(album,'ceremony','missing',true);
 assert.equal(selectedFileNames(album),'CC-0001.JPG\nCC-0002.JPG\nCC-0004.JPG');
 assert.equal(selectedFileNames({...album,photos:[]}), '');
 assert.equal(album.photos[0].id,'b');
});
