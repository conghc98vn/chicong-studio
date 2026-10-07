import {createApp} from './app.mjs';
const {app,db}=await createApp();
const port=Number(process.env.PORT||4173);const host=process.env.NODE_ENV==='production'?'0.0.0.0':'127.0.0.1';
const server=app.listen(port,host,()=>console.log(`ChiCong Studio → http://localhost:${port}\nQuản trị → http://localhost:${port}/admin`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(async()=>{await db.close();process.exit(0);}));
