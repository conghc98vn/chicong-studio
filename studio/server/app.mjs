import {buildSchemaOrg,schemaOrgScript} from './schema-org.mjs';
import {findAlbum,reserveAlbumSlug} from './album-slugs.mjs';
import {validateInquiry} from '../web/inquiry-validation.mjs';
import {currentCopy} from '../web/site-copy.mjs';
import {selectHeroSlides,parseSelection,defaultHeroSelection} from '../web/hero-slides.mjs';
import {defaultStorySelection} from '../web/home-curation.mjs';
import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {openDatabase,id,hashPassword,verifyPassword} from './db.mjs';
import {createStorage} from './storage.mjs';
const digest=t=>createHash('sha256').update(t).digest('hex');
const categories=['wedding','prewedding','portrait','lifestyle'];
const albumStatuses=['draft','published','private','archived'];
const inquiryStatuses=['new','contacted','confirmed','completed','cancelled'];
const clean=(x,max=200)=>typeof x==='string'?x.trim().slice(0,max):'';
const validEmail=x=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);
const now=()=>new Date().toISOString();
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const validDate=x=>/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const fail=(status,message)=>Object.assign(new Error(message),{status});
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
export async function createApp(options={}){
 const production=options.production??process.env.NODE_ENV==='production';
 const env=options.env||process.env;const dataDir=options.dataDir||env.DATA_DIR||path.resolve('data/live');
 if(production&&(!env.DATABASE_URL||!env.SUPABASE_URL))throw Error('Production requires persistent DATABASE_URL and SUPABASE_URL. See HOSTING.md.');
 const db=options.db||await openDatabase(dataDir,{url:env.DATABASE_URL});const storage=options.storage||createStorage(path.join(dataDir,'uploads'),env);
 await storage.init?.();
 const app=express();app.disable('x-powered-by');if(production)app.set('trust proxy',1);
 app.use((req,res,next)=>{res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",'Permissions-Policy':'camera=(), microphone=(), geolocation=()'});if(production)res.set('Strict-Transport-Security','max-age=31536000');next();});
 app.use(express.json({limit:'128kb'}));
 app.use((req,res,next)=>{req.body??={};next();});
 app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');if(!['GET','HEAD','OPTIONS'].includes(req.method)){const expected=new URL(options.origin||env.SITE_URL||`${req.protocol}://${req.get('host')}`).origin;const local=`${req.protocol}://${req.get('host')}`;if(req.get('origin')!==expected&&req.get('origin')!==local)return res.status(403).json({error:'Nguồn yêu cầu không hợp lệ. Tải lại trang rồi thử lại.'});}next();});
 const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(p=>{const i=p.indexOf('=');return [p.slice(0,i).trim(),p.slice(i+1).trim()];}).filter(([k])=>k));
 const session=async(req,name)=>{const token=cookies(req)[name];if(!token)return;return db.get('SELECT * FROM sessions WHERE token=? AND expires>?',[digest(token),Date.now()]);};
 // Express middleware requires next(), unlike terminal route handlers.
 const requireAdmin=(req,res,next)=>{session(req,'studio_admin').then(s=>{if(!s?.admin_id)throw fail(401,'Vui lòng đăng nhập quản trị.');req.admin=s.admin_id;next();}).catch(next);};
 const allowed=async(req,a)=>{if(a.status==='published')return true;if((await session(req,'studio_admin'))?.admin_id)return true;const s=await session(req,'gallery_'+a.id);return a.status==='private'&&s?.album_id===a.id;};
 const makeSession=async(res,{admin,album})=>{await db.run('DELETE FROM sessions WHERE expires<?',[Date.now()]);const token=randomBytes(32).toString('hex');const age=admin?12*3600000:7*86400000;await db.run('INSERT INTO sessions(token,admin_id,album_id,expires) VALUES(?,?,?,?)',[digest(token),admin||null,album||null,Date.now()+age]);res.cookie(admin?'studio_admin':'gallery_'+album,token,{httpOnly:true,sameSite:'strict',secure:production,maxAge:age,path:'/'});};
 const rate=async(req,key,max=10)=>{const k=digest(key+':'+req.ip);const time=Date.now();const row=await db.get('INSERT INTO rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires<? THEN 1 ELSE rate_limits.count+1 END,expires=CASE WHEN rate_limits.expires<? THEN ? ELSE rate_limits.expires END WHERE rate_limits.expires<? OR rate_limits.count<? RETURNING count',[k,time+900000,time,time,time+900000,time,max]);if(!row)throw fail(429,'Bạn đã thử nhiều lần. Vui lòng quay lại sau 15 phút.');await db.run('DELETE FROM rate_limits WHERE expires<?',[time]);};
 const settings=async()=>currentCopy(Object.fromEntries((await db.all('SELECT * FROM settings')).map(r=>[r.key,r.value])));
 const albumDTO=async(a,admin=false)=>{const photos=await db.all('SELECT * FROM photos WHERE album_id=? ORDER BY position,id',[a.id]);const selected=await db.all('SELECT photo_id FROM selections WHERE album_id=?',[a.id]);return {id:a.id,slug:a.slug,title:a.title,category:a.category,description:a.description,status:a.status,event_date:a.event_date,selection_status:a.selection_status,cover_id:a.cover_id,created:a.created,...(admin?{client_name:a.client_name,has_password:!!a.password}:{}),photos:photos.map(p=>({id:p.id,caption:p.caption,original:p.original,width:p.width,height:p.height,position:p.position,src:'/media/'+p.id,thumb:'/media/'+p.id+'?size=thumb',selected:selected.some(s=>s.photo_id===p.id)}))};};
 const portfolioCards=async()=>{
  const config=await settings();
  const choices=[...parseSelection(config.heroSelection,defaultHeroSelection),...parseSelection(config.storySelection,defaultStorySelection)];
  const rows=await db.all("SELECT albums.*,(SELECT COUNT(*) FROM photos WHERE album_id=albums.id) AS photo_count FROM albums WHERE status='published' ORDER BY created DESC");
  return Promise.all(rows.map(async a=>{
   const ids=[a.cover_id,...choices.filter(c=>c.albumId===a.id).flatMap(c=>[c.photoId,c.wideId,c.tallId])].filter(Boolean);
   const photos=await db.all(`SELECT id,caption,width,height,position FROM photos WHERE album_id=? AND (id=(SELECT id FROM photos WHERE album_id=? ORDER BY position,id LIMIT 1)${ids.length?' OR id IN ('+ids.map(()=>'?').join(',')+')':''}) ORDER BY position,id`,[a.id,a.id,...ids]);
   return {id:a.id,slug:a.slug,title:a.title,category:a.category,description:a.description,status:a.status,event_date:a.event_date,cover_id:a.cover_id,created:a.created,photo_count:Number(a.photo_count),photos:photos.map(p=>({...p,src:'/media/'+p.id,thumb:'/media/'+p.id+'?size=thumb'}))};
  }));
 };
 app.get('/api/site',asyncRoute(async(req,res)=>res.json(await settings())));
 app.get('/api/health',async(req,res)=>{try{await db.get('SELECT key FROM settings LIMIT 1');res.json({ok:true});}catch{res.status(503).json({ok:false});}});
 app.get('/api/portfolio',asyncRoute(async(req,res)=>{if(req.query.view==='cards')return res.json(await portfolioCards());const rows=await db.all("SELECT * FROM albums WHERE status='published' ORDER BY created DESC");res.json(await Promise.all(rows.map(a=>albumDTO(a))));}));
 app.get('/api/albums/:key',asyncRoute(async(req,res)=>{const a=await findAlbum(db,req.params.key);if(!a||!await allowed(req,a))throw fail(404,'Không tìm thấy bộ ảnh.');res.json(await albumDTO(a));}));
 app.get('/api/gallery/:id',asyncRoute(async(req,res)=>{const a=await db.get("SELECT * FROM albums WHERE id=? AND status='private'",[req.params.id]);if(!a)throw fail(404,'Gallery không tồn tại hoặc đã được đóng.');if(!await allowed(req,a))return res.json({locked:true});res.json(await albumDTO(a));}));
 app.post('/api/gallery/:id/unlock',asyncRoute(async(req,res)=>{await rate(req,'gallery:'+req.params.id,8);const a=await db.get("SELECT * FROM albums WHERE id=? AND status='private'",[req.params.id]);if(!a||!verifyPassword(clean(req.body.password,200),a.password||''))throw fail(401,'Mật khẩu chưa đúng hoặc gallery đã được đóng.');await makeSession(res,{album:a.id});res.json({success:true});}));
 app.post('/api/gallery/:id/logout',asyncRoute(async(req,res)=>{const token=cookies(req)['gallery_'+req.params.id];if(token)await db.run('DELETE FROM sessions WHERE token=?',[digest(token)]);res.clearCookie('gallery_'+req.params.id,{path:'/',httpOnly:true,sameSite:'strict',secure:production});res.json({success:true});}));
 app.put('/api/gallery/:id/selection/:photo',asyncRoute(async(req,res)=>{const a=await db.get("SELECT * FROM albums WHERE id=? AND status='private'",[req.params.id]);if(!a||!await allowed(req,a))throw fail(401,'Vui lòng mở khóa gallery.');const p=await db.get('SELECT id FROM photos WHERE id=? AND album_id=?',[req.params.photo,a.id]);if(!p)throw fail(404,'Không tìm thấy ảnh.');if(typeof req.body.selected!=='boolean')throw fail(422,'Lựa chọn không hợp lệ.');if(req.body.selected)await db.run('INSERT INTO selections(album_id,photo_id,updated) VALUES(?,?,?) ON CONFLICT(album_id,photo_id) DO UPDATE SET updated=excluded.updated',[a.id,p.id,now()]);else await db.run('DELETE FROM selections WHERE album_id=? AND photo_id=?',[a.id,p.id]);await db.run("UPDATE albums SET selection_status='draft' WHERE id=?",[a.id]);res.json({success:true});}));
 app.post('/api/gallery/:id/submit',asyncRoute(async(req,res)=>{const a=await db.get("SELECT * FROM albums WHERE id=? AND status='private'",[req.params.id]);if(!a||!await allowed(req,a))throw fail(401,'Vui lòng mở khóa gallery.');if(!await db.get('SELECT photo_id FROM selections WHERE album_id=? LIMIT 1',[a.id]))throw fail(422,'Hãy chọn ít nhất một ảnh.');await db.run("UPDATE albums SET selection_status='submitted' WHERE id=?",[a.id]);res.json({success:true});}));
 app.get('/media/:id',asyncRoute(async(req,res)=>{const p=await db.get('SELECT photos.*,albums.status,albums.password FROM photos JOIN albums ON photos.album_id=albums.id WHERE photos.id=?',[req.params.id]);if(!p||!await allowed(req,{id:p.album_id,status:p.status}))throw fail(404,'Không tìm thấy ảnh.');const thumb=req.query.size==='thumb';const buffer=await storage.get(p.filename+(thumb?'-thumb':'')+'.webp');res.set({'Content-Type':'image/webp','Cache-Control':p.status==='published'?'public,max-age=3600':'private,no-store'});res.send(buffer);}));
 app.get('/api/availability',asyncRoute(async(req,res)=>{const rows=await db.all("SELECT date FROM blocked_dates UNION SELECT date FROM inquiries WHERE status='confirmed' AND date<>''");res.json({blocked:rows.map(r=>r.date),today:today()});}));
 app.post('/api/inquiries',asyncRoute(async(req,res)=>{
  // A generous outer guard covers malformed traffic without charging the submission quota.
  await rate(req,'inquiry-attempt',60);
  if(clean(req.body.website))throw fail(422,'Yêu cầu không hợp lệ.');
  const {data,fields}=validateInquiry(req.body);
  if(Object.keys(fields).length)throw Object.assign(fail(422,'Vui lòng kiểm tra thông tin được đánh dấu.'),{fields});
  const requestKey=req.body.requestKey??null;
  if(requestKey!==null&&(typeof requestKey!=='string'||!/^[a-f0-9]{32}$/.test(requestKey)))throw fail(422,'Mã gửi chưa hợp lệ. Vui lòng tải lại trang.');
  const hash=digest(JSON.stringify(data));
  const replay=async()=>{
   if(!requestKey)return null;
   const existing=await db.get('SELECT id,request_hash FROM inquiries WHERE request_key=?',[requestKey]);
   if(existing&&existing.request_hash!==hash)throw fail(409,'Nội dung của lần gửi này đã thay đổi. Vui lòng gửi lại với mã mới.');
   return existing;
  };
  const existing=await replay();
  if(existing)return res.json({success:true,reference:existing.id.slice(0,8)});
  const dateFields=validateInquiry(data,today()).fields;
  if(Object.keys(dateFields).length)throw Object.assign(fail(422,'Vui lòng kiểm tra thông tin được đánh dấu.'),{fields:dateFields});
  const {name,email,phone,date,service,budget,message}=data;
  if(date&&await db.get("SELECT date FROM blocked_dates WHERE date=? UNION SELECT date FROM inquiries WHERE date=? AND status='confirmed'",[date,date]))throw Object.assign(fail(409,'Ngày này đã kín lịch. Bạn có thể chọn ngày khác hoặc bỏ chọn để trao đổi thêm.'),{fields:{date:'Ngày này đã kín lịch. Chọn ngày khác hoặc bỏ chọn ngày để được tư vấn.'}});
  await rate(req,'inquiry-valid',5);
  let inserted=false;
  try{
   const key=id();
   const result=await db.run('INSERT INTO inquiries(id,name,email,phone,date,service,message,status,created,budget,request_key,request_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING',[key,name,email,phone,date,service,message,'new',now(),budget,requestKey,requestKey?hash:null]);
   inserted=Number(result.changes)>0;
   const row=inserted?{id:key}:await replay();
   if(!row)throw fail(503,'Chưa lưu được yêu cầu. Vui lòng thử lại.');
   res.status(inserted?201:200).json({success:true,reference:row.id.slice(0,8)});
  }finally{
   // Concurrent replays and failed writes do not spend a successful-submission slot.
   if(!inserted)await db.run('UPDATE rate_limits SET count=CASE WHEN count>0 THEN count-1 ELSE 0 END WHERE key=?',[digest('inquiry-valid:'+req.ip)]);
  }
 }));
 app.get('/api/admin/session',asyncRoute(async(req,res)=>{const admin=await session(req,'studio_admin');res.json({authenticated:!!admin?.admin_id,needsSetup:!await db.get('SELECT id FROM admins LIMIT 1')});}));
 app.post('/api/admin/setup',asyncRoute(async(req,res)=>{await rate(req,'setup',5);if(await db.get('SELECT id FROM admins LIMIT 1'))throw fail(409,'Tài khoản quản trị đã được tạo.');const local=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);if((production||!local)&&(!env.SETUP_TOKEN||req.body.token!==env.SETUP_TOKEN))throw fail(403,'Cần mã thiết lập từ biến môi trường SETUP_TOKEN.');const email=clean(req.body.email,150),password=clean(req.body.password,200);if(!validEmail(email)||password.length<12)throw fail(422,'Email hợp lệ và mật khẩu tối thiểu 12 ký tự.');const admin='owner';try{await db.run('INSERT INTO admins(id,email,password) VALUES(?,?,?)',[admin,email,hashPassword(password)]);}catch{throw fail(409,'Tài khoản đã được tạo.');}await makeSession(res,{admin});res.status(201).json({success:true});}));
 app.post('/api/admin/login',asyncRoute(async(req,res)=>{await rate(req,'login',8);const a=await db.get('SELECT * FROM admins WHERE email=?',[clean(req.body.email,150)]);if(!a||!verifyPassword(clean(req.body.password,200),a.password))throw fail(401,'Email hoặc mật khẩu chưa đúng.');await makeSession(res,{admin:a.id});res.json({success:true});}));
 app.post('/api/admin/logout',requireAdmin,asyncRoute(async(req,res)=>{const t=cookies(req).studio_admin;await db.run('DELETE FROM sessions WHERE token=?',[digest(t)]);res.clearCookie('studio_admin',{path:'/',httpOnly:true,sameSite:'strict',secure:production});res.json({success:true});}));
 app.use('/api/admin',requireAdmin);
 app.get('/api/admin/dashboard',asyncRoute(async(req,res)=>{const albums=await db.all('SELECT status,COUNT(*) AS count FROM albums GROUP BY status');const inquiries=await db.all('SELECT status,COUNT(*) AS count FROM inquiries GROUP BY status');const recent=await db.all('SELECT * FROM inquiries ORDER BY created DESC LIMIT 5');const selections=await db.all("SELECT id,title FROM albums WHERE status='private' AND selection_status='submitted'");const photos=await db.get('SELECT COUNT(*) AS count FROM photos');const s=await settings();const visible=await db.get("SELECT COUNT(*) AS count FROM albums WHERE status='published' AND EXISTS(SELECT 1 FROM photos WHERE photos.album_id=albums.id)");res.json({albums,inquiries,recent,selections,photos:photos.count,readiness:{contact:!!(s.email||s.phone),portfolio:Number(visible.count)>0,cloud:!!db.cloud&&!!storage.cloud,production}});}));
 app.get('/api/admin/albums',asyncRoute(async(req,res)=>{const rows=await db.all('SELECT * FROM albums ORDER BY created DESC');res.json(await Promise.all(rows.map(a=>albumDTO(a,true))));}));
 app.post('/api/admin/albums',asyncRoute(async(req,res)=>{const title=clean(req.body.title,150),category=clean(req.body.category),status=clean(req.body.status)||'draft',password=clean(req.body.password,200);if((req.body.event_date&&!validDate(clean(req.body.event_date,10)))||!title||!categories.includes(category)||!albumStatuses.includes(status)||(status==='private'&&password.length<8))throw fail(422,'Nhập tên, thể loại và mật khẩu từ 8 ký tự cho gallery riêng.');const key=id();const slug=await reserveAlbumSlug(db,clean(req.body.slug,150)||title,key);await db.run('INSERT INTO albums(id,slug,title,category,description,status,password,client_name,event_date,created) VALUES(?,?,?,?,?,?,?,?,?,?)',[key,slug,title,category,clean(req.body.description,2000),status,password?hashPassword(password):null,clean(req.body.client_name,150),clean(req.body.event_date,10),now()]);res.status(201).json({id:key,slug});}));
 app.patch('/api/admin/albums/:id',asyncRoute(async(req,res)=>{const a=await db.get('SELECT * FROM albums WHERE id=?',[req.params.id]);if(!a)throw fail(404,'Không tìm thấy album.');const title=clean(req.body.title,150),category=clean(req.body.category),status=clean(req.body.status),password=clean(req.body.password,200);if((req.body.event_date&&!validDate(clean(req.body.event_date,10)))||!title||!categories.includes(category)||!albumStatuses.includes(status)||(password&&password.length<8)||(status==='private'&&!password&&!a.password))throw fail(422,'Kiểm tra tên, thể loại, trạng thái và mật khẩu gallery.');const cover=clean(req.body.cover_id)||a.cover_id;if(cover&&!await db.get('SELECT id FROM photos WHERE id=? AND album_id=?',[cover,a.id]))throw fail(422,'Ảnh bìa không thuộc album này.');const slug=await reserveAlbumSlug(db,req.body.slug===undefined?(a.slug||title):(clean(req.body.slug,150)||title),a.id);await db.run('UPDATE albums SET slug=?,title=?,category=?,description=?,status=?,password=?,client_name=?,event_date=?,cover_id=? WHERE id=?',[slug,title,category,clean(req.body.description,2000),status,password?hashPassword(password):a.password,clean(req.body.client_name,150),clean(req.body.event_date,10),cover,a.id]);if(password||status!==a.status)await db.run('DELETE FROM sessions WHERE album_id=?',[a.id]);res.json({success:true,slug});}));
 app.put('/api/admin/albums/:id/order',asyncRoute(async(req,res)=>{
 const a=await db.get('SELECT id FROM albums WHERE id=?',[req.params.id]);if(!a)throw fail(404,'Không tìm thấy album.');
 const order=req.body.photos;const existing=await db.all('SELECT id FROM photos WHERE album_id=?',[a.id]);
 if(Array.isArray(order)&&order.length>2000)throw fail(422,'Sắp xếp hỗ trợ tối đa 2.000 ảnh mỗi bộ.');
 if(!Array.isArray(order)||order.length!==existing.length||new Set(order).size!==order.length||order.some(key=>!existing.some(p=>p.id===key)))throw fail(422,'Danh sách ảnh đã thay đổi. Tải lại album rồi sắp xếp lại.');
 if(order.length)await db.run('UPDATE photos SET position=CASE id '+order.map(()=>'WHEN ? THEN ?').join(' ')+' END WHERE album_id=? AND id IN ('+order.map(()=>'?').join(',')+')',[...order.flatMap((key,i)=>[key,i]),a.id,...order]);
 res.json({success:true});
 }));
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024,files:8,fields:0},fileFilter:(req,file,cb)=>cb(['image/jpeg','image/png','image/webp'].includes(file.mimetype)?null:fail(422,'Chọn JPEG, PNG hoặc WebP.'),true)});
 app.post('/api/admin/portrait',upload.single('portrait'),asyncRoute(async(req,res)=>{
  if(!req.file)throw fail(422,'Chọn ảnh chân dung JPEG, PNG hoặc WebP.');
  let data;
  try{const image=sharp(req.file.buffer,{limitInputPixels:40000000});const meta=await image.metadata();if(!['jpeg','png','webp'].includes(meta.format))throw Error('Invalid portrait format');data=await image.rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:86}).toBuffer();}
  catch{throw fail(422,'Không đọc được ảnh chân dung.');}
  const key=id();await storage.put(key+'.webp',data);
  await db.run("INSERT INTO settings(key,value) VALUES('portrait',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[key]);
  res.status(201).json({success:true});
 }));
 app.get('/portrait/:id',asyncRoute(async(req,res)=>{
  const s=await settings();if(!/^[a-f0-9]{32}$/.test(req.params.id)||s.portrait!==req.params.id)throw fail(404,'Không tìm thấy ảnh.');
  res.type('webp').set('Cache-Control','public,max-age=3600').send(await storage.get(req.params.id+'.webp'));
 }));
 app.post('/api/admin/albums/:id/photos',upload.array('photos',8),asyncRoute(async(req,res)=>{
 const a=await db.get('SELECT * FROM albums WHERE id=?',[req.params.id]);if(!a)throw fail(404,'Không tìm thấy album.');if(!req.files?.length)throw fail(422,'Chọn JPEG, PNG hoặc WebP, tối đa 8MB/ảnh.');
 let keys=[];if(req.get('X-Upload-Keys')){try{keys=JSON.parse(req.get('X-Upload-Keys'));}catch{throw fail(422,'Mã upload không hợp lệ.');}if(!Array.isArray(keys)||keys.length!==req.files.length||new Set(keys).size!==keys.length||keys.some(k=>typeof k!=='string'||! /^[a-f0-9-]{32,64}$/.test(k)))throw fail(422,'Mã upload không hợp lệ.');}
 const output=[],errors=[],results=[];
 for(const [fileIndex,file] of req.files.entries()){
 const key=id(),uploadKey=keys[fileIndex]||null,fileHash=createHash('sha256').update(file.buffer).digest('hex');
 const previous=async()=>uploadKey?db.get('SELECT id,upload_hash FROM photos WHERE album_id=? AND upload_key=?',[a.id,uploadKey]):undefined;
 const success=(photoId,reused=false)=>{output.push(photoId);results.push({index:fileIndex,success:true,id:photoId,reused});};
 let saved=false;
 try{
 const old=await previous();if(old){if(old.upload_hash!==fileHash)throw Error('Upload key reused for a different file');success(old.id,true);continue;}
 const img=sharp(file.buffer,{limitInputPixels:40000000,animated:false});const meta=await img.metadata();if(!['jpeg','png','webp'].includes(meta.format))throw Error('Unsupported file');
 const {data,info}=await img.rotate().resize({width:2400,height:2400,fit:'inside',withoutEnlargement:true}).webp({quality:86}).toBuffer({resolveWithObject:true});const thumbnail=await sharp(data).resize({width:900,height:900,fit:'inside',withoutEnlargement:true}).webp({quality:78}).toBuffer();
 await storage.put(key+'.webp',data);await storage.put(key+'-thumb.webp',thumbnail);
 await db.run('INSERT INTO photos(id,album_id,filename,original,caption,width,height,position,upload_key,upload_hash) SELECT ?,?,?,?,?,?,?,COALESCE(MAX(position),-1)+1,?,? FROM photos WHERE album_id=?',[key,a.id,key,clean(file.originalname,180),clean(file.originalname.replace(/\.[^.]+$/,''),180),info.width,info.height,uploadKey,fileHash,a.id]);saved=true;
 success(key);await db.run('UPDATE albums SET cover_id=? WHERE id=? AND cover_id IS NULL',[key,a.id]);
 }catch{
 if(saved)continue; // A saved image must never lose its files if setting its cover fails.
 await Promise.allSettled([storage.remove(key+'.webp'),storage.remove(key+'-thumb.webp')]);
 const old=await previous();if(old?.upload_hash===fileHash){success(old.id,true);continue;}
 errors.push(clean(file.originalname,180));results.push({index:fileIndex,success:false});
 }
 }
 res.status(output.length?201:422).json({uploaded:output.length,errors,results,error:output.length?undefined:'Không xử lý được ảnh. Kiểm tra định dạng hoặc dung lượng lưu trữ.'});
 }));
 app.patch('/api/admin/photos/:id',asyncRoute(async(req,res)=>{const p=await db.get('SELECT * FROM photos WHERE id=?',[req.params.id]);if(!p)throw fail(404,'Không tìm thấy ảnh.');await db.run('UPDATE photos SET caption=?,position=? WHERE id=?',[clean(req.body.caption,300),Number.isInteger(req.body.position)?req.body.position:p.position,p.id]);res.json({success:true});}));
 app.delete('/api/admin/photos/:id',asyncRoute(async(req,res)=>{const p=await db.get('SELECT * FROM photos WHERE id=?',[req.params.id]);if(!p)throw fail(404,'Không tìm thấy ảnh.');await storage.remove(p.filename+'.webp');await storage.remove(p.filename+'-thumb.webp');await db.run('DELETE FROM photos WHERE id=?',[p.id]);const cover=await db.get('SELECT id FROM photos WHERE album_id=? ORDER BY position,id LIMIT 1',[p.album_id]);await db.run('UPDATE albums SET cover_id=? WHERE id=? AND cover_id=?',[cover?.id||null,p.album_id,p.id]);res.json({success:true});}));
 app.get('/api/admin/albums/:id/selections.csv',asyncRoute(async(req,res)=>{const a=await db.get('SELECT id FROM albums WHERE id=?',[req.params.id]);if(!a)throw fail(404,'Không tìm thấy album.');const rows=await db.all('SELECT photos.original,photos.caption,photos.id FROM photos JOIN selections ON photos.id=selections.photo_id WHERE selections.album_id=? ORDER BY photos.position,photos.id',[a.id]);const cell=x=>'"'+String(x||'').replace(/^[=+@-]/,"'").replace(/"/g,'""')+'"';res.type('text/csv; charset=utf-8').attachment('selected-photos.csv').send('\ufeffID,File,Caption\r\n'+rows.map(r=>[r.id,r.original,r.caption].map(cell).join(',')).join('\r\n'));}));
 app.get('/api/admin/inquiries',asyncRoute(async(req,res)=>res.json(await db.all('SELECT * FROM inquiries ORDER BY created DESC'))));
 app.patch('/api/admin/inquiries/:id',asyncRoute(async(req,res)=>{
  const r=await db.get('SELECT * FROM inquiries WHERE id=?',[req.params.id]);
  if(!r)throw fail(404,'Không tìm thấy yêu cầu.');
  const status=req.body.status===undefined?r.status:req.body.status;
  if(!inquiryStatuses.includes(status))throw fail(422,'Trạng thái không hợp lệ.');
  if(req.body.date!==undefined&&(typeof req.body.date!=='string'||(req.body.date!==''&&!validDate(req.body.date))))throw fail(422,'Ngày chụp không hợp lệ.');
  const date=req.body.date===undefined?r.date:req.body.date;
  if(date&&date!==r.date&&date<today())throw fail(422,'Ngày chụp mới không được nằm trong quá khứ.');
  if(req.body.notes!==undefined&&(typeof req.body.notes!=='string'||req.body.notes.length>3000))throw fail(422,'Ghi chú riêng tối đa 3.000 ký tự.');
  const notes=req.body.notes===undefined?r.notes:req.body.notes.trim();
  if(status==='confirmed'){
   if(!date)throw fail(422,'Chọn ngày chụp trước khi xác nhận lịch.');
   if(r.status!=='confirmed'&&date<today())throw fail(422,'Không thể xác nhận lịch chụp trong quá khứ.');
   if(await db.get('SELECT date FROM blocked_dates WHERE date=?',[date]))throw fail(409,'Ngày này đang được chặn trong lịch.');
  }
  try{await db.run('UPDATE inquiries SET status=?,date=?,notes=? WHERE id=?',[status,date,notes,r.id]);}
  catch(e){if(e.code==='23505'||String(e.message).includes('UNIQUE'))throw fail(409,'Đã có lịch chụp được xác nhận cho ngày này.');throw e;}
  res.json({success:true});
 }));
 app.get('/api/admin/dates',asyncRoute(async(req,res)=>res.json(await db.all('SELECT * FROM blocked_dates ORDER BY date'))));
 app.post('/api/admin/dates',asyncRoute(async(req,res)=>{const date=clean(req.body.date,10);if(!validDate(date))throw fail(422,'Ngày không hợp lệ.');await db.run('INSERT INTO blocked_dates(date,note) VALUES(?,?) ON CONFLICT(date) DO UPDATE SET note=excluded.note',[date,clean(req.body.note,200)]);res.json({success:true});}));
 app.delete('/api/admin/dates/:date',asyncRoute(async(req,res)=>{await db.run('DELETE FROM blocked_dates WHERE date=?',[req.params.date]);res.json({success:true});}));
 app.patch('/api/admin/settings',asyncRoute(async(req,res)=>{
  const current=await settings(),updates=[];
  for(const key of Object.keys(current)){
   if(req.body[key]===undefined)continue;
   if(key==='portrait') {if(req.body[key]!=='')throw fail(422,'Dùng chức năng tải ảnh chân dung.');updates.push([key,'']);continue;}
   const curated=['heroSelection','storySelection'].includes(key);
   if(typeof req.body[key]!=='string'||req.body[key].length>(curated?12000:['about','intro'].includes(key)?3000:500))throw fail(422,'Nội dung quá dài hoặc không hợp lệ.');
   const value=req.body[key].trim();
   if(['brand','headline','name'].includes(key)&&!value)throw fail(422,'Tên và tiêu đề không được để trống.');
   if(key==='email'&&value&&!validEmail(value))throw fail(422,'Email chưa đúng.');
   if(key==='phone'&&value&&!/^\+?[0-9 ()-]{8,30}$/.test(value))throw fail(422,'Số điện thoại chưa đúng.');
   if(key==='instagram'&&value&&!/^https:\/\/(www\.)?instagram\.com\/[^\s]*$/.test(value))throw fail(422,'Dùng đường dẫn Instagram dạng https://instagram.com/…');
   if(key==='facebook'&&value&&!/^https:\/\/(www\.)?facebook\.com\/[^\s]+$/.test(value))throw fail(422,'Dùng đường dẫn Facebook dạng https://www.facebook.com/…');
   if(key==='zalo'&&value&&!/^https:\/\/zalo\.me\/[0-9]+$/.test(value))throw fail(422,'Dùng đường dẫn Zalo dạng https://zalo.me/sốđiệnthoại.');
   if(curated&&value){
    let choices;try{choices=JSON.parse(value);}catch{throw fail(422,'Danh sách ảnh chưa đúng.');}
    if(!Array.isArray(choices)||choices.length>(key==='heroSelection'?4:6))throw fail(422,'Danh sách ảnh vượt giới hạn.');
    const used=new Set();
    for(const choice of choices){
     if(!choice||typeof choice!=='object'||typeof choice.albumId!=='string'||used.has(choice.albumId))throw fail(422,'Mỗi album chỉ chọn một lần.');
     used.add(choice.albumId);
     const a=await db.get("SELECT id FROM albums WHERE id=? AND status='published'",[choice.albumId]);
     if(!a)throw fail(422,'Chỉ chọn ảnh từ album công khai.');
     for(const field of key==='heroSelection'?['wideId','tallId']:['photoId']){
      if(typeof choice[field]!=='string'||!await db.get('SELECT id FROM photos WHERE id=? AND album_id=?',[choice[field],a.id]))throw fail(422,'Ảnh không thuộc album đã chọn.');
     }
    }
   }
   updates.push([key,value]);
  }
  if(updates.length)await db.run('INSERT INTO settings(key,value) VALUES '+updates.map(()=>'(?,?)').join(',')+' ON CONFLICT(key) DO UPDATE SET value=excluded.value',updates.flat());
  res.json({success:true});
 }));
 app.get('/api/admin/export',asyncRoute(async(req,res)=>{const output={version:2,exported:now()};for(const table of ['settings','albums','photos','selections','inquiries','blocked_dates','album_slugs'])output[table]=await db.all('SELECT * FROM '+table);res.attachment('chicong-backup.json').json(output);}));
 app.use('/api',(req,res)=>res.status(404).json({error:'Không tìm thấy chức năng này.'}));
 app.use('/app',express.static(path.resolve('studio/web'),{maxAge:0,index:false}));
 app.get('/bookme',(req,res)=>res.redirect(301,'/contact'));
 app.get('/robots.txt',(req,res)=>res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /gallery/\nDisallow: /api/\nSitemap: ${(env.SITE_URL||'https://chicongphoto.vn').replace(/\/$/,'')}/sitemap.xml`));
 app.get('/sitemap.xml',asyncRoute(async(req,res)=>{const url=(env.SITE_URL||'https://chicongphoto.vn').replace(/\/$/,'');const albums=await db.all("SELECT slug FROM albums WHERE status='published'");res.type('application/xml').send(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/','/portfolio','/about','/contact',...albums.map(a=>'/album/'+a.slug)].map(r=>`<url><loc>${url+r}</loc></url>`).join('')}</urlset>`);}));
 const shell=await readFile(path.resolve('studio/web/index.html'),'utf8');
 const cfToken=env.CF_BEACON_TOKEN||env.CLOUDFLARE_ANALYTICS_TOKEN||(production?'fd0f089e6f094baca1d372c934fa801d':'');
 const cfBeacon=cfToken?`<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${escape(cfToken)}"}'></script>`:'';
 const page=asyncRoute(async(req,res)=>{
  const s=await settings();
  const escape=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const titles={'/':s.brand+' · '+s.tagline,'/portfolio':'Bộ ảnh · '+s.brand,'/about':'Giới thiệu · '+s.brand,'/contact':'Liên hệ & đặt lịch · '+s.brand,'/admin':'Studio · '+s.brand};
  let title=titles[req.path]||'Bộ ảnh · '+s.brand;
  // Use matched parameters: Express accepts route names regardless of casing.
  const galleryPage=req.params.id!==undefined;
  const albumPage=req.params.key!==undefined;
  let privatePage=req.path.toLowerCase().startsWith('/admin')||galleryPage;
  let imagePhoto,description=s.intro,canonicalPath=req.path,matchedAlbum;
  if(albumPage||galleryPage){
   const a=albumPage?await findAlbum(db,req.params.key):await db.get('SELECT * FROM albums WHERE id=?',[req.params.id]);
   if(!a||(galleryPage&&a.status!=='private')||(albumPage&&!await allowed(req,a)))res.status(404);
   else if(a.status==='published'){
    matchedAlbum=a;
    canonicalPath='/album/'+a.slug;
    if(req.path!==canonicalPath)return res.redirect(301,canonicalPath);
    description=a.description||s.intro;title=a.title+' · '+s.brand;
    imagePhoto=a.cover_id||(await db.get('SELECT id FROM photos WHERE album_id=? ORDER BY position,id LIMIT 1',[a.id]))?.id;
   }else privatePage=true;
  }else if(!privatePage)imagePhoto=(await db.get("SELECT photos.id FROM photos JOIN albums ON photos.album_id=albums.id WHERE albums.status='published' ORDER BY CASE WHEN photos.id=albums.cover_id THEN 0 ELSE 1 END, albums.created DESC,photos.position LIMIT 1"))?.id;
  if(req.path==='/'){const hero=selectHeroSlides(await portfolioCards(),s.heroSelection)[0];if(hero)imagePhoto=hero.wide.id;}
  const url=(env.SITE_URL||'https://chicongphoto.vn').replace(/\/$/,'');
  if(privatePage)res.set('Cache-Control','private,no-store');
  const og=imagePhoto&&!privatePage?`<meta property="og:image" content="${escape(url+'/media/'+imagePhoto)}">`:'';
  const structuredData=!privatePage&&res.statusCode!==404?schemaOrgScript(buildSchemaOrg({site:s,album:matchedAlbum,url,imagePhoto,path:canonicalPath})):'';
  const analytics=!privatePage&&res.statusCode!==404?cfBeacon:'';
  const values={__TITLE__:escape(title),__DESCRIPTION__:escape(description),__CANONICAL__:escape(url+canonicalPath),__ROBOTS__:privatePage||res.statusCode===404?'noindex,nofollow':'index,follow',__OG_META__:og,__STRUCTURED_DATA__:structuredData,__ANALYTICS__:analytics};
  res.send(shell.replace(/__TITLE__|__DESCRIPTION__|__CANONICAL__|__ROBOTS__|__OG_META__|__STRUCTURED_DATA__|__ANALYTICS__/g,key=>values[key]));
 });
 app.get(['/', '/portfolio','/about','/contact','/admin','/album/:key','/gallery/:id'],page);
 app.use((req,res)=>res.status(404).send(shell.replaceAll('__TITLE__','Không tìm thấy trang').replaceAll('__DESCRIPTION__','').replaceAll('__CANONICAL__','').replaceAll('__ROBOTS__','noindex').replaceAll('__OG_META__','').replaceAll('__STRUCTURED_DATA__','').replaceAll('__ANALYTICS__','')));
 app.use((err,req,res,next)=>{if(res.headersSent)return next(err);const status=err instanceof multer.MulterError?422:err.status||500;if(status>=500)console.error('Request failed:',err.name);res.status(status).json({...(err.fields?{fields:err.fields}:{}),error:status>=500?'Có lỗi trên máy chủ. Vui lòng thử lại.':err instanceof multer.MulterError?'Mỗi lần tối đa 8 ảnh, tối đa 8MB/ảnh.':err.message});});
 return {app,db,storage};
}
