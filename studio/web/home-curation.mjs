import {parseSelection} from './hero-slides.mjs';
// Visually selected from the current public portfolio. IDs survive album reordering.
const heroChoice = {"albumId":"4c5afcfeff9518b24e9da470aeb58fd8","photoId":"62e964452f59aa8b30058e3530c0d94b"};
export const defaultStorySelection = [
  {
    "albumId": "f5364d170eb33dd7663dd3a83728e192",
    "photoId": "a2ec80f221c1256c0f062f6d34ad8ed6"
  },
  {
    "albumId": "91d8e5f65a0ea8c06a876b6702195f26",
    "photoId": "9040199edb35c437104cc9a221e6a807"
  },
  {
    "albumId": "d9e805527691bae6b4ce8cf6357fb907",
    "photoId": "25feeff5ad27925d7d95cc73babca647"
  },
  {
    "albumId": "c64c0ff5b22f7ca2af5c6b6918e0cfee",
    "photoId": "8248b2f78cb7932b9f42c166274ab2af"
  },
  {
    "albumId": "fe7dac533ee8f0f6be2f276e2fcae9bd",
    "photoId": "0b83ffea4267c94fdbb81484d8e3d516"
  },
  {
    "albumId": "f80819d221858f1f3093537114d08320",
    "photoId": "7ea1b1331d65c18a196850926fa3e1e5"
  }
];

export function curateHome(albums,config='') {
 const choices=parseSelection(config,defaultStorySelection);
 const available = albums.filter(a => a.photos.length);
 const heroAlbum = available.find(a => a.id === heroChoice.albumId) || available[0];
 const heroPhoto = heroAlbum?.photos.find(p => p.id === heroChoice.photoId) || heroAlbum?.photos.find(p => p.id === heroAlbum.cover_id) || heroAlbum?.photos[0];
 const ordered = [...choices.map(choice => available.find(a => a.id === choice.albumId)), ...available];
 const used = new Set(!config&&heroAlbum ? [heroAlbum.id] : []);
 const stories = [];
 for (const album of ordered) {
  if (!album || used.has(album.id)) continue;
  used.add(album.id);
  const choice = choices.find(c => c.albumId === album.id);
  const photo = album.photos.find(p => p.id === choice?.photoId) || album.photos.find(p => p.id === album.cover_id) || album.photos[0];
  stories.push({album, photo});
  if (stories.length === 6) break;
 }
 return {heroAlbum, heroPhoto, stories};
}

// Share the selection with the portfolio and next-story navigation.
export function curatePortfolio(albums,config='') {
 const choices = [...parseSelection(config,defaultStorySelection), heroChoice];
 const ordered = [...choices.map(choice => albums.find(a => a.id === choice.albumId)), ...albums];
 const used = new Set();
 return ordered.filter(album => {
  if (!album || used.has(album.id)) return false;
  used.add(album.id);
  return true;
 }).map(album => {
  const choice = choices.find(c => c.albumId === album.id);
  const photo = album.photos.find(p => p.id === choice?.photoId) || album.photos.find(p => p.id === album.cover_id) || album.photos[0];
  return {album, photo};
 });
}

export function nextStories(albums, currentId,config='') {
 const stories = curatePortfolio(albums,config).filter(story => story.photo);
 const index = stories.findIndex(story => story.album.id === currentId);
 return [...stories.slice(index + 1), ...stories.slice(0, Math.max(0, index))]
  .filter(story => story.album.id !== currentId).slice(0, 2);
}
