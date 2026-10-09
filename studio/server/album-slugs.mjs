import {albumSlug} from '../web/album-slug.mjs';

// Reserve the entire URL history atomically, including concurrent requests.
// No foreign key: creation reserves the URL before inserting the album.
export async function reserveAlbumSlug(db,value,albumId){
 const base=albumSlug(value);
 for(let n=1;;n++){
  const suffix=n===1?'':'-'+n;
  const slug=base.slice(0,120-suffix.length).replace(/-+$/g,'')+suffix;
  // Hash-shaped URLs are reserved for legacy album IDs, including future IDs.
  if(/^[a-f0-9]{32}$/.test(slug)||await db.get('SELECT id FROM albums WHERE id=?',[slug]))continue;
  if(await db.get('SELECT id FROM albums WHERE slug=? AND id<>?',[slug,albumId]))continue;
  const row=await db.get('INSERT INTO album_slugs(slug,album_id) VALUES(?,?) ON CONFLICT(slug) DO UPDATE SET album_id=excluded.album_id WHERE album_slugs.album_id=excluded.album_id RETURNING slug',[slug,albumId]);
  if(row)return slug;
 }
}
export async function migrateAlbumSlugs(db){
 if(db.cloud)await db.exec('ALTER TABLE albums ADD COLUMN IF NOT EXISTS slug TEXT;');
 else if(!(await db.all('PRAGMA table_info(albums)')).some(c=>c.name==='slug'))await db.exec('ALTER TABLE albums ADD COLUMN slug TEXT;');
 await db.exec('CREATE TABLE IF NOT EXISTS album_slugs(slug TEXT PRIMARY KEY,album_id TEXT NOT NULL);');
 if(db.cloud)await db.exec('ALTER TABLE album_slugs ENABLE ROW LEVEL SECURITY;');
 await db.exec("INSERT INTO album_slugs(slug,album_id) SELECT slug,id FROM albums WHERE slug IS NOT NULL AND slug<>'' ON CONFLICT(slug) DO NOTHING;");
 for(const a of await db.all("SELECT id,title FROM albums WHERE slug IS NULL OR slug='' ORDER BY created,id")){
  const slug=await reserveAlbumSlug(db,a.title,a.id);
  await db.run("UPDATE albums SET slug=? WHERE id=? AND (slug IS NULL OR slug='')",[slug,a.id]);
 }
 await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS album_slug ON albums(slug);');
}
export async function findAlbum(db,key){
 return await db.get('SELECT * FROM albums WHERE id=?',[key])||await db.get('SELECT * FROM albums WHERE slug=?',[key])||await db.get('SELECT albums.* FROM albums JOIN album_slugs ON albums.id=album_slugs.album_id WHERE album_slugs.slug=?',[key]);
}
