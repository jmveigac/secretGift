const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID,randomBytes}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {LocalStore}=require('../build/web/store');
const {EncryptedDatabase}=require('../build/web/database');
const mail={configured:false,send:async()=>assert.fail('SMTP forbidden')};
async function fixture(){
 await fs.mkdir('.task/tests',{recursive:true});
 const root=await fs.mkdtemp(path.resolve('.task/tests/sqlite-'));
 const file=path.join(root,'data/state.sqlite'), key=path.join(root,'keys/storage.key'), legacy=path.join(root,'data/state.json');
 const store=()=>new LocalStore(file,15,mail,key);
 return {root,file,key,legacy,store};
}
const person=n=>({name:`Synthetic Person ${n}`,email:`synthetic${n}@example.invalid`,previousId:null});
function legacyState(){
 const participants=[1,2,3,4].map(n=>({id:randomUUID(),...person(n)}));
 participants[0].previousId=participants[3].id;
 return {version:1,participants,draw:{completedAt:'2026-01-01T00:00:00.000Z',deliveryRevision:randomUUID(),assignments:participants.map((p,i)=>({giver:p.id,receiver:participants[(i+1)%4].id})),deliveries:Object.fromEntries(participants.map((p,i)=>[p.id,['pending','uncertain','accepted','failed'][i]]))}};
}
async function seed(f,state){await fs.mkdir(path.dirname(f.legacy),{recursive:true});await fs.writeFile(f.legacy,JSON.stringify(state));}
async function inspect(f){return EncryptedDatabase.open(f.file,f.key,f.legacy,()=>{});}
test('empty installation, authenticated round trip, separate restrictive key and restart',async()=>{
 const f=await fixture();assert.equal((await f.store().status()).participants.length,0);
 await f.store().mutate('add',person(1));assert.equal((await f.store().status()).participants[0].name,person(1).name);
 assert.equal((await fs.stat(f.file)).mode&0o777,0o600);assert.equal((await fs.stat(f.key)).mode&0o777,0o600);
 assert.equal((await fs.stat(path.dirname(f.key))).mode&0o777,0o700);
 assert.equal((await fs.readFile(f.key)).length,32);
});
test('migration preserves IDs, exclusions, private assignments, revisions, every delivery state and original JSON',async()=>{
 const f=await fixture(), state=legacyState();await seed(f,state);const original=await fs.readFile(f.legacy);
 const view=await f.store().status();assert.equal(view.draw.completed,true);
 for(const status of ['pending','uncertain','accepted','failed'])assert.equal(view.delivery[status],1);
 let db=await inspect(f);assert.deepEqual(db.read(),state);db.close();
 assert.deepEqual(await fs.readFile(f.legacy),original);
 await fs.writeFile(f.legacy,'invalid JSON ignored once SQLite exists');
 assert.deepEqual((await f.store().status()).participants,state.participants);
 db=await inspect(f);assert.deepEqual(db.read(),state);db.close();
 assert.doesNotMatch(JSON.stringify(view),/assignments|receiver|giver|storage.key/);
});
test('persistent key without SQLite or legacy data fails closed, then accepts the restored database',async()=>{
 const f=await fixture();await f.store().mutate('add',person(1));
 const key=await fs.readFile(f.key), before=await fs.readFile(f.file);
 await fs.rename(path.dirname(f.file),path.join(f.root,'saved-data'));
 for(let attempt=0;attempt<2;attempt++){
  await assert.rejects(f.store().status(),/Storage database missing: restore the database with its original key/);
  await assert.rejects(fs.stat(f.file),{code:'ENOENT'});
  assert.deepEqual(await fs.readFile(f.key),key);
  assert.equal((await fs.readdir(path.dirname(f.file))).some(name=>name.endsWith('.initializing')),false);
 }
 const {spawnSync}=require('node:child_process');
 const startup=spawnSync(process.execPath,['build/web/server.js'],{
  env:{...process.env,DATA_FILE:f.file,DATA_KEY_FILE:f.key},encoding:'utf8',timeout:10000
 });
 assert.ifError(startup.error);assert.equal(startup.status,1);
 assert.match(startup.stderr,/Falta la base SQLite, pero existe la clave: restaura la base con su clave original/);
 await assert.rejects(fs.stat(f.file),{code:'ENOENT'});
 await fs.copyFile(path.join(f.root,'saved-data/state.sqlite'),f.file);
 assert.deepEqual((await f.store().status()).participants.map(({id,...p})=>p),[person(1)]);
 assert.deepEqual(await fs.readFile(f.file),before);
});
test('restoring SQLite with its matching key preserves the entire state without legacy JSON',async()=>{
 const source=await fixture(),state=legacyState();await seed(source,state);await source.store().status();
 const restored=await fixture();
 await fs.mkdir(path.dirname(restored.file),{recursive:true});await fs.mkdir(path.dirname(restored.key),{recursive:true});
 await fs.copyFile(source.file,restored.file);await fs.copyFile(source.key,restored.key);
 await restored.store().status();
 const db=await inspect(restored);try{assert.deepEqual(db.read(),state);}finally{db.close();}
});
test('legacy participants without draw migrate without import of CLI historical files',async()=>{
 const f=await fixture(),state=legacyState();state.draw=null;await seed(f,state);
 assert.deepEqual((await f.store().status()).participants,state.participants);
});
test('invalid, incomplete and impossible legacy data cannot publish a database',async()=>{
 for(const data of ['{bad','{}',JSON.stringify({...legacyState(),version:2}),JSON.stringify({...legacyState(),participants:[]})]){
  const f=await fixture();await fs.mkdir(path.dirname(f.file),{recursive:true});await fs.writeFile(f.legacy,data);
  await assert.rejects(f.store().status());await assert.rejects(fs.stat(f.file),{code:'ENOENT'});assert.equal(await fs.readFile(f.legacy,'utf8'),data);
 }
});
test('interrupted migration is retried atomically without changing original data',async()=>{
 const f=await fixture(),state=legacyState();await seed(f,state);
 const rename=fs.rename;fs.rename=async()=>{throw new Error('synthetic publication interruption');};
 try{await assert.rejects(f.store().status());}finally{fs.rename=rename;}
 await assert.rejects(fs.stat(f.file),{code:'ENOENT'});
 const db=await inspect(f);assert.deepEqual(db.read(),state);db.close();
 assert.deepEqual(JSON.parse(await fs.readFile(f.legacy,'utf8')),state);
});
test('wrong or missing key fails without regenerating key or modifying database',async()=>{
 const f=await fixture();await f.store().mutate('add',person(1));const originalKey=await fs.readFile(f.key), before=await fs.readFile(f.file);
 await fs.writeFile(f.key,randomBytes(32));await assert.rejects(f.store().status());assert.deepEqual(await fs.readFile(f.file),before);
 // Move within the controlled repository to simulate loss without deleting the key.
 await fs.rename(f.key,f.key+'.saved');await assert.rejects(f.store().status());await assert.rejects(fs.stat(f.key),{code:'ENOENT'});
 assert.deepEqual(await fs.readFile(f.file),before);await fs.writeFile(f.key,originalKey);
 assert.equal((await f.store().status()).participants.length,1);
});
test('independent encryptions use distinct nonces and ciphertext tampering or row swapping fails authentication',async()=>{
 const f=await fixture();await f.store().mutate('add',person(1));await f.store().mutate('add',person(2));
 let db=new DatabaseSync(f.file);const rows=db.prepare('SELECT id, private FROM participants ORDER BY position').all();
 assert.notDeepEqual(Buffer.from(rows[0].private).subarray(1,13),Buffer.from(rows[1].private).subarray(1,13));db.close();
 const encrypted=await inspect(f),state=encrypted.read();encrypted.write(state);encrypted.close();
 db=new DatabaseSync(f.file);const next=db.prepare('SELECT private FROM participants WHERE id=?').get(rows[0].id).private;
 assert.notDeepEqual(Buffer.from(next).subarray(1,13),Buffer.from(rows[0].private).subarray(1,13));
 db.prepare('UPDATE participants SET private=? WHERE id=?').run(rows[1].private,rows[0].id);db.close();await assert.rejects(f.store().status());
 db=new DatabaseSync(f.file);const corrupt=Buffer.from(rows[0].private);corrupt[corrupt.length-1]^=1;
 db.prepare('UPDATE participants SET private=? WHERE id=?').run(corrupt,rows[0].id);db.close();await assert.rejects(f.store().status());
});
test('SQLite main, WAL and journals never contain personal fields or serialized assignment relations',async()=>{
 const f=await fixture(),state=legacyState();await seed(f,state);await f.store().status();
 const db=new DatabaseSync(f.file);db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0');
 const encrypted=await inspect(f);encrypted.write(state);encrypted.close();
 // IDs of givers are intentionally public technical identifiers; encrypted receiver relations are not.
 for(const name of await fs.readdir(path.dirname(f.file))){
  if(!name.startsWith('state.sqlite'))continue;
  const bytes=await fs.readFile(path.join(path.dirname(f.file),name));
  for(const p of state.participants){assert.equal(bytes.includes(Buffer.from(p.name)),false,name);assert.equal(bytes.includes(Buffer.from(p.email)),false,name);}
  assert.equal(bytes.includes(Buffer.from('"receiver"')),false);
 }
 const row=db.prepare('SELECT private FROM assignments LIMIT 1').get();assert.equal(Buffer.from(row.private).length>29,true);db.close();
});
test('SQLite rollback preserves the whole previous state and subsequent operations recover',async()=>{
 const f=await fixture();await f.store().mutate('add',person(1));
 let db=new DatabaseSync(f.file);db.exec("CREATE TRIGGER synthetic_failure BEFORE INSERT ON participants WHEN NEW.position=1 BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;");db.close();
 await assert.rejects(f.store().mutate('add',person(2)));assert.equal((await f.store().status()).participants.length,1);
 db=new DatabaseSync(f.file);db.exec('DROP TRIGGER synthetic_failure');db.close();
 assert.equal((await f.store().mutate('add',person(2))).participants.length,2);
});
test('existing empty, corrupt and incompatible databases are rejected without replacement',async()=>{
 for(const kind of ['empty','corrupt','version']){
  const f=await fixture();await f.store().status();
  if(kind==='version'){const db=new DatabaseSync(f.file);db.exec('PRAGMA user_version=999');db.close();}
  else await fs.writeFile(f.file,kind==='empty'?'':'not sqlite');
  const before=await fs.readFile(f.file);await assert.rejects(f.store().status());assert.deepEqual(await fs.readFile(f.file),before);
 }
});
test('process death rolls back an unfinished SQLite transaction',async()=>{
 const f=await fixture();await f.store().mutate('add',person(1));
 const {spawn}=require('node:child_process');
 const child=spawn(process.execPath,['-e',`const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(${JSON.stringify(f.file)});db.exec('BEGIN IMMEDIATE; DELETE FROM participants');console.log('transaction-open');setInterval(()=>{},1000);`],{stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',()=>reject(new Error('child exited before transaction')));});
  const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await done;
  assert.equal((await f.store().status()).participants[0].name,person(1).name);
 }finally{if(child.exitCode===null && child.signalCode===null)child.kill('SIGKILL');}
});
