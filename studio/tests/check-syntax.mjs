import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
for(const directory of ['studio/server','studio/web']){
 for(const file of readdirSync(directory).filter(file=>/\.(m?js)$/.test(file))){
  const check=spawnSync(process.execPath,['--check',directory+'/'+file],{stdio:'inherit'});
  if(check.status!==0)process.exit(check.status||1);
 }
}
console.log('Server and frontend JavaScript syntax verified.');
