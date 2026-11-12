const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {EncryptedDatabase}=require('../build/web/database');
const {LocalStore}=require('../build/web/store');
const {createApp}=require('../build/web/app');
async function fixture(n=4){
 await fs.mkdir('.task/tests',{recursive:true});
 const root=await fs.mkdtemp(path.resolve('.task/tests/history-'));
 const file=path.join(root,'data/state.sqlite'),key=path.join(root,'keys/key'),legacy=path.join(root,'data/legacy.json');
 const open=()=>EncryptedDatabase.open(file,key,legacy,()=>{});
 const store=()=>new LocalStore(file,15,{configured:false,send:()=>assert.fail('No SMTP')},key);
 const db=await open(),g=db.createGroup('Synthetic history');
 const people=Array.from({length:n},(_,i)=>({id:randomUUID(),name:`Person ${i}`,email:`person${i}@example.invalid`,active:true}));
 for(const p of people)db.putPerson(g.id,p);
 db.close();
 const edition=async(name,year=2026,ids=people.map(p=>p.id))=>{const db=await open();try{return {groupId:g.id,editionId:db.createEdition(g.id,name,year,ids).id};}finally{db.close();}};
 const draw=async(scope)=>{const s=store(),v=await s.status(scope);return s.mutate('draw',{confirm:true,expectedRevision:v.revision},undefined,scope);};
 const read=async(scope)=>{const db=await open();try{return db.readEdition(scope.groupId,scope.editionId);}finally{db.close();}};
 return {file,key,open,store,g,people,edition,draw,read};
}
const pairs=s=>Object.fromEntries(s.draw.assignments.map(a=>[a.giver,a.receiver]));
function avoids(a,b){for(const x of a.draw.assignments){assert.notEqual(x.giver,x.receiver);if(b[x.giver])assert.notEqual(x.receiver,b[x.giver]);}assert.equal(new Set(a.draw.assignments.map(x=>x.receiver)).size,a.participants.length);}
test('confirmation sequence ignores creation order and reference year; only last known recipient matters, across restart',async()=>{
 const f=await fixture(),oldPending=await f.edition('Pending old',1999),later=await f.edition('Created later',2050);
 await f.draw(later);const first=await f.read(later);
 await f.draw(oldPending);const second=await f.read(oldPending);avoids(second,pairs(first));
 const third=await f.edition('Same year',1999);await f.draw(third);const last=await f.read(third);avoids(last,pairs(second));
 const db=await f.open();try{
  assert.deepEqual(db.previousRecipients(oldPending),pairs(first));
  assert.deepEqual(db.previousRecipients(third),pairs(second));
  const restrictions=db.effectiveRestrictions({version:1,participants:last.participants,draw:null},await f.edition('Future',1999));
  assert.deepEqual(restrictions,pairs(last));
 }finally{db.close();}
 // Constraints are not cumulative: with three participants only two cycles exist.
 const t=await fixture(3),a=await t.edition('A'),b=await t.edition('B'),c=await t.edition('C');
 await t.draw(a);await t.draw(b);await t.draw(c);assert.deepEqual(pairs(await t.read(c)),pairs(await t.read(a)));
});
test('returning people use their own last draw; pending editions, changed contacts and other groups do not supply history',async()=>{
 const f=await fixture(6),a=await f.edition('All');await f.draw(a);const first=await f.read(a);
 const b=await f.edition('Subset',2026,f.people.slice(0,4).map(p=>p.id));await f.draw(b);const second=await f.read(b);
 const db=await f.open();let c;
 try{
  db.putPerson(f.g.id,{...f.people[0],name:'Renamed',email:'renamed@example.invalid'});
  const newcomer={id:randomUUID(),name:'New',email:'new@example.invalid',active:true};db.putPerson(f.g.id,newcomer);
  const other=db.createGroup('Other');for(const p of f.people)db.putPerson(other.id,p);
  const foreign=db.createEdition(other.id,'Foreign',2026,f.people.map(p=>p.id));
  const fs=structuredClone(first);fs.draw=null;db.writeEdition(other.id,foreign.id,fs);
  const e=db.createEdition(f.g.id,'Return',2026,[...f.people.map(p=>p.id),newcomer.id]);c={groupId:f.g.id,editionId:e.id};
  const history=db.previousRecipients(c);
  for(const p of f.people)assert.equal(history[p.id],pairs(second)[p.id]??pairs(first)[p.id]);
  assert.equal(history[newcomer.id],undefined);
 }finally{db.close();}
 await f.draw(c);const current=await f.read(c);avoids(current,{...pairs(first),...pairs(second)});assert.equal(current.participants[0].name,'Renamed');
});
test('historical recipient absent overrides a contradictory manual restriction without disclosing history',async()=>{
 const f=await fixture(6),a=await f.edition('First');await f.draw(a);const first=await f.read(a),giver=f.people[0].id,receiver=pairs(first)[giver];
 const b=await f.edition('Absent',2026,f.people.filter(p=>p.id!==receiver).map(p=>p.id));
 const db=await f.open();try{
  const state=db.readEdition(b.groupId,b.editionId);state.participants[0].previousId=state.participants[1].id;db.writeEdition(b.groupId,b.editionId,state);
  assert.equal(db.effectiveRestrictions(state,b)[giver],null);
 }finally{db.close();}
 await f.draw(b);const app=createApp(f.store());
 for(const url of ['/api/state','/api/groups',`/api/groups/${f.g.id}`,`/api/groups/${f.g.id}/editions/${b.editionId}`]){
  const response=await app.fetch(new Request('http://localhost'+url));assert.equal(response.status,200);
  assert.doesNotMatch(await response.text(),/assignments|restrictions|history_sequence|receiver|giver/);
 }
});
test('two-person mutual history makes continuation impossible; stale revisions and failed draws preserve persisted state',async()=>{
 const f=await fixture(2),a=await f.edition('A'),pending=await f.edition('Pending');
 const stale=await f.store().status(pending);await f.draw(a);
 await assert.rejects(f.store().mutate('draw',{confirm:true,expectedRevision:stale.revision},undefined,pending),e=>e.status===409);
 const db=await f.open();let next;try{next={groupId:f.g.id,editionId:db.forkEdition(f.g.id,a.editionId).id};}finally{db.close();}
 const before=await fs.readFile(f.file);await assert.rejects(f.draw(next),e=>e.status===422 && !e.message.includes(f.people[0].id));
 assert.deepEqual(await fs.readFile(f.file),before);assert.equal((await f.read(next)).draw,null);
});
test('manual previousId remains enforced without verified history; verified history has priority',async()=>{
 const f=await fixture(3),a=await f.edition('Manual');let db=await f.open();try{
  const s=db.readEdition(a.groupId,a.editionId);s.participants[0].previousId=s.participants[1].id;db.writeEdition(a.groupId,a.editionId,s);
 }finally{db.close();}
 await f.draw(a);const first=await f.read(a);assert.notEqual(pairs(first)[f.people[0].id],f.people[1].id);
 const b=await f.edition('Automatic');db=await f.open();try{
  const s=db.readEdition(b.groupId,b.editionId);s.participants[0].previousId=f.people[1].id;db.writeEdition(b.groupId,b.editionId,s);
 }finally{db.close();}
 await f.draw(b);const second=await f.read(b);avoids(second,pairs(first));assert.equal(pairs(second)[f.people[0].id],f.people[1].id);
 // Stored effective restrictions validate this draw despite contradictory manual data.
 const restarted=await f.open();restarted.close();
});
async function downgrade(f){
 const db=new DatabaseSync(f.file);try{
  db.exec('DROP INDEX draw_history_sequence; ALTER TABLE draw DROP COLUMN history_sequence; ALTER TABLE draw DROP COLUMN restrictions; PRAGMA user_version=2;');
 }finally{db.close();}
}
test('v2 migration leaves ambiguous history unordered, preserves snapshots and key, and starts a new verified sequence',async()=>{
 const f=await fixture(),a=await f.edition('One'),b=await f.edition('Two');await f.draw(a);await f.draw(b);
 const expected=[await f.read(a),await f.read(b)];for(const s of expected)delete s.draw.restrictions;
 const key=await fs.readFile(f.key);await downgrade(f);
 const db=await f.open();try{
  assert.deepEqual(db.readEdition(a.groupId,a.editionId),expected[0]);assert.deepEqual(db.readEdition(b.groupId,b.editionId),expected[1]);
  assert.deepEqual(db.previousRecipients(a),{});assert.deepEqual(db.previousRecipients(b),{});
 }finally{db.close();}
 assert.deepEqual(await fs.readFile(f.key),key);
 const c=await f.edition('New');await f.draw(c);const d=await f.edition('Next');await f.draw(d);avoids(await f.read(d),pairs(await f.read(c)));
 const check=await f.open();try{assert.deepEqual(check.previousRecipients(a),{});}finally{check.close();}
 const sql=new DatabaseSync(f.file);try{assert.equal(sql.prepare('PRAGMA user_version').get().user_version,4);assert.equal(sql.prepare('SELECT COUNT(*) n FROM draw WHERE history_sequence IS NULL').get().n,2);}finally{sql.close();}
});
test('v2 migration rolls back DDL, ciphertext and version on failure, then retries safely',async()=>{
 for(const point of ['ALTER TABLE draw ADD COLUMN restrictions','CREATE UNIQUE INDEX draw_history_sequence','PRAGMA user_version=3']){
  const f=await fixture(),a=await f.edition('Historic');await f.draw(a);await downgrade(f);
  const before=await fs.readFile(f.file),key=await fs.readFile(f.key),exec=DatabaseSync.prototype.exec;let failed=false;
  DatabaseSync.prototype.exec=function(sql){if(!failed&&sql.startsWith(point)){failed=true;throw new Error('Synthetic v3 failure');}return exec.call(this,sql);};
  try{await assert.rejects(f.open(),/Synthetic v3 failure/);}finally{DatabaseSync.prototype.exec=exec;}
  assert.equal(failed,true);assert.deepEqual(await fs.readFile(f.file),before);assert.deepEqual(await fs.readFile(f.key),key);
  const db=await f.open();db.close();
 }
});

test('SIGKILL before v3 commit leaves v2 recoverable with original ciphertext and key',async()=>{
 const f=await fixture(),a=await f.edition('Historic');await f.draw(a);await downgrade(f);
 const before=await fs.readFile(f.file),key=await fs.readFile(f.key);
 const {spawn}=require('node:child_process');
 const child=spawn(process.execPath,['-e',`
  const {DatabaseSync}=require('node:sqlite'),exec=DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec=function(sql){if(sql==='PRAGMA user_version=3'){console.log('v3-open');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}return exec.call(this,sql);};
  require('./build/web/database').EncryptedDatabase.open(${JSON.stringify(f.file)},${JSON.stringify(f.key)},${JSON.stringify(path.join(path.dirname(f.file),'legacy.json'))},()=>{}).catch(()=>process.exit(2));
 `],{stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',()=>reject(new Error('Child exited before migration')));});
  const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await done;
  assert.deepEqual(await fs.readFile(f.file),before);assert.deepEqual(await fs.readFile(f.key),key);
  const {storageLock}=require('../build/web/lock');let release;
  for(let i=0;i<100;i++){try{release=await storageLock(f.file+'.init');break;}catch{await new Promise(r=>setTimeout(r,10));}}
  assert.ok(release);await release();
  const db=await f.open();db.close();
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
});
test('repository rejects invalid historical assignments atomically and SMTP updates preserve sequence and constraints',async()=>{
 const f=await fixture(3),a=await f.edition('A');await f.draw(a);const first=await f.read(a),b=await f.edition('B');
 let db=await f.open();try{
  const s=db.readEdition(b.groupId,b.editionId);s.draw={completedAt:new Date().toISOString(),assignments:first.draw.assignments};
  assert.throws(()=>db.writeEdition(b.groupId,b.editionId,s),/Invalid edition state/);
  assert.equal(db.readEdition(b.groupId,b.editionId).draw,null);
 }finally{db.close();}
 await f.draw(b);db=await f.open();try{
  const s=db.readEdition(a.groupId,a.editionId);s.draw.deliveries=Object.fromEntries(s.participants.map(p=>[p.id,'accepted']));
  db.writeEdition(a.groupId,a.editionId,s);assert.deepEqual(db.previousRecipients(b),pairs(first));
  const changed=structuredClone(s);changed.draw.restrictions[s.participants[0].id]=s.participants[1].id;
  assert.throws(()=>db.writeEdition(a.groupId,a.editionId,changed));
 }finally{db.close();}
});

test('a sole migrated draw is an unambiguous predecessor of new confirmations',async()=>{
 const f=await fixture(3),a=await f.edition('Only');await f.draw(a);const original=await f.read(a);await downgrade(f);
 const b=await f.edition('New');await f.draw(b);avoids(await f.read(b),pairs(original));
 const db=await f.open();try{assert.deepEqual(db.previousRecipients(a),{});}finally{db.close();}
});
