import {DatabaseSync} from 'node:sqlite';
import {existsSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(existsSync(path.join(root,'.env')))process.loadEnvFile(path.join(root,'.env'));
const source=path.resolve(process.env.DATA_DIR||path.join(root,'data'),'arena.sqlite');
if(!existsSync(source))throw new Error('Database does not exist');
const directory=path.resolve(process.argv[2]||path.join(root,'backups'));mkdirSync(directory,{recursive:true});
const target=path.join(directory,`arena-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);
const db=new DatabaseSync(source);try{db.exec('PRAGMA busy_timeout=15000');db.exec(`VACUUM INTO '${target.replaceAll("'","''")}'`);}finally{db.close();}
console.log(`Consistent SQLite snapshot: ${target}`);
