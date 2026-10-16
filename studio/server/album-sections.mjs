import {id} from './db.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const route=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
const title=value=>{
 if(typeof value!=='string'||!value.trim()||value.trim().length>120)throw fail(422,'Tên phần cần có từ 1 đến 120 ký tự.');
 return value.trim();
};
const position=value=>{
 if(!Number.isInteger(value)||value<0||value>2147483647)throw fail(422,'Thứ tự phần không hợp lệ.');
 return value;
};
export async function validateSection(db,albumId,sectionId){
 if(sectionId===null)return null;
 if(typeof sectionId!=='string'||!await db.get('SELECT id FROM album_sections WHERE id=? AND album_id=?',[sectionId,albumId]))throw fail(422,'Phần đã chọn không thuộc bộ ảnh này. Vui lòng tải lại bộ ảnh.');
 return sectionId;
}
// Registered after the shared admin authentication middleware.
export function registerSectionRoutes(app,db,routeWrapper=route){
 const route=routeWrapper;
 const album=async key=>{if(!await db.get('SELECT id FROM albums WHERE id=?',[key]))throw fail(404,'Không tìm thấy bộ ảnh.');};
 const section=async key=>{const value=await db.get('SELECT * FROM album_sections WHERE id=?',[key]);if(!value)throw fail(404,'Không tìm thấy phần ảnh.');return value;};
 app.get('/api/admin/albums/:id/sections',route(async(req,res)=>{
  await album(req.params.id);res.json(await db.all('SELECT id,title,position FROM album_sections WHERE album_id=? ORDER BY position,id',[req.params.id]));
 }));
 app.post('/api/admin/albums/:id/sections',route(async(req,res)=>{
  await album(req.params.id);const name=title(req.body.title);
  if(req.body.request_id!==undefined&&(typeof req.body.request_id!=='string'||!/^[a-f0-9]{32}$/.test(req.body.request_id)))throw fail(422,'Mã tạo phần không hợp lệ. Vui lòng tải lại trang.');
  const key=req.body.request_id||id();
  const at=position(req.body.position===undefined?Number((await db.get('SELECT COALESCE(MAX(position),-1)+1 AS next FROM album_sections WHERE album_id=?',[req.params.id])).next):req.body.position);
  await db.run('INSERT INTO album_sections(id,album_id,title,position) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING',[key,req.params.id,name,at]);
  const saved=await db.get('SELECT * FROM album_sections WHERE id=?',[key]);
  if(!saved||saved.album_id!==req.params.id||saved.title!==name)throw fail(409,'Lượt tạo phần này đã được lưu với nội dung khác. Vui lòng tải lại bộ ảnh.');
  res.status(201).json({id:saved.id,title:saved.title,position:saved.position});
 }));
 app.patch('/api/admin/sections/:id',route(async(req,res)=>{
  const s=await section(req.params.id),fields=[],values=[];
  if(req.body.title!==undefined){fields.push('title=?');values.push(title(req.body.title));}
  if(req.body.position!==undefined){fields.push('position=?');values.push(position(req.body.position));}
  if(fields.length)await db.run('UPDATE album_sections SET '+fields.join(',')+' WHERE id=?',[...values,s.id]);res.json({success:true});
 }));
 app.delete('/api/admin/sections/:id',route(async(req,res)=>{
  const s=await section(req.params.id);await db.run('DELETE FROM album_sections WHERE id=?',[s.id]);res.json({success:true});
 }));
 app.put('/api/admin/albums/:id/sections/order',route(async(req,res)=>{
  await album(req.params.id);const existing=await db.all('SELECT id FROM album_sections WHERE album_id=?',[req.params.id]),order=req.body.sections,ids=new Set(existing.map(s=>s.id));
  if(!Array.isArray(order)||order.length>2000||order.length!==ids.size||new Set(order).size!==order.length||order.some(key=>!ids.has(key)))throw fail(422,'Danh sách phần đã thay đổi. Vui lòng tải lại bộ ảnh rồi sắp xếp lại.');
  if(order.length)await db.run('UPDATE album_sections SET position=CASE id '+order.map(()=>'WHEN ? THEN CAST(? AS INTEGER)').join(' ')+' ELSE position END WHERE album_id=?',[...order.flatMap((key,i)=>[key,i]),req.params.id]);
  res.json({success:true});
 }));
 app.put('/api/admin/albums/:id/photos/sections',route(async(req,res)=>{
  await album(req.params.id);const assignments=req.body.assignments;
  if(!Array.isArray(assignments)||!assignments.length||assignments.length>1000||assignments.some(a=>!a||typeof a.photo_id!=='string'||!(a.section_id===null||typeof a.section_id==='string'))||new Set(assignments.map(a=>a.photo_id)).size!==assignments.length)throw fail(422,'Chọn từ 1 đến 1.000 ảnh khác nhau để chuyển phần.');
  const [photos,sections]=await Promise.all([db.all('SELECT id FROM photos WHERE album_id=?',[req.params.id]),db.all('SELECT id FROM album_sections WHERE album_id=?',[req.params.id])]);
  const photoIds=new Set(photos.map(p=>p.id)),sectionIds=new Set(sections.map(s=>s.id));
  if(assignments.some(a=>!photoIds.has(a.photo_id)||(a.section_id!==null&&!sectionIds.has(a.section_id))))throw fail(422,'Ảnh hoặc phần không thuộc bộ ảnh này. Vui lòng tải lại bộ ảnh.');
  // A single statement makes the entire assignment atomic on both SQLite and Postgres.
  await db.run('UPDATE photos SET section_id=CASE id '+assignments.map(()=>'WHEN ? THEN CAST(? AS TEXT)').join(' ')+' END WHERE album_id=? AND id IN ('+assignments.map(()=>'?').join(',')+')',[...assignments.flatMap(a=>[a.photo_id,a.section_id]),req.params.id,...assignments.map(a=>a.photo_id)]);
  res.json({success:true,updated:assignments.length});
 }));
}
