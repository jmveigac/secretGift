const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID,randomBytes}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {EncryptedDatabase}=require('../build/web/database');
const {LocalStore}=require('../build/web/store');
const {createApp}=require('../build/web/app');
const {createV1}=require('./helpers/v1-storage.cjs');
const noMail={configured:true,send:async()=>assert.fail('SMTP forbidden')};
async function fixture(){
 await fs.mkdir('.task/tests',{recursive:true});const root=await fs.mkdtemp(path.resolve('.task/tests/editions-'));
 const file=path.join(root,'data/state.sqlite'),key=path.join(root,'keys/storage.key'),legacy=path.join(root,'data/state.json');
 return {root,file,key,legacy,open:()=>EncryptedDatabase.open(file,key,legacy,()=>{}),store:()=>new LocalStore(file,15,noMail,key)};
}
function state(drawn=true){
 const participants=[0,1,2,3].map(n=>({id:randomUUID(),name:`Fictional ${n}`,email:`fictional${n}@example.invalid`,previousId:null}));
 participants[0].previousId=participants[3].id;
 return {version:1,participants,draw:drawn?{completedAt:'2025-12-01T12:00:00.000Z',deliveryRevision:randomUUID(),
  assignments:participants.map((p,i)=>({giver:p.id,receiver:participants[(i+1)%4].id})),
  deliveries:Object.fromEntries(participants.map((p,i)=>[p.id,['accepted','uncertain','failed','pending'][i]]))}:null};
}
function version(file){const db=new DatabaseSync(file);try{return db.prepare('PRAGMA user_version').get().user_version;}finally{db.close();}}

test('new installation creates one group and edition, then persists stable identities across restart',async()=>{
 const f=await fixture();let db=await f.open();
 const groups=db.listGroups();assert.equal(groups.length,1);
 const editions=db.listEditions(groups[0].id);assert.equal(editions.length,1);
 assert.deepEqual(db.read(),{version:1,participants:[],draw:null});db.close();
 assert.equal(version(f.file),3);db=await f.open();
 assert.deepEqual(db.listGroups(),groups);assert.deepEqual(db.listEditions(groups[0].id),editions);db.close();
});
test('v1 migration preserves participants, IDs, exclusions, dates, revisions and all SMTP states with the original key',async()=>{
 for(const drawn of [false,true]){
  const f=await fixture(),original=state(drawn),key=await createV1(f.file,f.key,original);
  const view=await f.store().status();assert.deepEqual(view.participants,original.participants);assert.equal(view.draw.completed,drawn);
  if(drawn)for(const status of ['accepted','uncertain','failed','pending'])assert.equal(view.delivery[status],1);
  assert.doesNotMatch(JSON.stringify(view),/assignments|receiver|giver|groupId|editionId/);
  const db=await f.open();try{
   assert.deepEqual(db.read(),original);
   const group=db.listGroups()[0],edition=db.listEditions(group.id)[0];
   assert.equal(edition.year,drawn?2025:new Date().getUTCFullYear());
   assert.deepEqual(db.listPeople(group.id).map(p=>p.id),original.participants.map(p=>p.id));
  }finally{db.close();}
  assert.equal(version(f.file),3);assert.deepEqual(await fs.readFile(f.key),key);
  const restarted=await f.open();try{assert.deepEqual(restarted.read(),original);}finally{restarted.close();}
 }
});
test('groups are independent; same-year editions snapshot names and contacts while historical identities remain stable',async()=>{
 const f=await fixture();let db=await f.open();
 const a=db.createGroup('Familia de prueba'),b=db.createGroup('Amigos de prueba'),source=state();
 for(const p of source.participants)db.putPerson(a.id,{...p,active:true});
 const first=db.createEdition(a.id,'Primera',2026,source.participants.map(p=>p.id));
 db.writeEdition(a.id,first.id,source);
 const p=source.participants[0],updated={id:p.id,name:'Contacto actualizado',email:'updated@example.invalid',active:true};
 db.putPerson(a.id,updated);db.putPerson(a.id,{...source.participants[3],active:false});
 const newcomer={id:randomUUID(),name:'Persona nueva',email:'new@example.invalid',active:true};db.putPerson(a.id,newcomer);
 const second=db.createEdition(a.id,'Segunda',2026,[p.id,newcomer.id]);
 assert.notEqual(first.id,second.id);assert.equal(db.listEditions(a.id).length,2);
 assert.deepEqual(db.readEdition(a.id,first.id),source);
 assert.deepEqual(db.readEdition(a.id,second.id).participants,[{id:p.id,name:updated.name,email:updated.email,previousId:null},{id:newcomer.id,name:newcomer.name,email:newcomer.email,previousId:null}]);
 assert.throws(()=>db.createEdition(a.id,'Inactiva',2026,[source.participants[3].id]));
 assert.throws(()=>db.createEdition(b.id,'Ajena',2026,[p.id]));
 assert.throws(()=>db.readEdition(b.id,first.id));
 // The same technical UUID is unambiguous in another group, with its own directory and snapshots.
 db.putPerson(b.id,{id:p.id,name:'Otra identidad',email:'other@example.invalid',active:true});
 const other=db.createEdition(b.id,'Independiente',2026,[p.id]);
 assert.equal(db.readEdition(b.id,other.id).participants[0].name,'Otra identidad');
 const changed=structuredClone(source);changed.participants[0].name='Altered history';
 assert.throws(()=>db.writeEdition(a.id,first.id,changed));
 assert.throws(()=>db.writeEdition(a.id,first.id,{...source,draw:null}));
 const swapped=structuredClone(source);swapped.draw.assignments.reverse();assert.throws(()=>db.writeEdition(a.id,first.id,swapped));
 assert.deepEqual(db.read(),{version:1,participants:[],draw:null});
 db.close();db=await f.open();try{assert.deepEqual(db.readEdition(a.id,first.id),source);assert.equal(db.listPeople(a.id).find(x=>x.id===p.id).email,updated.email);}finally{db.close();}
});
test('migrated SMTP revisions and states skip accepted and uncertain messages, including after restart',async()=>{
 const f=await fixture(),original=state();await createV1(f.file,f.key,original);
 const sent=[],mail={configured:true,send:async message=>{sent.push(message);return 'accepted';}};
 let store=new LocalStore(f.file,15,mail,f.key),view=await store.status();
 assert.equal(view.delivery.revision,original.draw.deliveryRevision);
 const request={confirm:true,drawId:view.draw.completedAt,revision:view.delivery.revision};
 const result=await store.send(request);assert.equal(result.delivery.accepted,3);assert.equal(result.delivery.uncertain,1);
 assert.deepEqual(sent.map(m=>m.to).sort(),original.participants.slice(2).map(p=>p.email).sort());
 for(const m of sent){const giver=original.participants.find(p=>p.email===m.to),assignment=original.draw.assignments.find(a=>a.giver===giver.id);assert.equal(m.receiver,original.participants.find(p=>p.id===assignment.receiver).name);}
 await assert.rejects(store.send(request),error=>error.status===409);
 store=new LocalStore(f.file,15,mail,f.key);view=await store.status();
 await store.send({confirm:true,drawId:view.draw.completedAt,revision:view.delivery.revision});assert.equal(sent.length,2);
 view=await store.status();await store.send({confirm:true,drawId:view.draw.completedAt,revision:view.delivery.revision,retryUncertain:true});
 assert.equal(sent.length,3);assert.equal(sent[2].to,original.participants[1].email);assert.equal((await store.status()).delivery.accepted,4);
 const db=await f.open();try{assert.deepEqual(db.read().draw.assignments,original.draw.assignments);assert.equal(db.read().draw.completedAt,original.draw.completedAt);}finally{db.close();}
});
test('compatibility reset preserves the drawn edition and isolates subsequent participant edits and sends',async()=>{
 const f=await fixture(),original=state();await createV1(f.file,f.key,original);await f.store().status();
 let db=await f.open();const group=db.listGroups()[0],first=db.listEditions(group.id)[0];db.close();
 const store=f.store();await store.mutate('reset',{confirm:true});
 await store.mutate('edit',{name:'Nuevo nombre',email:'renamed@example.invalid',previousId:original.participants[0].previousId},original.participants[0].id);
 await store.mutate('delete',{},original.participants[3].id);
 db=await f.open();try{
  const editions=db.listEditions(group.id);assert.equal(editions.length,2);assert.equal(editions[0].id,first.id);
  assert.deepEqual(db.readEdition(group.id,first.id),original);
  assert.equal(db.read().draw,null);assert.equal(db.read().participants.length,3);
  assert.equal(db.read().participants[0].name,'Nuevo nombre');
  assert.equal(db.listPeople(group.id).find(p=>p.id===original.participants[3].id).active,false);
 }finally{db.close();}
 const app=createApp(f.store());
 const response=await app.fetch(new Request('http://localhost/api/state'));
 assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/assignments|receiver|editionId|groupId/);
 let sent=0;const sender=new LocalStore(f.file,15,{configured:true,send:async()=>{sent++;return 'accepted';}},f.key);
 await sender.mutate('draw',{confirm:true});
 db=await f.open();const directoryChange={...db.listPeople(group.id)[0],name:'Contacto futuro',email:'future@example.invalid'};
 db.putPerson(group.id,directoryChange);db.close();
 const view=await sender.status();await sender.send({confirm:true,drawId:view.draw.completedAt,revision:view.delivery.revision});assert.equal(sent,3);
 db=await f.open();try{
  assert.deepEqual(db.readEdition(group.id,first.id),original);
  assert.equal(db.listPeople(group.id).find(p=>p.id===directoryChange.id).email,directoryChange.email);
 }finally{db.close();}
});
test('migration failures after DDL or before commit roll back schema, ciphertext, version and key, then retry safely',async()=>{
 for(const point of ['CREATE TABLE groups','PRAGMA user_version=2','COMMIT']){
  const f=await fixture(),original=state(),key=await createV1(f.file,f.key,original),before=await fs.readFile(f.file);
  const exec=DatabaseSync.prototype.exec;let failed=false;
  DatabaseSync.prototype.exec=function(sql){if(!failed && sql.startsWith(point)){failed=true;throw new Error('Synthetic migration failure');}return exec.call(this,sql);};
  try{await assert.rejects(f.open(),/Synthetic migration failure/);}finally{DatabaseSync.prototype.exec=exec;}
  assert.equal(failed,true);assert.equal(version(f.file),1);
  assert.deepEqual(await fs.readFile(f.file),before);assert.deepEqual(await fs.readFile(f.key),key);
  const db=await f.open();try{assert.deepEqual(db.read(),original);assert.equal(db.listGroups().length,1);}finally{db.close();}
 }
});
test('SIGKILL during migration leaves recoverable v1 data and a safe retry',async()=>{
 const f=await fixture(),original=state(),key=await createV1(f.file,f.key,original),before=await fs.readFile(f.file);
 const {spawn}=require('node:child_process');
 const child=spawn(process.execPath,['-e',`
  const {DatabaseSync}=require('node:sqlite');const exec=DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec=function(sql){if(sql==='PRAGMA user_version=2'){console.log('migration-open');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}return exec.call(this,sql);};
  require('./build/web/database').EncryptedDatabase.open(${JSON.stringify(f.file)},${JSON.stringify(f.key)},${JSON.stringify(f.legacy)},()=>{}).catch(()=>process.exit(2));
 `],{stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',()=>reject(new Error('child exited before migration')));});
  const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await done;
  assert.equal(version(f.file),1);assert.deepEqual(await fs.readFile(f.file),before);assert.deepEqual(await fs.readFile(f.key),key);
  // flock releases asynchronously after its parent's stdin closes.
  const {storageLock}=require('../build/web/lock');let release;
  for(let i=0;i<100;i++){try{release=await storageLock(f.file+'.init');break;}catch{await new Promise(r=>setTimeout(r,10));}}
  assert.ok(release);await release();
  const db=await f.open();try{assert.deepEqual(db.read(),original);}finally{db.close();}
 }finally{if(child.exitCode===null && child.signalCode===null)child.kill('SIGKILL');}
});
test('invalid v1 state, damaged database, unsupported schema and wrong or absent keys are never replaced',async()=>{
 for(const kind of ['state','ciphertext','file','version','key','missing-key']){
  const f=await fixture(),original=state();if(kind==='state')original.draw.assignments[0].receiver=randomUUID();
  await createV1(f.file,f.key,original);
  if(kind==='file')await fs.writeFile(f.file,'corrupt SQLite');
  if(kind==='version'){const db=new DatabaseSync(f.file);db.exec('PRAGMA user_version=999');db.close();}
  if(kind==='ciphertext'){const db=new DatabaseSync(f.file);db.prepare('UPDATE assignments SET private=?').run(randomBytes(48));db.close();}
  if(kind==='key')await fs.writeFile(f.key,randomBytes(32));
  if(kind==='missing-key')await fs.rename(f.key,f.key+'.saved');
  const before=await fs.readFile(f.file),key=await fs.readFile(kind==='missing-key'?f.key+'.saved':f.key);
  await assert.rejects(f.open());assert.deepEqual(await fs.readFile(f.file),before);
  if(kind==='missing-key')await assert.rejects(fs.stat(f.key),{code:'ENOENT'});
  else assert.deepEqual(await fs.readFile(f.key),key);
 }
});
test('migration validates the newly written snapshots before committing the version change',async()=>{
 const f=await fixture(),original=state();await createV1(f.file,f.key,original);const before=await fs.readFile(f.file);
 const prepare=DatabaseSync.prototype.prepare;let corrupted=false;
 DatabaseSync.prototype.prepare=function(sql){
  const statement=prepare.call(this,sql),db=this;
  if(sql==='INSERT INTO compatibility VALUES (1, ?, ?)')return {run(...args){
   const result=statement.run(...args);prepare.call(db,'UPDATE participants SET private=zeroblob(40)').run();corrupted=true;return result;
  }};
  return statement;
 };
 try{await assert.rejects(f.open());}finally{DatabaseSync.prototype.prepare=prepare;}
 assert.equal(corrupted,true);assert.equal(version(f.file),1);assert.deepEqual(await fs.readFile(f.file),before);
 const db=await f.open();try{assert.deepEqual(db.read(),original);}finally{db.close();}
});
test('composite foreign keys reject cross-group rows and encrypted snapshots cannot move between editions or groups',async()=>{
 for(const crossGroup of [false,true]){
  const f=await fixture();let db=await f.open();
  const a=db.createGroup('Grupo A'),b=crossGroup?db.createGroup('Grupo B'):a,p={id:randomUUID(),name:'Nombre protegido',email:'private@example.invalid',active:true};
  db.putPerson(a.id,p);if(crossGroup)db.putPerson(b.id,p);
  const first=db.createEdition(a.id,'Una edición',2026,[p.id]),second=db.createEdition(b.id,'Otra edición',2026,[p.id]);db.close();
  const sql=new DatabaseSync(f.file);try{
   sql.exec('PRAGMA foreign_keys=ON');
   assert.throws(()=>sql.prepare('INSERT INTO participants VALUES (?, ?, ?, ?, ?)').run(a.id,randomUUID(),p.id,0,randomBytes(48)),/FOREIGN KEY/);
   if(crossGroup)assert.throws(()=>sql.prepare('INSERT INTO participants VALUES (?, ?, ?, ?, ?)').run(a.id,second.id,p.id,0,randomBytes(48)),/FOREIGN KEY/);
   const source=sql.prepare('SELECT private FROM participants WHERE edition_id=?').get(first.id).private;
   sql.prepare('UPDATE participants SET private=? WHERE edition_id=?').run(source,second.id);
  }finally{sql.close();}
  const before=await fs.readFile(f.file);
  // Corruption outside the compatibility edition is also rejected at startup.
  await assert.rejects(f.open());assert.deepEqual(await fs.readFile(f.file),before);
 }
});
test('v2 restored database and original key preserve all groups, snapshots, assignments and memberships',async()=>{
 const f=await fixture(),original=state();await createV1(f.file,f.key,original);
 let db=await f.open();const group=db.createGroup('Grupo respaldado'),person={id:randomUUID(),name:'Respaldo',email:'backup@example.invalid',active:true};
 db.putPerson(group.id,person);const edition=db.createEdition(group.id,'Copia',2026,[person.id]);const groups=db.listGroups();db.close();
 const bytes=await fs.readFile(f.file);
 for(const value of [group.name,edition.name,person.name,person.email])assert.equal(bytes.includes(Buffer.from(value)),false);
 const restored=await fixture();await fs.mkdir(path.dirname(restored.file),{recursive:true});await fs.mkdir(path.dirname(restored.key),{recursive:true});
 await fs.copyFile(f.file,restored.file);await fs.copyFile(f.key,restored.key);
 db=await restored.open();try{
  assert.deepEqual(db.read(),original);assert.deepEqual(db.listGroups(),groups);assert.deepEqual(db.listPeople(group.id),[person]);
  assert.deepEqual(db.listEditions(group.id),[edition]);assert.equal(db.readEdition(group.id,edition.id).participants[0].id,person.id);
 }finally{db.close();}
});
