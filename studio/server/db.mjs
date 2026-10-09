import {migrateAlbumSlugs} from './album-slugs.mjs';
import {siteDefaults} from '../web/site-copy.mjs';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import pg from 'pg';
export const id=()=>randomBytes(16).toString('hex');
export function hashPassword(value){const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(value,salt,64).toString('hex');}
export function verifyPassword(value,stored){try{const [salt,key]=stored.split(':');const actual=scryptSync(value,salt,64);const expected=Buffer.from(key,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected);}catch{return false;}}
export async function openDatabase(dir,{url=process.env.DATABASE_URL}={}){
 let db;
 if(url){const pool=new pg.Pool({connectionString:url,max:3,connectionTimeoutMillis:15000});const query=(sql,p=[])=>{let i=0;return pool.query(sql.replace(/\?/g,()=>'$'+(++i)),p);};db={all:async(s,p)=>(await query(s,p)).rows,get:async(s,p)=>(await query(s,p)).rows[0],run:async(s,p)=>({changes:(await query(s,p)).rowCount}),exec:s=>pool.query(s),close:()=>pool.end(),cloud:true};}
 else{mkdirSync(dir,{recursive:true});const raw=new DatabaseSync(path.join(dir,'studio.sqlite'));raw.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');db={all:async(s,p=[])=>raw.prepare(s).all(...p),get:async(s,p=[])=>raw.prepare(s).get(...p),run:async(s,p=[])=>raw.prepare(s).run(...p),exec:async s=>raw.exec(s),close:async()=>raw.close(),cloud:false};}
 await db.exec(`CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS admins(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,admin_id TEXT REFERENCES admins(id),album_id TEXT,expires BIGINT NOT NULL);
 CREATE TABLE IF NOT EXISTS albums(id TEXT PRIMARY KEY,title TEXT NOT NULL,category TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'draft',password TEXT,cover_id TEXT,client_name TEXT NOT NULL DEFAULT '',event_date TEXT NOT NULL DEFAULT '',selection_status TEXT NOT NULL DEFAULT 'draft',created TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY,album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,filename TEXT NOT NULL,original TEXT NOT NULL DEFAULT '',caption TEXT NOT NULL DEFAULT '',width INTEGER NOT NULL,height INTEGER NOT NULL,position INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS selections(album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,updated TEXT NOT NULL,PRIMARY KEY(album_id,photo_id));
 CREATE TABLE IF NOT EXISTS inquiries(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',date TEXT NOT NULL DEFAULT '',service TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'new',created TEXT NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS one_confirmed_per_date ON inquiries(date) WHERE status='confirmed' AND date<>'';
 CREATE TABLE IF NOT EXISTS blocked_dates(date TEXT PRIMARY KEY,note TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires BIGINT NOT NULL);`);
 if(db.cloud){await db.exec(['settings','admins','sessions','albums','photos','selections','inquiries','blocked_dates','rate_limits'].map(t=>`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`).join('\n'));}
 // Additive migration: existing albums, photos and sessions stay intact.
 if(db.cloud){await db.exec("ALTER TABLE photos ADD COLUMN IF NOT EXISTS upload_key TEXT; ALTER TABLE photos ADD COLUMN IF NOT EXISTS upload_hash TEXT; ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT ''; ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS budget TEXT NOT NULL DEFAULT '';");}
 else{const columns=await db.all('PRAGMA table_info(photos)');for(const column of ['upload_key','upload_hash'])if(!columns.some(c=>c.name===column))await db.exec('ALTER TABLE photos ADD COLUMN '+column+' TEXT;');const inquiryColumns=await db.all('PRAGMA table_info(inquiries)');if(!inquiryColumns.some(c=>c.name==='budget'))await db.exec("ALTER TABLE inquiries ADD COLUMN budget TEXT NOT NULL DEFAULT '';");if(!inquiryColumns.some(c=>c.name==='notes'))await db.exec("ALTER TABLE inquiries ADD COLUMN notes TEXT NOT NULL DEFAULT '';");}
 // Request identity survives retries and server restarts; legacy requests remain valid.
 if(db.cloud)await db.exec('ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS request_key TEXT; ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS request_hash TEXT;');
 else{const columns=await db.all('PRAGMA table_info(inquiries)');for(const key of ['request_key','request_hash'])if(!columns.some(c=>c.name===key))await db.exec('ALTER TABLE inquiries ADD COLUMN '+key+' TEXT;');}
 await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS inquiry_request_key ON inquiries(request_key) WHERE request_key IS NOT NULL;');
 await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS photo_upload_key ON photos(album_id,upload_key) WHERE upload_key IS NOT NULL;
 CREATE INDEX IF NOT EXISTS photos_album_position ON photos(album_id,position);
 CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires);
 CREATE INDEX IF NOT EXISTS albums_status_created ON albums(status,created);
 CREATE INDEX IF NOT EXISTS inquiries_status_created ON inquiries(status,created);`);
 await migrateAlbumSlugs(db);
 const defaults=siteDefaults;
 for(const [key,value] of Object.entries(defaults))await db.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING',[key,value]);
 return db;
}
