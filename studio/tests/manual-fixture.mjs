// Disposable browser verification server. Never used by npm start or deployment.
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {createApp} from '../server/app.mjs';
import {id,hashPassword} from '../server/db.mjs';
const dir=await mkdtemp(path.join(tmpdir(),'chicong-browser-'));
const {app,db,storage}=await createApp({dataDir:dir,env:{},seed:false});
await db.run('INSERT INTO admins(id,email,password) VALUES(?,?,?)',['test-owner','studio-test@example.com',hashPassword('temporary-test-password')]);
const album=id();await db.run('INSERT INTO albums(id,title,category,status,password,created) VALUES(?,?,?,?,?,?)',[album,'Gallery kiểm thử','wedding','private',hashPassword('client-test-password'),new Date().toISOString()]);
const sample=await sharp({create:{width:700,height:1000,channels:3,background:'#acb8a0'}}).jpeg().toBuffer();
await writeFile(path.join(dir,'upload-test.jpg'),sample);
for(let i=0;i<3;i++){const key=id();const image=await sharp({create:{width:800,height:i===1?600:1100,channels:3,background:['#ced5c1','#d8bba7','#a5bdb0'][i]}}).webp().toBuffer();await storage.put(key+'.webp',image);await storage.put(key+'-thumb.webp',image);await db.run('INSERT INTO photos(id,album_id,filename,original,caption,width,height,position) VALUES(?,?,?,?,?,?,?,?)',[key,album,key,'test-'+(i+1)+'.jpg','Ảnh kiểm thử '+(i+1),800,i===1?600:1100,i]);if(i===0)await db.run('UPDATE albums SET cover_id=? WHERE id=?',[key,album]);}
const server=app.listen(4180,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://localhost:4180/admin',gallery:'http://localhost:4180/gallery/'+album,upload:path.join(dir,'upload-test.jpg')})));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(async()=>{await db.close();await rm(dir,{recursive:true,force:true});process.exit(0);}));
