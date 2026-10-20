import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {request} from 'node:http';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createApp} from '../server/app.mjs';

test('Large catalog negotiation compresses bytes without changing access controls or photo data',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'catalog-transfer-'));
 const instance=await createApp({dataDir:dir,env:{},seed:false});
 const server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const read=(route,encoding,cookie)=>new Promise((resolve,reject)=>{
  const headers={...(encoding===undefined?{}:{'Accept-Encoding':encoding}),...(cookie?{Cookie:cookie}:{})};
  request({hostname:'127.0.0.1',port:server.address().port,path:route,headers},response=>{
   const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks)}));
  }).on('error',reject).end();
 });
 try{
  await instance.db.run("INSERT INTO albums(id,title,category,status) VALUES('album','Bộ ảnh kiểm thử','wedding','private')");
  for(let start=0;start<500;start+=100){const rows=Array.from({length:100},(_,i)=>['p'+(start+i),'album','object','Ảnh '+(start+i)+'.jpg',2400,1600,start+i]);await instance.db.run('INSERT INTO photos(id,album_id,filename,original,width,height,position) VALUES '+rows.map(()=>'(?,?,?,?,?,?,?)').join(','),rows.flat());}
  const plain=await read('/api/gallery/album','identity');
  const gzip=await read('/api/gallery/album','gzip');
  assert.equal(gzip.status,200);assert.equal(gzip.headers['content-encoding'],'gzip');
  assert.match(gzip.headers.vary,/Accept-Encoding/);assert.match(gzip.headers['cache-control'],/no-store/);
  assert.deepEqual(gunzipSync(gzip.body),plain.body);assert.equal(JSON.parse(plain.body).photos.length,500);
  assert.ok(gzip.body.length<plain.body.length/3,'Catalog transfer should shrink materially.');
  for(const encoding of [undefined,'gzip;q=0, identity','gzip;q=0.5, identity;q=1','br']){
   const identity=await read('/api/gallery/album',encoding);assert.equal(identity.headers['content-encoding'],undefined);assert.deepEqual(identity.body,plain.body);
  }
  await instance.db.run("UPDATE albums SET password='private-test-hash' WHERE id='album'");
  const locked=await read('/api/gallery/album','gzip');assert.deepEqual(JSON.parse(locked.body),{locked:true});
  assert.equal((await read('/api/admin/albums/album','gzip')).status,401);
  await instance.db.run("INSERT INTO admins(id,email,password) VALUES('owner','review@test.invalid','unused')");
  await instance.db.run('INSERT INTO sessions(token,admin_id,expires) VALUES(?,?,?)',[createHash('sha256').update('synthetic-session').digest('hex'),'owner',Date.now()+60000]);
  const admin=await read('/api/admin/albums/album','gzip','studio_admin=synthetic-session');
  assert.equal(admin.headers['content-encoding'],'gzip');assert.match(admin.headers['cache-control'],/no-store/);
  const data=JSON.parse(gunzipSync(admin.body));assert.equal(data.photos.length,500);assert.equal(data.has_password,true);assert.equal(data.password,undefined);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await instance.mediaControl.close();await instance.db.close();await rm(dir,{recursive:true,force:true});}
});
