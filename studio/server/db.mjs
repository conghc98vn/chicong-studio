import {migrateAlbumSlugs} from './album-slugs.mjs';
import {migrateDriveSchema} from './drive-schema.mjs';
import {migrateFeedbackSchema} from './feedback-schema.mjs';
import {migrateInquiryNotificationSchema} from './inquiry-notification-schema.mjs';
import {siteDefaults} from '../web/site-copy.mjs';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import pg from 'pg';
export const id=()=>randomBytes(16).toString('hex');
export function hashPassword(value){const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(value,salt,64).toString('hex');}
export function verifyPassword(value,stored){try{const [salt,key]=stored.split(':');const actual=scryptSync(value,salt,64);const expected=Buffer.from(key,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected);}catch{return false;}}
// Callers select the database explicitly. A local fixture must never inherit
// a production URL merely because it was exported in the parent terminal.
export async function openDatabase(dir,{url=null,initialize=true}={}){
 let db;
 if(url){
  const pool=new pg.Pool({connectionString:url,max:3,connectionTimeoutMillis:15000});
  // pg removes failed idle clients, but its unhandled pool error would otherwise
  // terminate the web/worker process. Never log credentials or raw server text.
  pool.on('error',error=>console.error('Database idle connection failed:',/^[A-Z0-9]{5}$/.test(error?.code||'')?error.code:'CONNECTION_ERROR'));
  const connection=client=>{const query=(sql,p=[])=>{let i=0;return client.query(sql.replace(/\?/g,()=>'$'+(++i)),p);};return {all:async(s,p)=>(await query(s,p)).rows,get:async(s,p)=>(await query(s,p)).rows[0],run:async(s,p)=>({changes:(await query(s,p)).rowCount}),exec:s=>client.query(s),cloud:true};};
  db={...connection(pool),close:()=>pool.end(),transaction:async fn=>{
   const client = await pool.connect();
   let connectionError;
   // A checked-out client no longer has the pool's idle error listener. Keep
   // the connection owned until the callback settles, even if it awaits I/O.
   const onError = error => { connectionError ??= error; };
   client.on('error', onError);
   try {
    await client.query('BEGIN');
    const result = await fn(connection(client));
    if (connectionError) throw connectionError;
    await client.query('COMMIT');
    return result;
   } catch (error) {
    try {
     await client.query('ROLLBACK');
    } catch (rollbackError) {
     connectionError ??= rollbackError;
    }
    // A broken connection can also reject ROLLBACK. Preserve the original
    // failure, discard that client, and never retry an uncertain write here.
    throw error;
   } finally {
    client.release(connectionError);
    client.removeListener('error', onError);
   }
  }};
 }
 else{
  mkdirSync(dir,{recursive:true});const raw=new DatabaseSync(path.join(dir,'studio.sqlite'));raw.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  const direct={all:async(s,p=[])=>raw.prepare(s).all(...p),get:async(s,p=[])=>raw.prepare(s).get(...p),run:async(s,p=[])=>raw.prepare(s).run(...p),exec:async s=>raw.exec(s),cloud:false};
  // Do not let unrelated requests enter the same SQLite connection during a transaction.
  let tail=Promise.resolve();const enqueue=fn=>{const result=tail.then(fn);tail=result.catch(()=>{});return result;};
  db={...direct,...Object.fromEntries(['all','get','run','exec'].map(key=>[key,(...args)=>enqueue(()=>direct[key](...args))])),close:()=>enqueue(()=>raw.close()),transaction:fn=>enqueue(async()=>{
   raw.exec('BEGIN IMMEDIATE');try{const result=await fn(direct);raw.exec('COMMIT');return result;}catch(error){raw.exec('ROLLBACK');throw error;}
  })};
 }
 if(!initialize)return db;
 await db.exec(`CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS admins(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,admin_id TEXT REFERENCES admins(id),album_id TEXT,expires BIGINT NOT NULL);
 CREATE TABLE IF NOT EXISTS albums(id TEXT PRIMARY KEY,title TEXT NOT NULL,category TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'draft',password TEXT,cover_id TEXT,client_name TEXT NOT NULL DEFAULT '',event_date TEXT NOT NULL DEFAULT '',selection_status TEXT NOT NULL DEFAULT 'draft',created TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS album_sections(id TEXT PRIMARY KEY,album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,title TEXT NOT NULL,position INTEGER NOT NULL DEFAULT 0);
 CREATE INDEX IF NOT EXISTS sections_album_position ON album_sections(album_id,position);
 CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY,album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,filename TEXT NOT NULL,original TEXT NOT NULL DEFAULT '',caption TEXT NOT NULL DEFAULT '',width INTEGER NOT NULL,height INTEGER NOT NULL,position INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS selections(album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,updated TEXT NOT NULL,PRIMARY KEY(album_id,photo_id));
 CREATE TABLE IF NOT EXISTS photo_upload_receipts(album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,upload_key TEXT NOT NULL,file_hash TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(album_id,upload_key));
 CREATE TABLE IF NOT EXISTS photo_cleanup(photo_id TEXT PRIMARY KEY,filename TEXT NOT NULL,has_download INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS inquiries(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',date TEXT NOT NULL DEFAULT '',service TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'new',created TEXT NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS one_confirmed_per_date ON inquiries(date) WHERE status='confirmed' AND date<>'';
 CREATE TABLE IF NOT EXISTS blocked_dates(date TEXT PRIMARY KEY,note TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires BIGINT NOT NULL);`);
 await db.exec(`CREATE TABLE IF NOT EXISTS media_control(id INTEGER PRIMARY KEY,storage TEXT NOT NULL,owner TEXT,deadline BIGINT NOT NULL,generation INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS media_writers(id TEXT PRIMARY KEY,process_id TEXT NOT NULL,kind TEXT NOT NULL,started BIGINT NOT NULL);
 CREATE TABLE IF NOT EXISTS media_writes(key TEXT PRIMARY KEY,storage TEXT NOT NULL,sha256 TEXT NOT NULL,bytes BIGINT NOT NULL,state TEXT NOT NULL,created BIGINT NOT NULL);
 CREATE TABLE IF NOT EXISTS backup_runs(id TEXT PRIMARY KEY,created BIGINT NOT NULL,state TEXT NOT NULL,manifest_hash TEXT,detail TEXT NOT NULL DEFAULT '');`);
 if(db.cloud){await db.exec(['media_control','media_writers','media_writes','backup_runs','settings','admins','sessions','albums','album_sections','photos','selections','photo_upload_receipts','photo_cleanup','inquiries','blocked_dates','rate_limits'].map(t=>`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`).join('\n'));}
 // Additive migration: existing albums, photos and sessions stay intact.
 if(db.cloud)await db.exec('ALTER TABLE photos ADD COLUMN IF NOT EXISTS section_id TEXT REFERENCES album_sections(id) ON DELETE SET NULL;');
 else if(!(await db.all('PRAGMA table_info(photos)')).some(c=>c.name==='section_id'))await db.exec('ALTER TABLE photos ADD COLUMN section_id TEXT REFERENCES album_sections(id) ON DELETE SET NULL;');
 await db.exec('CREATE INDEX IF NOT EXISTS photos_section ON photos(section_id);');
 if(db.cloud){await db.exec("ALTER TABLE photos ADD COLUMN IF NOT EXISTS upload_key TEXT; ALTER TABLE photos ADD COLUMN IF NOT EXISTS upload_hash TEXT; ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT ''; ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS budget TEXT NOT NULL DEFAULT '';");}
 else{const columns=await db.all('PRAGMA table_info(photos)');for(const column of ['upload_key','upload_hash'])if(!columns.some(c=>c.name===column))await db.exec('ALTER TABLE photos ADD COLUMN '+column+' TEXT;');const inquiryColumns=await db.all('PRAGMA table_info(inquiries)');if(!inquiryColumns.some(c=>c.name==='budget'))await db.exec("ALTER TABLE inquiries ADD COLUMN budget TEXT NOT NULL DEFAULT '';");if(!inquiryColumns.some(c=>c.name==='notes'))await db.exec("ALTER TABLE inquiries ADD COLUMN notes TEXT NOT NULL DEFAULT '';");}
 // Nullable byte counts preserve old records without inventing original sizes.
 if(db.cloud)await db.exec(['source_bytes','image_bytes','thumb_bytes','download_bytes'].map(column=>'ALTER TABLE photos ADD COLUMN IF NOT EXISTS '+column+' INTEGER;').join(' '));
 else{const columns=await db.all('PRAGMA table_info(photos)');for(const column of ['source_bytes','image_bytes','thumb_bytes','download_bytes'])if(!columns.some(c=>c.name===column))await db.exec('ALTER TABLE photos ADD COLUMN '+column+' INTEGER;');}
 // Request identity survives retries and server restarts; legacy requests remain valid.
 if(db.cloud)await db.exec('ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS request_key TEXT; ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS request_hash TEXT;');
 else{const columns=await db.all('PRAGMA table_info(inquiries)');for(const key of ['request_key','request_hash'])if(!columns.some(c=>c.name===key))await db.exec('ALTER TABLE inquiries ADD COLUMN '+key+' TEXT;');}
 await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS inquiry_request_key ON inquiries(request_key) WHERE request_key IS NOT NULL;');
 await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS photo_upload_key ON photos(album_id,upload_key) WHERE upload_key IS NOT NULL;
 CREATE INDEX IF NOT EXISTS photos_album_position ON photos(album_id,position);
 CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires);
 CREATE INDEX IF NOT EXISTS rate_limits_expires ON rate_limits(expires);
 CREATE INDEX IF NOT EXISTS albums_status_created ON albums(status,created);
 CREATE INDEX IF NOT EXISTS inquiries_status_created ON inquiries(status,created);`);
 await migrateAlbumSlugs(db);
 await migrateDriveSchema(db);
 await migrateInquiryNotificationSchema(db);
 await migrateFeedbackSchema(db);
 const defaults=siteDefaults;
 const entries=Object.entries(defaults);
 await db.run('INSERT INTO settings(key,value) VALUES '+entries.map(()=>'(?,?)').join(',')+' ON CONFLICT(key) DO NOTHING',entries.flat());
 return db;
}
