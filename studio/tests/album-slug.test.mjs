import test from 'node:test';
import assert from 'node:assert/strict';
import {albumSlug} from '../web/album-slug.mjs';
test('Vietnamese slugs normalize accents, punctuation, empty and oversized input',()=>{
 assert.equal(albumSlug('Đám cưới Đà Lạt — Tuấn & Lan'),'dam-cuoi-da-lat-tuan-lan');
 assert.equal(albumSlug('ĐẶNG'.normalize('NFD')),'dang');
 assert.equal(albumSlug('  /Hello___WORLD? #  '),'hello-world');
 assert.equal(albumSlug('💒'),'album');assert.equal(albumSlug(''),'album');
 assert.equal(albumSlug('a'.repeat(119)+' b').length,119);
});
