import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server/app.mjs';
import {openDatabase} from '../server/db.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

async function setupTestApp(env={}){
 const dir=await mkdtemp(path.join(tmpdir(),'chicong-schema-test-'));
 const db=await openDatabase(dir);
 const {app}=await createApp({db,dataDir:dir,env,origin:'http://localhost'});
 const server=app.listen(0,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 return {
  base,
  db,
  dir,
  close:async()=>{
   await new Promise(r=>server.close(r));
   await db.close();
   await rm(dir,{recursive:true,force:true});
  }
 };
}

test('Schema.org JSON-LD and Cloudflare Analytics beacon are properly rendered and secured',async()=>{
 const f=await setupTestApp({
  SITE_URL:'https://chicongphoto.vn',
  CF_BEACON_TOKEN:'test-beacon-token-123'
 });
 try{
  // 1. Homepage Schema.org
  const homeRes=await fetch(f.base+'/');
  assert.equal(homeRes.status,200);
  const homeHtml=await homeRes.text();
  assert.match(homeHtml,/<script type="application\/ld\+json">/);
  const jsonMatch=homeHtml.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  assert.ok(jsonMatch);
  const homeData=JSON.parse(jsonMatch[1]);
  assert.equal(homeData['@context'],'https://schema.org');
  const studio=homeData['@graph'].find(item=>item['@type']==='PhotographyBusiness');
  assert.ok(studio);
  assert.equal(studio.name,'ChiCong');
  assert.equal(studio.url,'https://chicongphoto.vn');
  assert.equal(studio.founder.name,'Chí Công');
  assert.deepEqual(studio.address,{
   '@type':'PostalAddress',
   addressCountry:'VN'
  });

  // Verify Cloudflare analytics beacon and CSP
  assert.match(homeHtml,/beacon\.min\.js/);
  assert.match(homeHtml,/test-beacon-token-123/);
  const csp=homeRes.headers.get('content-security-policy');
  assert.match(csp,/https:\/\/static\.cloudflareinsights\.com/);
  assert.match(csp,/https:\/\/cloudflareinsights\.com/);

  // 2. Published Album Schema.org
  await f.db.run("INSERT INTO albums(id,title,category,status,slug) VALUES('test-alb','Đám cưới Hà Nội','wedding','published','dam-cuoi-ha-noi')");
  const albumRes=await fetch(f.base+'/album/dam-cuoi-ha-noi');
  assert.equal(albumRes.status,200);
  const albumHtml=await albumRes.text();
  const albumMatch=albumHtml.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  assert.ok(albumMatch);
  const albumData=JSON.parse(albumMatch[1]);
  const gallery=albumData['@graph'].find(item=>item['@type']==='ImageGallery');
  assert.ok(gallery);
  assert.equal(gallery.name,'Đám cưới Hà Nội');
  assert.equal(gallery.genre,'Ngày cưới');
  assert.equal(gallery.url,'https://chicongphoto.vn/album/dam-cuoi-ha-noi');
  assert.equal(gallery.creator.name,'Chí Công');

  // 3. Private and 404 pages do NOT leak structured data or public analytics
  await f.db.run("INSERT INTO albums(id,title,category,status,slug,password) VALUES('priv-alb','Khách riêng','wedding','private','khach-rieng','hash:pass')");
  const privRes=await fetch(f.base+'/gallery/priv-alb');
  assert.equal(privRes.status,200);
  const privHtml=await privRes.text();
  assert.doesNotMatch(privHtml,/<script type="application\/ld\+json">/);
  assert.doesNotMatch(privHtml,/beacon\.min\.js/);

  const notFoundRes=await fetch(f.base+'/trang-khong-ton-tai');
  assert.equal(notFoundRes.status,404);
  const notFoundHtml=await notFoundRes.text();
  assert.doesNotMatch(notFoundHtml,/<script type="application\/ld\+json">/);
  assert.doesNotMatch(notFoundHtml,/beacon\.min\.js/);
 }finally{
  await f.close();
 }
});
