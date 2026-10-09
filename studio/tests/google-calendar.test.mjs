import test from 'node:test';
import assert from 'node:assert/strict';
import {busyDays,createGoogleCalendar} from '../server/google-calendar.mjs';
const now=new Date('2026-10-09T12:00:00Z');
const feed=(...events)=>['BEGIN:VCALENDAR','VERSION:2.0',...events.map((e,i)=>`BEGIN:VEVENT\r\nUID:${i}\r\n${e}\r\nEND:VEVENT`),'END:VCALENDAR'].join('\r\n');
test('Google busy days honor Vietnam midnight, exclusive all-day ends, free and cancelled events',()=>{
 const result=busyDays(feed('DTSTART:20261010T160000Z\r\nDTEND:20261010T180000Z','DTSTART;VALUE=DATE:20261013\r\nDTEND;VALUE=DATE:20261015','DTSTART;VALUE=DATE:20261016\r\nTRANSP:TRANSPARENT','DTSTART;VALUE=DATE:20261017\r\nSTATUS:CANCELLED'),now);
 assert.deepEqual(result.blocked,['2026-10-10','2026-10-11','2026-10-13','2026-10-14']);
});
test('Recurring events honor excluded and moved instances',()=>{
 const source=feed('DTSTART:20261010T020000Z\r\nDTEND:20261010T030000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEXDATE:20261011T020000Z') .replace('END:VCALENDAR','BEGIN:VEVENT\r\nUID:0\r\nRECURRENCE-ID:20261012T020000Z\r\nDTSTART:20261015T020000Z\r\nDTEND:20261015T030000Z\r\nEND:VEVENT\r\nEND:VCALENDAR');
 assert.deepEqual(busyDays(source,now).blocked,['2026-10-10','2026-10-15']);
});
test('Sync caches requests, hides feed secrets and fails closed after fetch failure',async()=>{
 let time=+now,calls=0,broken=false;
 const calendar=createGoogleCalendar({GOOGLE_CALENDAR_ICS_URL:'https://calendar.google.com/calendar/ical/test/private-secret/basic.ics'},async()=>{calls++;if(broken)throw Error('private-secret');return new Response(feed('DTSTART;VALUE=DATE:20261010\r\nSUMMARY:Private appointment'));},()=>new Date(time));
 const first=await calendar.read();assert.deepEqual(first.blocked,['2026-10-10']);
 await assert.rejects(calendar.assertAvailable('2026-10-10'),{status:409});
 await calendar.assertAvailable('2026-10-11');assert.equal(calls,1);
 assert.doesNotMatch(JSON.stringify(first),/secret|appointment/);
 time+=300001;broken=true;const stale=await calendar.read();assert.equal(stale.unavailable,true);assert.deepEqual(stale.blocked,first.blocked);
 await assert.rejects(calendar.assertAvailable('2026-10-11'),{status:409});
});
test('Disabled sync stays optional and malformed feed is not accepted as empty',async()=>{
 await createGoogleCalendar().assertAvailable('2099-01-01');
 assert.throws(()=>busyDays('<html>Sign in</html>',now));
 const calendar=createGoogleCalendar({GOOGLE_CALENDAR_ICS_URL:'https://example.com/private'},()=>{throw Error('must not fetch');});
 assert.equal((await calendar.read()).unavailable,true);
});
test('Routes merge Google dates, enforce booking conflicts and protect sync details',async()=>{
 const {createApp}=await import('../server/app.mjs');
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'google-calendar-'));
 const googleCalendar=createGoogleCalendar({GOOGLE_CALENDAR_ICS_URL:'https://calendar.google.com/calendar/ical/test/private-secret/basic.ics'},async()=>new Response(feed('DTSTART;VALUE=DATE:20261020')),()=>now);
 const {app,db}=await createApp({dataDir:dir,env:{},googleCalendar,seed:false,origin:'http://localhost'});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  await db.run('INSERT INTO blocked_dates(date,note) VALUES(?,?)',['2026-10-21','Private studio note']);
  const state=await (await fetch(base+'/api/availability')).json();assert.deepEqual(state.blocked.sort(),['2026-10-20','2026-10-21']);assert.doesNotMatch(JSON.stringify(state),/private|secret/i);
  assert.equal((await fetch(base+'/api/admin/google-calendar')).status,401);
  const response=await fetch(base+'/api/inquiries',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify({name:'Calendar test',email:'test@example.com',service:'Ngày cưới',date:'2026-10-20',message:'Checking calendar conflict'})});assert.equal(response.status,409);
  assert.ok((await response.json()).fields.date);
  assert.equal((await db.all('SELECT * FROM inquiries')).length,0);
 }finally{await new Promise(r=>server.close(r));await db.close();await rm(dir,{recursive:true,force:true});}
});
test('The final selectable day includes timed events through Vietnam midnight',async()=>{
 const source=feed('DTSTART:20281008T020000Z\r\nDTEND:20281008T030000Z','DTSTART:20281008T165959Z\r\nDTEND:20281008T173000Z');
 const calendar=createGoogleCalendar({GOOGLE_CALENDAR_ICS_URL:'https://calendar.google.com/calendar/ical/test/private-secret/basic.ics'},async()=>new Response(source),()=>now);
 const state=await calendar.read();
 assert.equal(state.through,'2028-10-08');
 assert.deepEqual(state.blocked,['2028-10-08']);
 await assert.rejects(calendar.assertAvailable(state.through),error=>error.status===409&&!!error.fields?.date);
 await assert.rejects(calendar.assertAvailable('2028-10-09'),error=>error.status===409&&!!error.fields?.date);
});
test('Owner mode includes free all-day photo bookings but still excludes cancellations',async()=>{
 const source=feed('DTSTART;VALUE=DATE:20261010\r\nDTEND;VALUE=DATE:20261011\r\nTRANSP:TRANSPARENT','DTSTART;VALUE=DATE:20261025\r\nTRANSP:TRANSPARENT','DTSTART;VALUE=DATE:20261031\r\nDTEND;VALUE=DATE:20261102\r\nTRANSP:TRANSPARENT','DTSTART;VALUE=DATE:20261020\r\nTRANSP:TRANSPARENT\r\nSTATUS:CANCELLED');
 assert.deepEqual(busyDays(source,now).blocked,[]);
 const calendar=createGoogleCalendar({GOOGLE_CALENDAR_ICS_URL:'https://calendar.google.com/calendar/ical/test/private-secret/basic.ics',GOOGLE_CALENDAR_INCLUDE_FREE:'true'},async()=>new Response(source),()=>now);
 const state=await calendar.read();assert.equal(state.includeTransparent,true);assert.deepEqual(state.blocked,['2026-10-10','2026-10-25','2026-10-31','2026-11-01']);
 await assert.rejects(calendar.assertAvailable('2026-10-25'),{status:409});
});
