import {createApp} from './app.mjs';
const {app,db,storage,photoCleanup,mediaControl,feedbackDispatcher,inquiryDispatcher}=await createApp();
const port=Number(process.env.PORT||4173);const host=process.env.HOST||(process.env.NODE_ENV==='production'?'0.0.0.0':'127.0.0.1');
const server=app.listen(port,host,()=>console.log(`ChiCong Studio → http://localhost:${port}\nQuản trị → http://localhost:${port}/admin`));
feedbackDispatcher.start();
inquiryDispatcher.start();
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
 if(stopping)return;stopping=true;
 const drained=Promise.all([feedbackDispatcher.stop(),inquiryDispatcher.stop()]);
 server.close(async()=>{await drained;await photoCleanup.close();await mediaControl.close();storage.close?.();await db.close();process.exit(0);});
});
