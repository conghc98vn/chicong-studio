import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import path from 'node:path';
import {openDatabase,hashPassword} from './db.mjs';
if(!process.stdin.isTTY)throw Error('Run this command in an interactive terminal.');
class PromptOutput extends Writable{muted=false;_write(chunk,encoding,done){if(!this.muted)process.stdout.write(chunk,encoding);done();}}
const output=new PromptOutput();const prompt=createInterface({input:process.stdin,output,terminal:true});
async function secret(label){output.muted=false;const promise=prompt.question(label);output.muted=true;const value=await promise;output.muted=false;process.stdout.write('\n');return value.trim();}
let db;
try{const email=(await prompt.question('Email quản trị cần khôi phục: ')).trim();db=await openDatabase(process.env.DATA_DIR||path.resolve('data/live'));const admin=await db.get('SELECT id FROM admins WHERE email=?',[email]);if(!admin)throw Error('Không tìm thấy tài khoản này.');const password=await secret('Mật khẩu mới (ít nhất 12 ký tự): ');const confirm=await secret('Nhập lại mật khẩu: ');if(password.length<12||password.length>200||password!==confirm)throw Error('Mật khẩu chưa hợp lệ hoặc không khớp.');await db.run('UPDATE admins SET password=? WHERE id=?',[hashPassword(password),admin.id]);await db.run('DELETE FROM sessions WHERE admin_id=?',[admin.id]);console.log('Đã đổi mật khẩu và vô hiệu các phiên quản trị cũ.');}finally{prompt.close();await db?.close();}
