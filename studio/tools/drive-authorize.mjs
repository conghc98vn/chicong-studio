#!/usr/bin/env node
import http from 'node:http';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const env=process.env,output=process.argv[2];
if(!env.BACKUP_DRIVE_CLIENT_ID||!env.BACKUP_DRIVE_CLIENT_SECRET)throw Error('Configure a Google Desktop OAuth client ID and secret in the environment');
if(!output||!/^\.env\..+/.test(path.basename(output))||path.basename(output)==='.env.example')throw Error('Choose a new ignored secret file, for example .env.backup-drive');
const state=randomBytes(32).toString('hex'),verifier=randomBytes(48).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');
let used=false,timer,redirect;
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  if(req.method!=='GET'||url.pathname!=='/callback'||url.searchParams.get('state')!==state||used){res.writeHead(400).end('Invalid OAuth callback');return;}
  used=true;if(!url.searchParams.get('code'))throw Error('Drive authorization was not granted');
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.BACKUP_DRIVE_CLIENT_ID,client_secret:env.BACKUP_DRIVE_CLIENT_SECRET,code:url.searchParams.get('code'),code_verifier:verifier,redirect_uri:redirect,grant_type:'authorization_code'}),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('OAuth code exchange failed');const tokens=await response.json();
  if(!tokens.refresh_token||!tokens.access_token)throw Error('No offline refresh token was issued');
  if(tokens.scope&&!tokens.scope.split(' ').includes('https://www.googleapis.com/auth/drive.file'))throw Error('drive.file scope was not granted');
  const about=await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',{headers:{Authorization:'Bearer '+tokens.access_token},signal:AbortSignal.timeout(30000)});
  if(!about.ok)throw Error('Cannot verify Drive account');const account=(await about.json()).user?.emailAddress;
  if(!account||env.BACKUP_DRIVE_ACCOUNT_EMAIL&&account.toLowerCase()!==env.BACKUP_DRIVE_ACCOUNT_EMAIL.toLowerCase())throw Error('Drive account does not match the requested owner');
  const secrets={BACKUP_DRIVE_CLIENT_ID:env.BACKUP_DRIVE_CLIENT_ID,BACKUP_DRIVE_CLIENT_SECRET:env.BACKUP_DRIVE_CLIENT_SECRET,BACKUP_DRIVE_REFRESH_TOKEN:tokens.refresh_token,BACKUP_DRIVE_ACCOUNT_EMAIL:account};
  await writeFile(output,Object.entries(secrets).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n')+'\n',{mode:0o600,flag:'wx'});
  res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}).end('Đã lưu quyền backup Drive trên máy. Bạn có thể đóng cửa sổ này.');
  console.log('Drive authorization saved to the selected private env file. No token was printed.');
 }catch{res.writeHead(400).end('Authorization could not be saved. Check account, OAuth settings and output file; no token was printed.');process.exitCode=1;}
 finally{if(used){clearTimeout(timer);server.close();}}
});
server.listen(0,'127.0.0.1',()=>{
 redirect='http://127.0.0.1:'+server.address().port+'/callback';
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:env.BACKUP_DRIVE_CLIENT_ID,redirect_uri:redirect,response_type:'code',scope:'https://www.googleapis.com/auth/drive.file',access_type:'offline',prompt:'consent',state,code_challenge:challenge,code_challenge_method:'S256'});
 console.log('Open this URL and authorize the intended personal Google Drive account:\n'+url.href);
 timer=setTimeout(()=>{console.error('Drive authorization timed out');process.exitCode=1;server.close();},240000);
});
