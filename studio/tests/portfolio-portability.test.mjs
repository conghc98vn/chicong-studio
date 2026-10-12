import test from 'node:test';
import assert from 'node:assert/strict';
import {albumEditorial,photoDescription} from '../web/album-editorial.mjs';
import {curateHome,curatePortfolio,nextStories} from '../web/home-curation.mjs';

test('Imported album wording survives new IDs while custom descriptions take precedence',()=>{
 const album={id:'imported-again',slug:'ceremony-t-t',description:'Ceremony | T & T. Photographed for Helios Bridal.'};
 assert.equal(albumEditorial(album)?.summary,'Lễ đính hôn · Một nụ hôn trên trán');
 assert.equal(albumEditorial({...album,description:'Câu chuyện riêng của hai bạn.'}),null);
 assert.equal(albumEditorial({...album,slug:'another-album'}),null);
});

test('Verified photo descriptions survive imports without replacing custom captions',()=>{
 const photo={id:'imported-again',caption:'Ceremony | T & T · 041',width:1366,height:2048};
 assert.equal(photoDescription(photo),'Chú rể hôn lên trán cô dâu mặc áo dài trắng trong lễ đính hôn');
 assert.equal(photoDescription({...photo,caption:'Lời chúc của gia đình'}),'Lời chúc của gia đình');
 assert.equal(photoDescription({...photo,width:2048}),photo.caption);
});

test('Custom captions also take precedence for the original imported photo IDs', () => {
 const photo = {
  id: '4e4b43d65bfd6c5e82dd68255c92229c',
  caption: 'Lời chúc mới của gia đình',
  width: 1366,
  height: 2048
 };
 assert.equal(photoDescription(photo), photo.caption);
 assert.equal(photoDescription({...photo, caption: ''}), '');
});

test('Home, portfolio and next stories use the configured hero after album IDs change',()=>{
 const hero={id:'new-hero',photos:[{id:'cover'},{id:'wide'},{id:'tall'}],cover_id:'cover'};
 const story={id:'new-story',photos:[{id:'story-photo'}],cover_id:'story-photo'};
 const albums=[hero,story];
 const heroConfig=JSON.stringify([{albumId:hero.id,wideId:'wide',tallId:'tall'}]);
 const storyConfig=JSON.stringify([{albumId:story.id,photoId:'story-photo'}]);
 const home=curateHome(albums,storyConfig,heroConfig);
 assert.equal(home.heroAlbum.id,hero.id);
 assert.equal(home.heroPhoto.id,'tall');
 const selections = curatePortfolio(albums,storyConfig,heroConfig).map(x => [x.album.id,x.photo.id]);
 assert.deepEqual(selections, [['new-story','story-photo'],['new-hero','tall']]);
 assert.equal(nextStories(albums,story.id,storyConfig,heroConfig)[0].photo.id,'tall');
 assert.equal(curatePortfolio(albums,storyConfig,'[]')[1].photo.id,'cover');
});
