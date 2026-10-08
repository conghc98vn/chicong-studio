// Browser failure scenarios on disposable data only. Never mounted by production.
import express from 'express';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.mjs';
const dir=await mkdtemp(path.join(tmpdir(),'chicong-consultation-'));
const {app,db}=await createApp({dataDir:dir,env:{},seed:false});
await db.run("UPDATE settings SET value='0900000000' WHERE key='phone'");
const wrapper=express();let calendarFailed=false,responseDropped=false;
wrapper.get('/api/availability',(req,res,next)=>{
 if(!calendarFailed){calendarFailed=true;return res.status(503).json({error:'Temporary fixture failure'});}next();
});
wrapper.get('/api/portfolio',(req,res)=>res.status(503).json({error:'Portfolio intentionally unavailable in fixture'}));
wrapper.post('/api/inquiries',(req,res,next)=>{
 const end=res.end;
 res.end=function(...args){
  if(res.statusCode===201&&!responseDropped){responseDropped=true;setTimeout(async()=>{if(req.body.date)await db.run("INSERT INTO blocked_dates(date,note) VALUES(?,'Retry regression') ON CONFLICT(date) DO NOTHING",[req.body.date]);req.socket.destroy();console.log('Simulated lost response after commit; selected date is now blocked');},5000);return res;}
  return end.apply(this,args);
 };next();
});
wrapper.use(app);
const server=wrapper.listen(4180,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://localhost:4180/contact',dir})));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(async()=>{console.log(JSON.stringify({savedRequests:(await db.all('SELECT id FROM inquiries')).length}));await db.close();await rm(dir,{recursive:true,force:true});process.exit(0);}));
