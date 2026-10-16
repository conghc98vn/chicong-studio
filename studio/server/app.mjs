import {createMediaControl,trackedStorage,mediaMutation} from './media-control.mjs';
import {uploadTrace,quietUploadTrace} from './upload-trace.mjs';
import {maxUploadBytes,uploadSizeLabel} from '../web/upload-policy.mjs';
import {photoOptimization} from './image-optimizer.mjs';
import {uploadPhoto} from './photo-upload.mjs';
import {registerGallerySelection,photoVersion,catalogVersion,galleryVersion,selectionState} from './gallery-selection.mjs';
import {photoDeletion} from './photo-deletion.mjs';
import {registerGalleryDownloads} from './gallery-download.mjs';
import {registerSectionRoutes,validateSection} from './album-sections.mjs';
import {createGoogleCalendar} from './google-calendar.mjs';
import {buildSchemaOrg,schemaOrgScript} from './schema-org.mjs';
import {albumSlug} from '../web/album-slug.mjs';
import {findAlbum,reserveAlbumSlug} from './album-slugs.mjs';
import {validateInquiry} from '../web/inquiry-validation.mjs';
import {currentCopy} from '../web/site-copy.mjs';
import {inquiryNotice} from '../web/ui-copy.mjs';
import {parseSelection,defaultHeroSelection} from '../web/hero-slides.mjs';
import {defaultStorySelection,homeHeroSlides} from '../web/home-curation.mjs';
import {imageSources,heroDesktopSizes,heroMobileSizes} from '../web/responsive-image.mjs';
import {createMailer} from './mailer.mjs';
import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {openDatabase,id,hashPassword,verifyPassword} from './db.mjs';
import {createStorage} from './storage.mjs';
import {requestSecurity} from './request-security.mjs';
const digest=t=>createHash('sha256').update(t).digest('hex');
const mediaSources=p=>{const version=p.filename&&p.filename!==p.id?digest(p.filename).slice(0,16):'';return {src:'/media/'+p.id+(version?'?v='+version:''),thumb:'/media/'+p.id+'?size=thumb'+(version?'&v='+version:'')};};
const categories=['wedding','prewedding','portrait','lifestyle'];
const albumStatuses=['draft','published','private','archived'];
const inquiryStatuses=['new','contacted','confirmed','completed','cancelled'];
const clean=(x,max=200)=>typeof x==='string'?x.trim().slice(0,max):'';
const validEmail=x=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);
const now=()=>new Date().toISOString();
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const validDate=x=>/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const fail=(status,message)=>Object.assign(new Error(message),{status});
export async function createApp(options={}){
 const production=options.production??process.env.NODE_ENV==='production';
 const env=options.env||process.env;const dataDir=options.dataDir||env.DATA_DIR||path.resolve('data/live');
 const indexing=env.SITE_INDEXING!=='false';
 const security=requestSecurity({production,origin:options.origin,env});
 if(production&&!env.DATABASE_URL)throw Error('Production requires persistent DATABASE_URL. See HOSTING.md.');
 const rawStorage=options.storage||createStorage(path.join(dataDir,'uploads'),{...env,NODE_ENV:production?'production':env.NODE_ENV});
 await rawStorage.init?.();
 const db=options.db||await openDatabase(dataDir,{url:env.DATABASE_URL});let mediaControl;
 try{mediaControl=await createMediaControl(db,rawStorage.identity||'injected-test-storage');}catch(error){if(!options.db)await db.close();rawStorage.close?.();throw error;}
 const storage=trackedStorage(db,rawStorage,mediaControl);
 const asyncRoute=fn=>(req,res,next)=>Promise.resolve().then(()=>mediaMutation(req)?mediaControl.run('admin-media',()=>fn(req,res)):fn(req,res)).catch(next);
 const mailer=options.mailer||createMailer(env);
 const googleCalendar=options.googleCalendar||createGoogleCalendar(env);
 const deletedPhotos=photoDeletion({db,storage,mediaControl,enabled:env.MEDIA_CLEANUP_ENABLED!=='false'});
 await deletedPhotos.initialize();
 const app=express();app.disable('x-powered-by');app.set('trust proxy',security.trustProxy);
 app.use((req,res,next)=>{res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",'Permissions-Policy':'camera=(), microphone=(), geolocation=()'});if(production)res.set('Strict-Transport-Security','max-age=31536000');next();});
 app.use((req,res,next)=>{if(!indexing)res.set('X-Robots-Tag','noindex, nofollow');next();});
 app.use(security.middleware);
 app.use(uploadTrace(options.uploadLogger||(production?(entry=>console.info('[upload] '+JSON.stringify(entry))):(()=>{}))));
 app.use(express.json({limit:'128kb'}));
 app.use((req,res,next)=>{req.body??={};next();});
 const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(p=>{const i=p.indexOf('=');return [p.slice(0,i).trim(),p.slice(i+1).trim()];}).filter(([k])=>k));
 const session=async(req,name,connection=db)=>{const token=cookies(req)[name];if(!token)return;return connection.get('SELECT * FROM sessions WHERE token=? AND expires>?',[digest(token),Date.now()]);};
 // Express middleware requires next(), unlike terminal route handlers.
 const requireAdmin=(req,res,next)=>{req.uploadTrace?.mark('authenticate');session(req,'studio_admin').then(s=>{if(!s?.admin_id)throw fail(401,'Vui lòng đăng nhập để vào trang quản trị.');req.admin=s.admin_id;req.uploadTrace?.mark('receive_body');next();}).catch(next);};
 const allowed=async(req,a,connection=db)=>{if(a.status==='published')return true;if((await session(req,'studio_admin',connection))?.admin_id)return true;if(a.status==='private'){let password=a.password;if(password===undefined){const row=await connection.get('SELECT password FROM albums WHERE id=?',[a.id]);password=row?.password;}if(!password)return true;const s=await session(req,'gallery_'+a.id,connection);return s?.album_id===a.id;}return false;};
 const makeSession=async(res,{admin,album})=>{await db.run('DELETE FROM sessions WHERE expires<?',[Date.now()]);const token=randomBytes(32).toString('hex');const age=admin?12*3600000:7*86400000;await db.run('INSERT INTO sessions(token,admin_id,album_id,expires) VALUES(?,?,?,?)',[digest(token),admin||null,album||null,Date.now()+age]);res.cookie(admin?'studio_admin':'gallery_'+album,token,{httpOnly:true,sameSite:'strict',secure:production,maxAge:age,path:'/'});};
 let nextRateCleanup=0;
 const rate=async(req,key,max=10)=>{
  const k=digest(key+':'+req.ip),time=Date.now();
  // Indexed, at most once per minute per process, including under concurrent traffic.
  if(time>=nextRateCleanup){nextRateCleanup=time+60000;try{await db.run('DELETE FROM rate_limits WHERE expires<?',[time]);}catch(error){nextRateCleanup=0;throw error;}}
  const row=await db.get('INSERT INTO rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires<? THEN 1 ELSE rate_limits.count+1 END,expires=CASE WHEN rate_limits.expires<? THEN ? ELSE rate_limits.expires END WHERE rate_limits.expires<? OR rate_limits.count<? RETURNING count',[k,time+900000,time,time,time+900000,time,max]);
  if(!row)throw fail(429,'Bạn đã thao tác nhiều lần liên tiếp. Vui lòng thử lại sau 15 phút.');
 };
 const settings=async()=>currentCopy(Object.fromEntries((await db.all('SELECT * FROM settings')).map(r=>[r.key,r.value])));
 const albumDTOs=async(rows,admin=false)=>{
  if(!rows.length)return [];
  const ids=rows.map(a=>a.id),placeholders=ids.map(()=>'?').join(',');
  const [photos,selections,sections]=await Promise.all([
   db.all('SELECT id,album_id,filename,caption,original,width,height,position,section_id'+(admin?',source_bytes,image_bytes,thumb_bytes,download_bytes':'')+' FROM photos WHERE album_id IN ('+placeholders+') ORDER BY position,id',ids),
   db.all('SELECT photo_id FROM selections WHERE album_id IN ('+placeholders+')',ids),
   db.all('SELECT id,album_id,title,position FROM album_sections WHERE album_id IN ('+placeholders+') ORDER BY position,id',ids)
  ]);
  const selected=new Set(selections.map(s=>s.photo_id)),grouped=new Map(),groupedSections=new Map();
  for(const p of photos){const list=grouped.get(p.album_id)||[];list.push(p);grouped.set(p.album_id,list);}
  for(const {album_id,...section} of sections){const list=groupedSections.get(album_id)||[];list.push(section);groupedSections.set(album_id,list);}
  return rows.map(a=>({id:a.id,slug:a.slug,title:a.title,category:a.category,description:a.description,status:a.status,event_date:a.event_date,selection_status:a.selection_status,cover_id:a.cover_id,created:a.created,sections:groupedSections.get(a.id)||[],has_password:!!a.password,photo_version:photoVersion(grouped.get(a.id)||[]),gallery_version:galleryVersion(a,grouped.get(a.id)||[],groupedSections.get(a.id)||[]),...(admin?{client_name:a.client_name,catalog_version:catalogVersion(a,grouped.get(a.id)||[],groupedSections.get(a.id)||[])}:{}),photos:(grouped.get(a.id)||[]).map(p=>({id:p.id,caption:p.caption,original:p.original,width:p.width,height:p.height,position:p.position,section_id:p.section_id,...(admin?{optimization:photoOptimization(p)}:{}),...mediaSources(p),selected:selected.has(p.id)}))}));
 };
 const albumDTO=async(a,admin=false)=>(await albumDTOs([a],admin))[0];
 const adminAlbumSummaries=async(rows)=>{
  if(!rows.length)return [];
  const ids=rows.map(a=>a.id),placeholders=ids.map(()=>'?').join(',');
  const [counts,picks,covers]=await Promise.all([
   db.all('SELECT album_id,COUNT(*) AS count FROM photos WHERE album_id IN ('+placeholders+') GROUP BY album_id',ids),
   db.all('SELECT album_id,COUNT(*) AS count FROM selections WHERE album_id IN ('+placeholders+') GROUP BY album_id',ids),
   db.all('SELECT p.id,p.album_id,p.filename,p.caption,p.original,p.width,p.height,p.position FROM photos p WHERE p.id IN (SELECT COALESCE(a.cover_id,(SELECT first.id FROM photos first WHERE first.album_id=a.id ORDER BY first.position,first.id LIMIT 1)) FROM albums a WHERE a.id IN ('+placeholders+'))',ids)
  ]);
  const countByAlbum=new Map(counts.map(row=>[row.album_id,Number(row.count)])),pickByAlbum=new Map(picks.map(row=>[row.album_id,Number(row.count)])),coverByAlbum=new Map(covers.map(({album_id,filename,...photo})=>[album_id,{...photo,...mediaSources({...photo,filename})}]));
  return rows.map(a=>({id:a.id,slug:a.slug,title:a.title,category:a.category,status:a.status,event_date:a.event_date,cover_id:a.cover_id,client_name:a.client_name,created:a.created,has_password:!!a.password,photo_count:countByAlbum.get(a.id)||0,selected_count:pickByAlbum.get(a.id)||0,cover:coverByAlbum.get(a.id)||null}));
 };
 const portfolioCards=async(config=undefined)=>{
  config??=await settings();
  const choices=[...parseSelection(config.heroSelection,defaultHeroSelection),...parseSelection(config.storySelection,defaultStorySelection)];
  const rows=await db.all("SELECT albums.*,(SELECT COUNT(*) FROM photos WHERE album_id=albums.id) AS photo_count FROM albums WHERE status='published' ORDER BY created DESC");
  if(!rows.length)return [];
  const chosen=new Map(rows.map(a=>[a.id,new Set([a.cover_id,...choices.filter(c=>c.albumId===a.id).flatMap(c=>[c.photoId,c.wideId,c.tallId])].filter(Boolean))]));
  const ids=[...new Set([...chosen.values()].flatMap(set=>[...set]))];
  // Fetch only covers, first photos and curated photos, in one database round trip.
  const photos=await db.all(`SELECT p.id,p.album_id,p.filename,p.caption,p.width,p.height,p.position FROM photos p JOIN albums a ON a.id=p.album_id WHERE a.status='published' AND (p.id=a.cover_id OR p.id=(SELECT first.id FROM photos first WHERE first.album_id=a.id ORDER BY first.position,first.id LIMIT 1)${ids.length?' OR p.id IN ('+ids.map(()=>'?').join(',')+')':''}) ORDER BY p.album_id,p.position,p.id`,ids);
  const grouped=new Map();
  for(const p of photos){const list=grouped.get(p.album_id)||[];list.push(p);grouped.set(p.album_id,list);}
  return rows.map(a=>{
   const list=grouped.get(a.id)||[];
   return {id:a.id,slug:a.slug,title:a.title,category:a.category,description:a.description,status:a.status,event_date:a.event_date,cover_id:a.cover_id,created:a.created,photo_count:Number(a.photo_count),photos:list.filter((p,i)=>i===0||chosen.get(a.id).has(p.id)).map(({album_id,filename,...p})=>({...p,...mediaSources({...p,filename})}))};
  });
 };
 app.get('/api/site',asyncRoute(async(req,res)=>res.json(await settings())));
 app.get('/api/health',async(req,res)=>{try{await db.get('SELECT key FROM settings LIMIT 1');res.json({ok:true});}catch{res.status(503).json({ok:false});}});
 app.get('/api/portfolio',asyncRoute(async(req,res)=>{if(req.query.view==='cards')return res.json(await portfolioCards());const rows=await db.all("SELECT * FROM albums WHERE status='published' ORDER BY created DESC");res.json(await albumDTOs(rows));}));
 app.get('/api/albums/:key',asyncRoute(async(req,res)=>{const a=await findAlbum(db,req.params.key);if(!a||!await allowed(req,a))throw fail(404,'Không tìm thấy bộ ảnh.');res.json(await albumDTO(a));}));
 app.get('/api/gallery/:id',asyncRoute(async(req,res)=>{const a=await db.get("SELECT * FROM albums WHERE id=? AND status='private'",[req.params.id]);if(!a)throw fail(404,'Bộ ảnh riêng không còn khả dụng. Bạn hãy liên hệ nhiếp ảnh gia để kiểm tra lại đường dẫn.');if(!await allowed(req,a))return res.json({locked:true});res.json(await albumDTO(a));}));
 app.post('/api/gallery/:id/unlock',asyncRoute(async(req,res)=>{
  await rate(req,'gallery-attempt',60);
  const invalid=()=>fail(401,'Mật khẩu chưa đúng hoặc bộ ảnh riêng đã đóng. Bạn hãy kiểm tra lại mật khẩu hoặc liên hệ nhiếp ảnh gia.');
  if(!/^[a-f0-9]{32}$/.test(req.params.id))throw invalid();
  // Rate limiting runs outside the album transaction; SQLite must not enqueue a
  // second connection operation from inside that transaction.
  const candidate=await db.get("SELECT password FROM albums WHERE id=? AND status='private'",[req.params.id]);
  if(!candidate)throw invalid();
  if(candidate.password)await rate(req,'gallery:'+req.params.id,8);
  const token=randomBytes(32).toString('hex'),age=7*86400000;
  await db.transaction(async tx=>{
   const a=await tx.get("SELECT * FROM albums WHERE id=? AND status='private'"+(tx.cloud?' FOR UPDATE':''),[req.params.id]);
   if(!a||(a.password&&!verifyPassword(clean(req.body.password,200),a.password)))throw invalid();
   await tx.run('INSERT INTO sessions(token,admin_id,album_id,expires) VALUES(?,NULL,?,?)',[digest(token),a.id,Date.now()+age]);
  });
  res.cookie('gallery_'+req.params.id,token,{httpOnly:true,sameSite:'strict',secure:production,maxAge:age,path:'/'});
  res.json({success:true});
 }));
 app.post('/api/gallery/:id/logout',asyncRoute(async(req,res)=>{const token=cookies(req)['gallery_'+req.params.id];if(token)await db.run('DELETE FROM sessions WHERE token=?',[digest(token)]);res.clearCookie('gallery_'+req.params.id,{path:'/',httpOnly:true,sameSite:'strict',secure:production});res.json({success:true});}));
 registerGallerySelection(app,{db,allowed});
 registerGalleryDownloads(app,{db,storage,allowed});
 app.get('/media/:id',asyncRoute(async(req,res)=>{
  res.set('Cache-Control','private,no-store');
  const p=await db.get('SELECT photos.id,photos.album_id,photos.filename,albums.status,albums.password FROM photos JOIN albums ON photos.album_id=albums.id WHERE photos.id=?',[req.params.id]);
  if(!p||!await allowed(req,{id:p.album_id,status:p.status,password:p.password}))throw fail(404,'Không tìm thấy ảnh.');
  if(req.aborted||res.destroyed)return;
  const thumb=req.query.size==='thumb';
  res.set({'Cache-Control':p.status==='published'?'private,no-cache':'private,no-store','ETag':'"'+digest(p.filename)+(thumb?'-thumb':'-full')+'"'});
  if(req.fresh)return res.status(304).end();
  if(req.method==='HEAD')return res.type('webp').end();
  // Scrolling/navigation can abandon many images. Stop the upstream read too.
  const controller=new AbortController(),disconnected=()=>controller.abort();
  res.once('close',disconnected);
  try{
   const buffer=await storage.get(p.filename+(thumb?'-thumb':'')+'.webp',{signal:controller.signal});
   if(!res.destroyed)res.type('webp').send(buffer);
  }catch(error){if(!res.destroyed){res.set('Cache-Control','private,no-store');res.removeHeader('ETag');throw error;}}
  finally{res.removeListener('close',disconnected);}
 }));
 app.get('/api/availability',asyncRoute(async(req,res)=>{const rows=await db.all("SELECT date FROM blocked_dates UNION SELECT date FROM inquiries WHERE status='confirmed' AND date<>''");const google=await googleCalendar.read();res.json({blocked:[...new Set([...rows.map(r=>r.date),...google.blocked])],today:today(),...(google.configured?{unavailable:!!google.unavailable,through:google.through}:{})});}));
 app.post('/api/inquiries',asyncRoute(async(req,res)=>{
  // A generous outer guard covers malformed traffic without charging the submission quota.
  await rate(req,'inquiry-attempt',60);
  if(clean(req.body.website))throw fail(422,'Chưa gửi được yêu cầu tư vấn. Vui lòng kiểm tra biểu mẫu rồi thử lại.');
  const {data,fields}=validateInquiry(req.body);
  if(Object.keys(fields).length)throw Object.assign(fail(422,'Vui lòng kiểm tra các mục được đánh dấu trong biểu mẫu.'),{fields});
  const requestKey=req.body.requestKey??null;
  if(requestKey!==null&&(typeof requestKey!=='string'||!/^[a-f0-9]{32}$/.test(requestKey)))throw fail(422,'Không nhận diện được lần gửi này. Vui lòng tải lại trang rồi thử lại.');
  const hash=digest(JSON.stringify(data));
  const replay=async()=>{
   if(!requestKey)return null;
   const existing=await db.get('SELECT id,request_hash FROM inquiries WHERE request_key=?',[requestKey]);
   if(existing&&existing.request_hash!==hash)throw fail(409,'Nội dung gửi đã thay đổi. Vui lòng kiểm tra và gửi lại yêu cầu tư vấn.');
   return existing;
  };
  const existing=await replay();
  if(existing)return res.json({success:true,reference:existing.id.slice(0,8)});
  const dateFields=validateInquiry(data,today()).fields;
  if(Object.keys(dateFields).length)throw Object.assign(fail(422,'Vui lòng kiểm tra các mục được đánh dấu trong biểu mẫu.'),{fields:dateFields});
  const {name,email,phone,date,service,budget,message}=data;
  if(date)await googleCalendar.assertAvailable(date);
  if(date&&await db.get("SELECT date FROM blocked_dates WHERE date=? UNION SELECT date FROM inquiries WHERE date=? AND status='confirmed'",[date,date]))throw Object.assign(fail(409,'Ngày này đã kín lịch. Bạn có thể chọn ngày khác hoặc bỏ chọn ngày để gửi yêu cầu tư vấn.'),{fields:{date:'Ngày này đã kín lịch. Chọn ngày khác hoặc bỏ chọn ngày để gửi yêu cầu tư vấn.'}});
  await rate(req,'inquiry-valid',5);
  let inserted=false;
  try{
   const key=id();
   const result=await db.run('INSERT INTO inquiries(id,name,email,phone,date,service,message,status,created,budget,request_key,request_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING',[key,name,email,phone,date,service,message,'new',now(),budget,requestKey,requestKey?hash:null]);
   inserted=Number(result.changes)>0;
   const row=inserted?{id:key}:await replay();
   if(!row)throw fail(503,'Chưa lưu được yêu cầu tư vấn. Vui lòng thử gửi lại.');
   if(inserted){
    const ref=row.id.slice(0,8);
    const siteUrl=(env.SITE_URL||'https://chicongphoto.vn').replace(/\/$/,'');
    settings().then(s=>{
     mailer.notifyNewInquiry({inquiry:{name,email,phone,date,service,budget,message},reference:ref,settings:s,siteUrl}).catch(err=>{
      console.error('[mailer] Failed to send inquiry notification:',err?.message||err);
     });
    }).catch(()=>{});
   }
   res.status(inserted?201:200).json({success:true,reference:row.id.slice(0,8)});
  }finally{
   // Concurrent replays and failed writes do not spend a successful-submission slot.
   if(!inserted)await db.run('UPDATE rate_limits SET count=CASE WHEN count>0 THEN count-1 ELSE 0 END WHERE key=?',[digest('inquiry-valid:'+req.ip)]);
  }
 }));
 app.get('/api/admin/session',asyncRoute(async(req,res)=>{const admin=await session(req,'studio_admin');res.json({authenticated:!!admin?.admin_id,needsSetup:!await db.get('SELECT id FROM admins LIMIT 1')});}));
 app.post('/api/admin/setup',asyncRoute(async(req,res)=>{await rate(req,'setup',5);if(await db.get('SELECT id FROM admins LIMIT 1'))throw fail(409,'Tài khoản quản trị đã được tạo.');if((!req.localSetup||env.SETUP_TOKEN)&&(!env.SETUP_TOKEN||req.body.token!==env.SETUP_TOKEN))throw fail(403,'Vui lòng nhập mã thiết lập đã cấu hình trong SETUP_TOKEN.');const email=clean(req.body.email,150),password=clean(req.body.password,200);if(!validEmail(email)||password.length<12)throw fail(422,'Vui lòng nhập email hợp lệ và mật khẩu từ 12 ký tự.');const admin='owner';try{await db.run('INSERT INTO admins(id,email,password) VALUES(?,?,?)',[admin,email,hashPassword(password)]);}catch{throw fail(409,'Tài khoản quản trị đã được tạo. Vui lòng đăng nhập.');}await makeSession(res,{admin});res.status(201).json({success:true});}));
 app.post('/api/admin/login',asyncRoute(async(req,res)=>{await rate(req,'login',8);const a=await db.get('SELECT * FROM admins WHERE email=?',[clean(req.body.email,150)]);if(!a||!verifyPassword(clean(req.body.password,200),a.password))throw fail(401,'Email hoặc mật khẩu chưa đúng.');await makeSession(res,{admin:a.id});res.json({success:true});}));
 app.post('/api/admin/logout',requireAdmin,asyncRoute(async(req,res)=>{const t=cookies(req).studio_admin;await db.run('DELETE FROM sessions WHERE token=?',[digest(t)]);res.clearCookie('studio_admin',{path:'/',httpOnly:true,sameSite:'strict',secure:production});res.json({success:true});}));
 app.use('/api/admin',requireAdmin);
 registerSectionRoutes(app,db,asyncRoute);
 const selectionSummary=()=>db.all("SELECT a.id,a.title,COUNT(s.photo_id) AS selected_count FROM albums a JOIN selections s ON s.album_id=a.id WHERE a.status='private' GROUP BY a.id,a.title ORDER BY MAX(s.updated) DESC,a.id");
 app.get('/api/admin/selection-summary',asyncRoute(async(req,res)=>res.set('Cache-Control','private,no-store').json(await selectionSummary())));
 app.get('/api/admin/albums/:id/selection',asyncRoute(async(req,res)=>{const a=await db.get('SELECT * FROM albums WHERE id=?',[req.params.id]);if(!a)throw fail(404,'Không tìm thấy bộ ảnh.');res.set('Cache-Control','private,no-store').json(await selectionState(db,req.params.id,{catalogAlbum:a}));}));
 app.get('/api/admin/albums/:id',asyncRoute(async(req,res)=>{const a=await db.get('SELECT * FROM albums WHERE id=?',[req.params.id]);if(!a)throw fail(404,'Không tìm thấy bộ ảnh.');res.set('Cache-Control','private,no-store').json(await albumDTO(a,true));}));
 app.get('/api/admin/media-status',asyncRoute(async(req,res)=>res.set('Cache-Control','private,no-store').json(await mediaControl.status())));
 app.get('/api/admin/dashboard',asyncRoute(async(req,res)=>{const albums=await db.all('SELECT status,COUNT(*) AS count FROM albums GROUP BY status');const inquiries=await db.all('SELECT status,COUNT(*) AS count FROM inquiries GROUP BY status');const recent=await db.all('SELECT * FROM inquiries ORDER BY created DESC LIMIT 5');const selections=await selectionSummary();const photos=await db.get('SELECT COUNT(*) AS count FROM photos');const s=await settings();const visible=await db.get("SELECT COUNT(*) AS count FROM albums WHERE status='published' AND EXISTS(SELECT 1 FROM photos WHERE photos.album_id=albums.id)");res.json({albums,inquiries,recent,selections,photos:photos.count,readiness:{contact:!!(s.email||s.phone),portfolio:Number(visible.count)>0,cloud:!!db.cloud&&!!storage.cloud,production}});}));
 app.get('/api/admin/albums',asyncRoute(async(req,res)=>{const rows=await db.all('SELECT * FROM albums ORDER BY created DESC');res.set('Cache-Control','private,no-store').json(req.query.view==='summary'?await adminAlbumSummaries(rows):await albumDTOs(rows,true));}));
  app.post('/api/admin/albums',asyncRoute(async(req,res)=>{const title=clean(req.body.title,150),category=clean(req.body.category),status=clean(req.body.status)||'draft',password=clean(req.body.password,200);const requirePassword=status==='private'?(req.body.require_password!==undefined?Boolean(req.body.require_password):true):false;if((req.body.event_date&&!validDate(clean(req.body.event_date,10)))||!title||!categories.includes(category)||!albumStatuses.includes(status)||(requirePassword&&password.length<8)||(password&&password.length<8))throw fail(422,'Vui lòng kiểm tra tên, thể loại, trạng thái và ngày chụp. Mật khẩu bộ ảnh riêng cần từ 8 ký tự.');const key=id();const slug=await reserveAlbumSlug(db,clean(req.body.slug,150)||title,key);await db.run('INSERT INTO albums(id,slug,title,category,description,status,password,client_name,event_date,created) VALUES(?,?,?,?,?,?,?,?,?,?)',[key,slug,title,category,clean(req.body.description,2000),status,requirePassword?hashPassword(password):null,clean(req.body.client_name,150),clean(req.body.event_date,10),now()]);res.status(201).json({id:key,slug});}));
 app.patch('/api/admin/albums/:id',asyncRoute(async(req,res)=>{
  const title=clean(req.body.title,150),category=clean(req.body.category),status=clean(req.body.status),password=clean(req.body.password,200);
  if((req.body.event_date&&!validDate(clean(req.body.event_date,10)))||!title||!categories.includes(category)||!albumStatuses.includes(status)||(password&&password.length<8))throw fail(422,'Vui lòng kiểm tra tên, thể loại, trạng thái và ngày chụp. Mật khẩu mới cần từ 8 ký tự.');
  const slug=await db.transaction(async tx=>{
   const a=await tx.get('SELECT * FROM albums WHERE id=?'+(tx.cloud?' FOR UPDATE':''),[req.params.id]);
   if(!a)throw fail(404,'Không tìm thấy bộ ảnh.');
   let nextPassword=a.password;
   if(status!=='private'||req.body.require_password===false)nextPassword=null;
   else if(password)nextPassword=hashPassword(password);
   else if(req.body.require_password===true&&!a.password)throw fail(422,'Vui lòng nhập mật khẩu từ 8 ký tự khi cài mật khẩu cho bộ ảnh riêng.');
   let cover=clean(req.body.cover_id)||a.cover_id;
   if(cover&&!await tx.get('SELECT id FROM photos WHERE id=? AND album_id=?',[cover,a.id])){
    if(clean(req.body.cover_id))throw fail(422,'Ảnh bìa không thuộc bộ ảnh này. Vui lòng chọn ảnh khác.');
    cover=(await tx.get('SELECT id FROM photos WHERE album_id=? ORDER BY position,id LIMIT 1',[a.id]))?.id||null;
   }
   const slug=await reserveAlbumSlug(tx,req.body.slug===undefined?(a.slug||title):(clean(req.body.slug,150)||title),a.id);
   await tx.run('UPDATE albums SET slug=?,title=?,category=?,description=?,status=?,password=?,client_name=?,event_date=?,cover_id=? WHERE id=?',[slug,title,category,clean(req.body.description,2000),status,nextPassword,clean(req.body.client_name,150),clean(req.body.event_date,10),cover,a.id]);
   if(nextPassword!==a.password||status!==a.status)await tx.run('DELETE FROM sessions WHERE album_id=?',[a.id]);
   return slug;
  });
  res.json({success:true,slug});
 }));
 app.put('/api/admin/albums/:id/cover',asyncRoute(async(req,res)=>{
  await db.transaction(async tx=>{
   const a=await tx.get('SELECT id FROM albums WHERE id=?'+(tx.cloud?' FOR UPDATE':''),[req.params.id]);
   if(!a)throw fail(404,'Không tìm thấy bộ ảnh.');
   const cover=clean(req.body.cover_id);
   if(!cover||!await tx.get('SELECT id FROM photos WHERE id=? AND album_id=?',[cover,a.id]))throw fail(422,'Ảnh bìa không thuộc bộ ảnh này. Vui lòng chọn ảnh khác.');
   await tx.run('UPDATE albums SET cover_id=? WHERE id=?',[cover,a.id]);
  });
  res.json({success:true});
 }));
 app.put('/api/admin/albums/:id/order',asyncRoute(async(req,res)=>{
  await db.transaction(async tx=>{
   const a=await tx.get('SELECT id FROM albums WHERE id=?'+(tx.cloud?' FOR UPDATE':''),[req.params.id]);if(!a)throw fail(404,'Không tìm thấy bộ ảnh.');
   const order=req.body.photos,existing=new Set((await tx.all('SELECT id FROM photos WHERE album_id=?',[a.id])).map(p=>p.id));
   if(Array.isArray(order)&&order.length>2000)throw fail(422,'Bạn có thể sắp xếp tối đa 2.000 ảnh trong một bộ ảnh.');
   if(!Array.isArray(order)||order.length!==existing.size||new Set(order).size!==order.length||order.some(key=>!existing.has(key)))throw fail(422,'Danh sách ảnh đã thay đổi. Vui lòng tải lại bộ ảnh rồi sắp xếp lại.');
   if(order.length)await tx.run('UPDATE photos SET position=CASE id '+order.map(()=>'WHEN ? THEN CAST(? AS INTEGER)').join(' ')+' END WHERE album_id=? AND id IN ('+order.map(()=>'?').join(',')+')',[...order.flatMap((key,i)=>[key,i]),a.id,...order]);
  });
  res.json({success:true});
 }));
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:maxUploadBytes,files:8,fields:0},fileFilter:(req,file,cb)=>cb(['image/jpeg','image/png','image/webp'].includes(file.mimetype)?null:fail(422,'Vui lòng chọn ảnh định dạng JPEG, PNG hoặc WebP.'),true)});
 app.post('/api/admin/portrait',upload.single('portrait'),asyncRoute(async(req,res)=>{
  if(!req.file)throw fail(422,'Vui lòng chọn ảnh chân dung định dạng JPEG, PNG hoặc WebP.');
  const trace=req.uploadTrace||quietUploadTrace;trace.file(0,req.file.buffer.length);trace.mark('optimize_portrait');
  let data;
  try{const image=sharp(req.file.buffer,{limitInputPixels:40000000});const meta=await image.metadata();if(!['jpeg','png','webp'].includes(meta.format))throw Error('Invalid portrait format');data=await image.rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:86}).toBuffer();}
  catch{throw fail(422,'Không đọc được ảnh chân dung. Vui lòng chọn ảnh JPEG, PNG hoặc WebP khác.');}
  const key=id();let saved=false;
  try{
   await trace.run('store_portrait',()=>storage.put(key+'.webp',data));trace.mark('database_insert');
   await db.transaction(async tx=>{
    const old=await tx.get("SELECT value FROM settings WHERE key='portrait'"+(tx.cloud?' FOR UPDATE':''));
    await tx.run("INSERT INTO settings(key,value) VALUES('portrait',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[key]);
    if(/^[a-f0-9]{32}$/.test(old?.value||''))await tx.run('INSERT INTO photo_cleanup(photo_id,filename,has_download) VALUES(?,?,0) ON CONFLICT(photo_id) DO NOTHING',[old.value,old.value]);
   });saved=true;
  }finally{
   if(!saved){
    const unused=await db.transaction(async tx=>{const current=await tx.get("SELECT value FROM settings WHERE key='portrait'"+(tx.cloud?' FOR UPDATE':''));return current?.value!==key;}).catch(async()=>{await storage.markUncertainPrefix(key);return false;});
    if(unused)await db.run('INSERT INTO photo_cleanup(photo_id,filename,has_download) VALUES(?,?,0) ON CONFLICT(photo_id) DO NOTHING',[key,key]);
   }
   deletedPhotos.schedule();
  }
  res.status(201).json({success:true});
 }));
 app.get('/portrait/:id',asyncRoute(async(req,res)=>{
  res.set('Cache-Control','private,no-store');
  const s=await settings();if(!/^[a-f0-9]{32}$/.test(req.params.id)||s.portrait!==req.params.id)throw fail(404,'Không tìm thấy ảnh.');
  res.type('webp').set({'Cache-Control':'private,no-cache','ETag':'"'+digest(req.params.id)+'"'});
  if(req.fresh)return res.status(304).end();if(req.method==='HEAD')return res.end();
  const controller=new AbortController(),disconnect=()=>controller.abort();res.once('close',disconnect);
  try{const bytes=await storage.get(req.params.id+'.webp',{signal:controller.signal});if(!res.destroyed)res.send(bytes);}finally{res.removeListener('close',disconnect);}
 }));
 const albumUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:maxUploadBytes,files:8,fields:0}});
 app.post('/api/admin/albums/:id/photos',albumUpload.array('photos',8),asyncRoute(async(req,res)=>{
 const trace=req.uploadTrace||quietUploadTrace;trace.mark('validate');
 const a=await db.get('SELECT * FROM albums WHERE id=?',[req.params.id]);if(!a)throw fail(404,'Không tìm thấy bộ ảnh.');if(!req.files?.length)throw fail(422,`Vui lòng chọn ảnh JPEG, PNG, WebP hoặc gói .ccphoto, dung lượng tối đa ${uploadSizeLabel} mỗi ảnh.`);
 let keys=[];if(req.get('X-Upload-Keys')){try{keys=JSON.parse(req.get('X-Upload-Keys'));}catch{throw fail(422,'Không nhận diện được lượt tải ảnh này. Vui lòng chọn lại ảnh rồi thử tải lên.');}if(!Array.isArray(keys)||keys.length!==req.files.length||new Set(keys).size!==keys.length||keys.some(k=>typeof k!=='string'||! /^[a-f0-9-]{32,64}$/.test(k)))throw fail(422,'Không nhận diện được lượt tải ảnh này. Vui lòng chọn lại ảnh rồi thử tải lên.');}
 const sectionId=await validateSection(db,a.id,req.get('X-Album-Section')||null);
 const policy=req.get('X-Duplicate-Policy')||'skip';
 if(!['skip','overwrite'].includes(policy))throw fail(422,'Chọn bỏ qua hoặc ghi đè ảnh trùng tên.');
 const errors=[],results=[];
 for(const [index,file] of req.files.entries()){
  trace.file(index,file.buffer.length);
  try{results.push({index,...await uploadPhoto({db,storage,albumId:a.id,file,uploadKey:keys[index]||null,policy,sectionId,trace,onCleanup:()=>deletedPhotos.schedule()})});}
  catch(error){trace.mark('file_error');errors.push(clean(file.originalname,180));results.push({index,success:false,code:error.retryable===false?error.code:'SAVE_FAILED',error:error.retryable===false?error.message:'Chưa lưu được ảnh vào kho dữ liệu. Vui lòng thử lại.',retryable:error.retryable!==false});}
 }
 const ok=results.some(r=>r.success);
 if(results.some(r=>r.replaced))deletedPhotos.schedule();
 res.status(ok?201:422).json({uploaded:results.filter(r=>r.success&&!r.skipped).length,skipped:results.filter(r=>r.skipped).length,errors,results,error:ok?undefined:'Chưa xử lý được ảnh. Vui lòng kiểm tra định dạng ảnh và dung lượng lưu trữ, rồi thử tải lại.'});
 }));
 app.patch('/api/admin/photos/:id',asyncRoute(async(req,res)=>{const p=await db.get('SELECT * FROM photos WHERE id=?',[req.params.id]);if(!p)throw fail(404,'Không tìm thấy ảnh.');const fields=[],values=[];
  if(req.body.caption!==undefined){fields.push('caption=?');values.push(clean(req.body.caption,300));}
  if(Number.isInteger(req.body.position)){fields.push('position=?');values.push(req.body.position);}
  if(req.body.section_id!==undefined){fields.push('section_id=?');values.push(await validateSection(db,p.album_id,req.body.section_id));}
  if(fields.length)await db.run('UPDATE photos SET '+fields.join(',')+' WHERE id=?',[...values,p.id]);res.json({success:true});}));
 app.post('/api/admin/albums/:id/photos/delete',asyncRoute(async(req,res)=>{const deleted=await deletedPhotos.removeMany(req.params.id,req.body.photos);res.json({success:true,deleted});}));
 app.delete('/api/admin/photos/:id',asyncRoute(async(req,res)=>{await deletedPhotos.remove(req.params.id,{background:true});res.json({success:true});}));
 app.get('/api/admin/albums/:id/selections.csv',asyncRoute(async(req,res)=>{const a=await db.get('SELECT id,title FROM albums WHERE id=?',[req.params.id]);if(!a)throw fail(404,'Không tìm thấy bộ ảnh.');const rows=await db.all('SELECT photos.original,photos.caption,photos.id,album_sections.title AS section FROM photos JOIN selections ON photos.id=selections.photo_id LEFT JOIN album_sections ON album_sections.id=photos.section_id WHERE selections.album_id=? ORDER BY CASE WHEN album_sections.id IS NULL THEN 1 ELSE 0 END,album_sections.position,album_sections.id,photos.position,photos.id',[a.id]);const cell=x=>'"'+String(x||'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';res.type('text/csv; charset=utf-8').set('Cache-Control','private,no-store').attachment(`${albumSlug(a.title)}-anh-da-chon-${today()}.csv`).send('\ufeffID,File,Caption,Section\r\n'+rows.map(r=>[r.id,r.original,r.caption,r.section||'Chưa phân loại'].map(cell).join(',')).join('\r\n'));}));
 app.get('/api/admin/inquiries',asyncRoute(async(req,res)=>res.json(await db.all('SELECT * FROM inquiries ORDER BY created DESC'))));
 app.patch('/api/admin/inquiries/:id',asyncRoute(async(req,res)=>{
  const r=await db.get('SELECT * FROM inquiries WHERE id=?',[req.params.id]);
  if(!r)throw fail(404,'Không tìm thấy yêu cầu tư vấn.');
  const status=req.body.status===undefined?r.status:req.body.status;
  if(!inquiryStatuses.includes(status))throw fail(422,'Trạng thái yêu cầu tư vấn không hợp lệ. Vui lòng chọn lại.');
  if(req.body.date!==undefined&&(typeof req.body.date!=='string'||(req.body.date!==''&&!validDate(req.body.date))))throw fail(422,'Ngày chụp không hợp lệ. Vui lòng chọn lại ngày.');
  const date=req.body.date===undefined?r.date:req.body.date;
  if(date&&date!==r.date&&date<today())throw fail(422,'Vui lòng chọn ngày chụp mới từ hôm nay trở đi.');
  if(req.body.notes!==undefined&&(typeof req.body.notes!=='string'||req.body.notes.length>3000))throw fail(422,'Ghi chú nội bộ không được vượt quá 3.000 ký tự.');
  const notes=req.body.notes===undefined?r.notes:req.body.notes.trim();
  if(status==='confirmed'){
   if(!date)throw fail(422,'Vui lòng chọn ngày chụp trước khi xác nhận lịch.');
   if(r.status!=='confirmed'&&date<today())throw fail(422,'Không thể xác nhận lịch chụp trong quá khứ.');
   if(r.status!=='confirmed'||date!==r.date)await googleCalendar.assertAvailable(date);
   if(await db.get('SELECT date FROM blocked_dates WHERE date=?',[date]))throw fail(409,'Ngày này đang được đánh dấu bận. Vui lòng chọn ngày khác hoặc kiểm tra lại lịch bận.');
  }
  try{await db.run('UPDATE inquiries SET status=?,date=?,notes=? WHERE id=?',[status,date,notes,r.id]);}
  catch(e){if(e.code==='23505'||String(e.message).includes('UNIQUE'))throw fail(409,'Ngày này đã có lịch chụp được xác nhận. Vui lòng chọn ngày khác.');throw e;}
  res.json({success:true});
 }));
 app.get('/api/admin/google-calendar',asyncRoute(async(req,res)=>res.json(await googleCalendar.read())));
 app.get('/api/admin/dates',asyncRoute(async(req,res)=>res.json(await db.all('SELECT * FROM blocked_dates ORDER BY date'))));
 app.post('/api/admin/dates',asyncRoute(async(req,res)=>{const date=clean(req.body.date,10);if(!validDate(date))throw fail(422,'Ngày không hợp lệ. Vui lòng chọn lại ngày.');await db.run('INSERT INTO blocked_dates(date,note) VALUES(?,?) ON CONFLICT(date) DO UPDATE SET note=excluded.note',[date,clean(req.body.note,200)]);res.json({success:true});}));
 app.delete('/api/admin/dates/:date',asyncRoute(async(req,res)=>{await db.run('DELETE FROM blocked_dates WHERE date=?',[req.params.date]);res.json({success:true});}));
 app.patch('/api/admin/settings',asyncRoute(async(req,res)=>{
  const current=await settings(),updates=[];
  for(const key of Object.keys(current)){
   if(req.body[key]===undefined)continue;
   if(key==='portrait') {if(req.body[key]!=='')throw fail(422,'Vui lòng dùng chức năng tải ảnh chân dung để thay ảnh.');updates.push([key,'']);continue;}
   const curated=['heroSelection','storySelection'].includes(key);
   if(typeof req.body[key]!=='string'||req.body[key].length>(curated?12000:['about','intro'].includes(key)?3000:500))throw fail(422,'Nội dung quá dài hoặc không hợp lệ. Vui lòng kiểm tra và rút gọn nội dung.');
   const value=req.body[key].trim();
   if(['brand','headline','name'].includes(key)&&!value)throw fail(422,'Vui lòng điền tên thương hiệu, tên nhiếp ảnh gia và tiêu đề.');
   if(key==='email'&&value&&!validEmail(value))throw fail(422,'Email chưa hợp lệ. Vui lòng kiểm tra lại địa chỉ email.');
   if(key==='phone'&&value&&!/^\+?[0-9 ()-]{8,30}$/.test(value))throw fail(422,'Số điện thoại chưa hợp lệ. Vui lòng kiểm tra lại số đã nhập.');
   if(key==='instagram'&&value&&!/^https:\/\/(www\.)?instagram\.com\/[^\s]*$/.test(value))throw fail(422,'Vui lòng nhập đường dẫn Instagram dạng https://instagram.com/…');
   if(key==='facebook'&&value&&!/^https:\/\/(www\.)?facebook\.com\/[^\s]+$/.test(value))throw fail(422,'Vui lòng nhập đường dẫn Facebook dạng https://www.facebook.com/…');
   if(key==='zalo'&&value&&!/^https:\/\/zalo\.me\/[0-9]+$/.test(value))throw fail(422,'Vui lòng nhập đường dẫn Zalo dạng https://zalo.me/sốđiệnthoại.');
   if(curated&&value){
    let choices;try{choices=JSON.parse(value);}catch{throw fail(422,'Danh sách ảnh chưa hợp lệ. Vui lòng chọn lại ảnh.');}
    if(!Array.isArray(choices)||choices.length>(key==='heroSelection'?4:6))throw fail(422,'Danh sách ảnh chưa hợp lệ hoặc vượt số lượng cho phép. Vui lòng kiểm tra lại.');
    const used=new Set();
    for(const choice of choices){
     if(!choice||typeof choice!=='object'||typeof choice.albumId!=='string'||used.has(choice.albumId))throw fail(422,'Mỗi bộ ảnh chỉ được chọn một lần. Vui lòng kiểm tra lại danh sách.');
     used.add(choice.albumId);
     const a=await db.get("SELECT id FROM albums WHERE id=? AND status='published'",[choice.albumId]);
     if(!a)throw fail(422,'Vui lòng chọn ảnh từ bộ ảnh đang công khai.');
     for(const field of key==='heroSelection'?['wideId','tallId']:['photoId']){
      if(typeof choice[field]!=='string'||!await db.get('SELECT id FROM photos WHERE id=? AND album_id=?',[choice[field],a.id]))throw fail(422,'Ảnh không thuộc bộ ảnh đã chọn. Vui lòng chọn lại ảnh.');
     }
    }
   }
   updates.push([key,value]);
  }
  if(updates.length)await db.transaction(async tx=>{
   const clearing=updates.some(([key,value])=>key==='portrait'&&value==='');
   const previous=clearing?await tx.get("SELECT value FROM settings WHERE key='portrait'"+(tx.cloud?' FOR UPDATE':'')):null;
   await tx.run('INSERT INTO settings(key,value) VALUES '+updates.map(()=>'(?,?)').join(',')+' ON CONFLICT(key) DO UPDATE SET value=excluded.value',updates.flat());
   if(/^[a-f0-9]{32}$/.test(previous?.value||''))await tx.run('INSERT INTO photo_cleanup(photo_id,filename,has_download) VALUES(?,?,0) ON CONFLICT(photo_id) DO NOTHING',[previous.value,previous.value]);
  });
  deletedPhotos.schedule();
  res.json({success:true});
 }));
 app.get('/api/admin/export',asyncRoute(async(req,res)=>{const output={version:2,exported:now()};for(const table of ['settings','albums','photos','selections','inquiries','blocked_dates','album_slugs','album_sections'])output[table]=await db.all('SELECT * FROM '+table);res.attachment('chicong-backup.json').json(output);}));
 app.use('/api',(req,res)=>res.status(404).json({error:'Không tìm thấy chức năng này.'}));
 app.use('/app',express.static(path.resolve('studio/web'),{maxAge:0,index:false}));
 // Services content is retained in web/services.mjs for a future launch.
 app.get('/services',(req,res)=>res.redirect(302,'/'));
 app.get('/bookme',(req,res)=>res.redirect(301,'/contact'));
 app.get('/robots.txt',(req,res)=>res.type('text/plain').send(indexing?`User-agent: *\nDisallow: /admin\nDisallow: /gallery/\nDisallow: /api/\nSitemap: ${(env.SITE_URL||'https://chicongphoto.vn').replace(/\/$/,'')}/sitemap.xml`:'User-agent: *\nDisallow: /'));
 app.get('/sitemap.xml',asyncRoute(async(req,res)=>{
  const url=(env.SITE_URL||'https://chicongphoto.vn').replace(/\/$/,'');
  const albums=await db.all("SELECT slug,created FROM albums WHERE status='published' ORDER BY created DESC");
  const today=new Date().toISOString().slice(0,10);
  const pages=[
   {loc:'/',priority:'1.0',changefreq:'weekly'},
   {loc:'/portfolio',priority:'0.9',changefreq:'daily'},
   {loc:'/about',priority:'0.8',changefreq:'monthly'},
   {loc:'/contact',priority:'0.8',changefreq:'monthly'},
   ...albums.map(a=>({loc:'/album/'+a.slug,lastmod:(a.created||today).slice(0,10),priority:'0.8',changefreq:'monthly'}))
  ];
  const xml='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+
   pages.map(p=>`  <url>\n    <loc>${url+p.loc}</loc>\n    <lastmod>${p.lastmod||today}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`).join('\n')+'\n</urlset>';
  res.type('application/xml; charset=utf-8').send(xml);
 }));
 const shell=await readFile(path.resolve('studio/web/index.html'),'utf8');
 const cfToken=env.ANALYTICS_ENABLED==='false'?'':env.CF_BEACON_TOKEN||env.CLOUDFLARE_ANALYTICS_TOKEN||(production?'fd0f089e6f094baca1d372c934fa801d':'');
 const cfBeacon=cfToken?`<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${escape(cfToken)}"}'></script>`:'';
 const page=asyncRoute(async(req,res)=>{
  const s=await settings();
  const cards=['/','/portfolio'].includes(req.path)?await portfolioCards(s):undefined;
  const hero=req.path==='/'?homeHeroSlides(cards,s.storySelection,s.heroSelection)[0]:undefined;
  const escape=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const titles={'/':s.brand+' · '+s.tagline,'/portfolio':'Bộ ảnh · '+s.brand,'/about':'Giới thiệu · '+s.brand,'/contact':'Liên hệ & tư vấn · '+s.brand,'/admin':'Quản trị · '+s.brand};
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
  }else if(cards){const first=cards.find(a=>a.photos.length);imagePhoto=hero?.wide.id||first?.photos.find(p=>p.id===first.cover_id)?.id||first?.photos[0]?.id;}
  else if(!privatePage)imagePhoto=(await db.get("SELECT photos.id FROM photos JOIN albums ON photos.album_id=albums.id WHERE albums.status='published' ORDER BY CASE WHEN photos.id=albums.cover_id THEN 0 ELSE 1 END, albums.created DESC,photos.position LIMIT 1"))?.id;
  const url=(env.SITE_URL||'https://chicongphoto.vn').replace(/\/$/,'');
  res.set('Cache-Control',privatePage?'private,no-store':'private,no-cache');
  const og=imagePhoto&&!privatePage?`<meta property="og:image" content="${escape(url+'/media/'+imagePhoto)}">`:'';
  const structuredData=!privatePage&&res.statusCode!==404?schemaOrgScript(buildSchemaOrg({site:s,album:matchedAlbum,url,imagePhoto,path:canonicalPath})):'';
  const analytics=!privatePage&&res.statusCode!==404?cfBeacon:'';
  let initialBody='';
  if(!privatePage&&res.statusCode!==404){
   if(req.path==='/'){
    initialBody=`<main id="main"><section class="hero-intro"><h1>${escape(s.headline).replace(/\n/g,'<br>')}</h1><p>${escape(s.intro)}</p></section><section class="about-summary"><h2>Về ${escape(s.name||s.brand)}</h2><p>${escape(s.about).replace(/\n/g,'<br>')}</p></section></main>`;
   }else if(req.path==='/about'){
    initialBody=`<main id="main"><h1>Giới thiệu · ${escape(s.brand)}</h1><p>${escape(s.about).replace(/\n/g,'<br>')}</p></main>`;
   }else if(req.path==='/contact'){
    initialBody=`<main id="main"><h1>Liên hệ &amp; tư vấn</h1><p>${escape(s.bookingNote||s.intro)}</p><p>${escape(inquiryNotice)}</p>${s.phone?`<p>Điện thoại: ${escape(s.phone)}</p>`:''}${s.email?`<p>Email: ${escape(s.email)}</p>`:''}${s.zalo?`<p><a href="${escape(s.zalo)}">Nhắn qua Zalo</a></p>`:''}</main>`;
   }else if(req.path==='/portfolio'){
    const list=cards;
    initialBody=`<main id="main"><h1>Bộ ảnh · ${escape(s.brand)}</h1><p>${escape(s.intro)}</p><ul>${list.map(a=>`<li><a href="/album/${a.slug}">${escape(a.title)}</a></li>`).join('')}</ul></main>`;
   }else if(matchedAlbum){
    initialBody=`<main id="main"><h1>${escape(matchedAlbum.title)}</h1><p>${escape(matchedAlbum.description||s.intro)}</p></main>`;
   }
  }
  // Match the loading container independently of its user-facing wording.
  const bodyShell=initialBody?shell.replace(/<main id="main" class="loading">[\s\S]*?<\/main>/,()=>initialBody):shell;
  // Only public data goes into HTML; escape script delimiters without enabling inline JS.
  const pageData=!privatePage&&res.statusCode!==404?`<script type="application/json" id="page-data">${JSON.stringify({path:req.path,site:s,...(cards?{albums:cards}:{})}).replace(/</g,'\\u003c')}</script>`:'';
  const preload=hero?[['(max-width:750px)',hero.tall,heroMobileSizes(hero.tall)],['(min-width:750.01px)',hero.wide,heroDesktopSizes]].map(([media,photo,sizes])=>`<link rel="preload" as="image" fetchpriority="high" media="${media}" href="${escape(photo.thumb)}" imagesrcset="${escape(imageSources(photo))}" imagesizes="${sizes}">`).join(''):'';
  const values={__TITLE__:escape(title),__DESCRIPTION__:escape(description),__CANONICAL__:escape(url+canonicalPath),__ROBOTS__:!indexing||privatePage||res.statusCode===404?'noindex,nofollow':'index,follow',__OG_META__:og+preload,__STRUCTURED_DATA__:structuredData+pageData,__ANALYTICS__:analytics};
  res.send(bodyShell.replace(/__TITLE__|__DESCRIPTION__|__CANONICAL__|__ROBOTS__|__OG_META__|__STRUCTURED_DATA__|__ANALYTICS__/g,key=>values[key]));
 });
 app.get(['/', '/portfolio','/about','/contact','/admin','/album/:key','/gallery/:id'],page);
 app.use((req,res)=>res.status(404).send(shell.replaceAll('__TITLE__','Không tìm thấy trang').replaceAll('__DESCRIPTION__','').replaceAll('__CANONICAL__','').replaceAll('__ROBOTS__','noindex').replaceAll('__OG_META__','').replaceAll('__STRUCTURED_DATA__','').replaceAll('__ANALYTICS__','')));
 app.use((err,req,res,next)=>{if(res.headersSent)return next(err);if(err.code==='MEDIA_LOCKED')return res.status(503).set('Retry-After','30').json({code:err.code,error:err.message});const status=err instanceof multer.MulterError?422:err.status||500;if(status>=500)console.error('Request failed:',err.name);res.status(status).json({...(err.fields?{fields:err.fields}:{}),error:status>=500?'Hệ thống chưa xử lý được thao tác này. Vui lòng thử lại sau ít phút.':err instanceof multer.MulterError?`Mỗi lần tải tối đa 8 ảnh, dung lượng tối đa ${uploadSizeLabel} mỗi ảnh.`:err.message});});
 return {app,db,storage,mailer,mediaControl,photoCleanup:deletedPhotos};
}
