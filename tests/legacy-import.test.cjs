const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {spawn}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const {EncryptedDatabase}=require('../build/web/database');
const {importCli}=require('../build/import/service');
const {parseLegacy,parseImportPlan}=require('../build/domain/legacy-import');
const {LocalStore}=require('../build/web/store');
const {createApp}=require('../build/web/app');
const rows=(n=3,shift=1)=>Array.from({length:n},(_,i)=>({name:`Fictional ${i}`,email:`fictional${i}@example.invalid`,lastGift:`Fictional ${(i+shift)%n}`}));
async function fixture(n=3){
 await fs.mkdir('.task/tests',{recursive:true});const root=await fs.mkdtemp(path.resolve('.task/tests/import-'));
 const data=path.join(root,'data/state.sqlite'),key=path.join(root,'keys/storage.key'),source=path.join(root,'source.json'),plan=path.join(root,'plan.json');
 const open=()=>EncryptedDatabase.open(data,key,path.join(root,'data/state.json'),()=>{});
 let db=await open();const group=db.createGroup('Synthetic destination');db.close();
 const records=rows(n);
 const options={source,plan,data,key};
 const makePlan=(mode='manual',overrides={})=>({mode,target:{groupId:group.id},edition:{name:'Imported edition',year:2001},identities:records.map((_,record)=>({record,new:true})),...(mode==='assignments'?{history:{completedAt:'2001-05-06T12:30:00.000Z',sequence:1}}:{}),...overrides});
 const write=async(p=makePlan(),r=records,base64=true)=>{await fs.writeFile(source,base64?Buffer.from(JSON.stringify(r)).toString('base64'):JSON.stringify(r));await fs.writeFile(plan,JSON.stringify(p));};
 const preview=()=>importCli(options);
 const commit=async()=>{const p=await preview();return importCli({...options,confirm:p.confirmation});};
 const state=async()=>{const db=await open();try{const editions=db.listEditions(group.id);return editions.map(e=>({edition:e,state:db.readEdition(group.id,e.id)}));}finally{db.close();}};
 return {root,records,group,options,open,makePlan,write,preview,commit,state};
}
async function run(args,env={}){
 return new Promise((resolve,reject)=>{const child=spawn(process.execPath,['build/import/cli.js',...args],{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.once('error',reject);child.once('close',code=>resolve({code,stdout,stderr}));});
}
const args=f=>['--source',f.options.source,'--plan',f.options.plan,'--data',f.options.data,'--key',f.options.key];

test('manual Base64 import previews without writes, requires confirmation, preserves source and survives restart',async()=>{
 const f=await fixture();await f.write();const before=await fs.readFile(f.options.data),original=await fs.readFile(f.options.source),key=await fs.readFile(f.options.key);
 const preview=await f.preview();assert.equal(preview.imported,false);assert.equal(preview.newPeople,3);assert.equal(preview.unknownDeliveries,0);assert.match(preview.confirmation,/^[a-f0-9]{64}$/);
 assert.deepEqual(await fs.readFile(f.options.data),before);assert.equal((await f.state()).length,0);
 const result=await importCli({...f.options,confirm:preview.confirmation});assert.equal(result.imported,true);assert.equal(result.confirmation,undefined);
 const editions=await f.state(),s=editions[0].state;assert.equal(s.draw,null);assert.equal(s.participants.length,3);
 s.participants.forEach((p,i)=>assert.equal(p.previousId,s.participants[(i+1)%3].id));
 assert.deepEqual(await fs.readFile(f.options.source),original);assert.deepEqual(await fs.readFile(f.options.key),key);
 const db=await f.open();try{assert.deepEqual(db.previousRecipients({groupId:f.group.id,editionId:editions[0].edition.id}),{});}finally{db.close();}
});
test('plain JSON assignments need explicit metadata, preserve generated pairs and unknown SMTP status, and drive next draw',async()=>{
 const f=await fixture();await f.write(f.makePlan('assignments'),f.records,false);await f.commit();const imported=(await f.state())[0];
 const {state:s}=imported;assert.equal(s.draw.completedAt,'2001-05-06T12:30:00.000Z');
 for(let i=0;i<3;i++){assert.deepEqual(s.draw.assignments[i],{giver:s.participants[i].id,receiver:s.participants[(i+1)%3].id});assert.equal(s.participants[i].previousId,null);assert.equal(s.draw.deliveries[s.participants[i].id],'uncertain');}
 let sent=0;const store=new LocalStore(f.options.data,15,{configured:true,send:async()=>{sent++;return 'accepted';}},f.options.key);
 const scope={groupId:f.group.id,editionId:imported.edition.id},view=await store.status(scope);
 assert.equal(view.delivery.uncertain,3);assert.equal(view.delivery.accepted,0);
 await store.send({confirm:true,expectedRevision:view.revision,drawId:view.draw.completedAt,revision:view.delivery.revision},scope);assert.equal(sent,0);
 let db=await f.open(),next;try{next=db.createEdition(f.group.id,'Next draw',2002,s.participants.map(p=>p.id));}finally{db.close();}
 const ns={groupId:f.group.id,editionId:next.id},nv=await store.status(ns);await store.mutate('draw',{confirm:true,expectedRevision:nv.revision},undefined,ns);
 db=await f.open();try{const actual=db.readEdition(f.group.id,next.id);for(const a of actual.draw.assignments)assert.notEqual(a.receiver,s.draw.assignments.find(p=>p.giver===a.giver).receiver);}finally{db.close();}
 assert.equal(sent,0);
});
test('identities are explicit; name/email matches only block new duplicates and never merge or update contacts',async()=>{
 const f=await fixture();let db=await f.open();const people=f.records.map((r,i)=>({id:randomUUID(),name:i===0?'Current contact':r.name,email:i===0?'current@example.invalid':r.email,active:i!==1}));
 for(const p of people)db.putPerson(f.group.id,p);const snapshot=db.createEdition(f.group.id,'Existing snapshot',2000,people.filter(p=>p.active).map(p=>p.id));const original=db.readEdition(f.group.id,snapshot.id);db.close();
 await f.write();await assert.rejects(f.preview(),/coincidente/);
 const plan=f.makePlan('manual',{identities:people.map((p,record)=>({record,personId:p.id}))});await f.write(plan);await f.commit();
 db=await f.open();try{assert.deepEqual(db.listPeople(f.group.id),people);assert.deepEqual(db.readEdition(f.group.id,snapshot.id),original);const imported=db.listEditions(f.group.id).find(e=>e.name==='Imported edition');const s=db.readEdition(f.group.id,imported.id);assert.deepEqual(s.participants.map(p=>p.id),people.map(p=>p.id));assert.equal(s.participants[0].name,f.records[0].name);}finally{db.close();}
});
test('skipping records is explicit and cannot leave dangling restrictions or partial assignment cycles',async()=>{
 const f=await fixture(4);const records=f.records.map((r,i)=>({...r,lastGift:i<2?f.records[1-i].name:''}));
 const plan=f.makePlan('manual',{identities:f.records.map((_,record)=>record<2?{record,new:true}:{record,skip:true})});await f.write(plan,records);
 const p=await f.preview();assert.equal(p.skipped,2);assert.equal(p.participants,2);await f.commit();
 const bad=await fixture();await bad.write(bad.makePlan('assignments',{identities:[{record:0,new:true},{record:1,new:true},{record:2,skip:true}]}));await assert.rejects(bad.preview(),/omitir/);assert.equal((await bad.state()).length,0);
});
test('malformed, incomplete, duplicate, ambiguous, oversized and invalid-reference sources are rejected without writes',async()=>{
 const f=await fixture();await f.write();const before=await fs.readFile(f.options.data);
 for(const input of ['{private invalid','%%%%',JSON.stringify([{name:'Incomplete'}]),JSON.stringify([f.records[0],f.records[0]]),JSON.stringify([{...f.records[0],lastGift:'Unknown'}]),JSON.stringify([{...f.records[0],lastGift:f.records[0].name}]),JSON.stringify([{...f.records[0],id:randomUUID()}]),' '.repeat(1024*1024+1)]){
  await fs.writeFile(f.options.source,input);await assert.rejects(f.preview());assert.deepEqual(await fs.readFile(f.options.data),before);
 }
 assert.throws(()=>parseLegacy([{...f.records[0],name:' bad space '}]),/incorrecto/);
});
test('invalid plans, absent metadata, date-only/year-only and impossible dates never produce confirmed history',async()=>{
 const f=await fixture(),before=await fs.readFile(f.options.data);
 const plans=[{...f.makePlan(),mode:undefined},f.makePlan('assignments',{history:undefined}),f.makePlan('assignments',{history:{completedAt:'2001',sequence:1}}),f.makePlan('assignments',{history:{completedAt:'2001-05-06',sequence:1}}),f.makePlan('assignments',{history:{completedAt:'2001-02-30T12:30:00.000Z',sequence:1}}),f.makePlan('assignments',{history:{completedAt:'2001-05-06T12:30:00.000Z',sequence:0}}),f.makePlan('manual',{history:{completedAt:'2001-05-06T12:30:00.000Z',sequence:1}}),f.makePlan('manual',{identities:[{record:0,new:true},{record:0,new:true},{record:2,new:true}]}),f.makePlan('manual',{identities:[]})];
 for(const plan of plans){await f.write(plan);await assert.rejects(f.preview());assert.deepEqual(await fs.readFile(f.options.data),before);}
 assert.throws(()=>parseImportPlan({...f.makePlan(),target:{groupId:randomUUID(),newGroup:'Both'}},3));
});
test('wrong destination group or foreign/duplicate identity is rejected and new-group creation is atomic',async()=>{
 const f=await fixture();await f.write(f.makePlan('manual',{target:{groupId:randomUUID()}}));await assert.rejects(f.preview(),/no existe/);
 let db=await f.open();const other=db.createGroup('Foreign'),person={id:randomUUID(),name:'Foreign person',email:'foreign@example.invalid',active:true};db.putPerson(other.id,person);db.close();
 await f.write(f.makePlan('manual',{identities:[{record:0,personId:person.id},{record:1,new:true},{record:2,new:true}]}));await assert.rejects(f.preview(),/no pertenece/);
 const duplicate=f.makePlan('manual',{identities:f.records.map((_,record)=>({record,personId:person.id}))});await f.write(duplicate);await assert.rejects(f.preview(),/misma identidad/);
 await f.write(f.makePlan('manual',{target:{newGroup:'Explicit new destination'}}));const preview=await f.preview();db=await f.open();assert.equal(db.listGroups().length,3);db.close();await importCli({...f.options,confirm:preview.confirmation});
 db=await f.open();try{assert.equal(db.listGroups().length,4);assert.equal(db.listGroups().filter(g=>g.name==='Explicit new destination').length,1);}finally{db.close();}
 await assert.rejects(f.preview(),/Ya existe un grupo/);
});
test('repeat imports and equivalent reordered content are detected even with another edition name',async()=>{
 const f=await fixture();await f.write();const p=await f.preview();await importCli({...f.options,confirm:p.confirmation});await assert.rejects(importCli({...f.options,confirm:p.confirmation}));
 let db=await f.open();const people=db.listPeople(f.group.id);db.close();
 const records=[...f.records].reverse(),plan=f.makePlan('manual',{edition:{name:'Another name',year:2002},identities:records.map((r,record)=>({record,personId:people.find(p=>p.name===r.name).id}))});await f.write(plan,records);await assert.rejects(f.preview(),/ya están representados/);assert.equal((await f.state()).length,1);
});
test('preview confirmation binds source, plan and current destination contents',async()=>{
 const f=await fixture();await f.write();let p=await f.preview();await assert.rejects(importCli({...f.options,confirm:'0'.repeat(64)}),/vista previa/);
 const db=await f.open();db.putPerson(f.group.id,{id:randomUUID(),name:'Concurrent',email:'concurrent@example.invalid',active:true});db.close();
 await assert.rejects(importCli({...f.options,confirm:p.confirmation}),/vista previa/);assert.equal((await f.state()).length,0);
 p=await f.preview();await f.write(f.makePlan('manual'),f.records.map((r,i)=>i? r : {...r,email:'changed@example.invalid'}));await assert.rejects(importCli({...f.options,confirm:p.confirmation}),/vista previa/);
 p=await f.preview();await f.write(f.makePlan('manual',{edition:{name:'Changed plan',year:2001}}));await assert.rejects(importCli({...f.options,confirm:p.confirmation}),/vista previa/);
});
test('one transaction rolls back group, people, edition and assignments after an injected storage failure',async()=>{
 const f=await fixture();await f.write(f.makePlan('assignments',{target:{newGroup:'Rollback destination'}}));const p=await f.preview(),before=await fs.readFile(f.options.data),key=await fs.readFile(f.options.key);
 const prepare=DatabaseSync.prototype.prepare;let failed=false;
 DatabaseSync.prototype.prepare=function(sql){const st=prepare.call(this,sql);if(sql==='INSERT INTO assignments (group_id, edition_id, giver, private, status, test_status) VALUES (?, ?, ?, ?, ?, ?)')return {run(){failed=true;throw new Error('Synthetic sensitive database detail');}};return st;};
 try{await assert.rejects(importCli({...f.options,confirm:p.confirmation}),e=>!e.message.includes('sensitive'));}finally{DatabaseSync.prototype.prepare=prepare;}
 assert.equal(failed,true);assert.deepEqual(await fs.readFile(f.options.data),before);assert.deepEqual(await fs.readFile(f.options.key),key);
 const db=await f.open();try{assert.equal(db.listGroups().length,2);}finally{db.close();}await importCli({...f.options,confirm:p.confirmation});
});
test('known chronological gaps accept insertion without changing existing draws; conflicts and occupied or preceding positions are refused',async()=>{
 const f=await fixture(4);await f.write(f.makePlan('assignments'));await f.commit();let existing=(await f.state())[0];const people=existing.state.participants;
 const links=people.map((p,record)=>({record,personId:p.id}));
 const third=f.makePlan('assignments',{edition:{name:'Third',year:2003},identities:links,history:{completedAt:'2003-05-06T12:30:00.000Z',sequence:3}});
 await f.write(third,rows(4,3));await f.commit();const before=await f.state();
 const middle=f.makePlan('assignments',{edition:{name:'Middle',year:2002},identities:links,history:{completedAt:'2002-05-06T12:30:00.000Z',sequence:2}});
 await f.write(middle,rows(4,2));await f.commit();const after=await f.state();assert.deepEqual(after[0],before[0]);assert.deepEqual(after[1],before[1]);
 let db=await f.open();try{const target={groupId:f.group.id,editionId:before[1].edition.id};assert.deepEqual(db.previousRecipients(target),Object.fromEntries(people.map((p,i)=>[p.id,people[(i+2)%4].id])));}finally{db.close();}
 for(const history of [{completedAt:'2000-05-06T12:30:00.000Z',sequence:1},{completedAt:'2000-05-06T12:30:00.000Z',sequence:4}]){await f.write({...middle,edition:{name:'Conflict',year:2000},history},rows(4,2));await assert.rejects(f.preview(),/posición|fecha/);}
 // Appending a repeated last recipient is incompatible even with a free position and later date.
 await f.write({...middle,edition:{name:'Repeated recipient',year:2004},history:{completedAt:'2004-05-06T12:30:00.000Z',sequence:4}},rows(4,3));await assert.rejects(f.preview(),/restricciones/);
});
test('insertion cannot invalidate a successor or assign order around ambiguous migrated history',async()=>{
 const f=await fixture();await f.write(f.makePlan('assignments'));await f.commit();const first=(await f.state())[0],links=first.state.participants.map((p,record)=>({record,personId:p.id}));
 const second=f.makePlan('assignments',{edition:{name:'Successor',year:2003},identities:links,history:{completedAt:'2003-05-06T12:30:00.000Z',sequence:3}});await f.write(second,rows(3,2));await f.commit();
 const middle={...second,edition:{name:'Invalid middle',year:2002},history:{completedAt:'2002-05-06T12:30:00.000Z',sequence:2}};await f.write(middle,rows(3,2));await assert.rejects(f.preview(),/restricciones/);
 const sql=new DatabaseSync(f.options.data);sql.prepare('UPDATE draw SET history_sequence=NULL WHERE edition_id=?').run(first.edition.id);sql.close();
 await f.write({...middle,history:{completedAt:'2004-05-06T12:30:00.000Z',sequence:4}});await assert.rejects(f.preview(),/orden desconocido/);
});
test('shared storage lock blocks import during SMTP, which continues unchanged without extra mail',async()=>{
 const f=await fixture();await f.write(f.makePlan('assignments'));await f.commit();const first=(await f.state())[0];
 let start,finish;const started=new Promise(r=>start=r),waiting=new Promise(r=>finish=r);let sent=0;
 const store=new LocalStore(f.options.data,15,{configured:true,send:async()=>{sent++;start();await waiting;return 'accepted';}},f.options.key);
 const scope={groupId:f.group.id,editionId:first.edition.id},view=await store.status(scope);
 const sending=store.send({confirm:true,retryUncertain:true,expectedRevision:view.revision,drawId:view.draw.completedAt,revision:view.delivery.revision},scope);
 try{await started;await f.write(f.makePlan('manual',{target:{newGroup:'During sending'}}));await assert.rejects(f.preview(),/ocupado/);}finally{finish();await sending;}
 assert.equal(sent,3);
});
test('CLI summaries, errors and public endpoints do not reveal private contacts, assignments or source paths; storage stays encrypted v4',async()=>{
 const f=await fixture();await f.write(f.makePlan('assignments'));const preview=await run(args(f));assert.equal(preview.code,0);const p=JSON.parse(preview.stdout);assert.equal(p.imported,false);
 const imported=await run([...args(f),'--confirm',p.confirmation]);assert.equal(imported.code,0);assert.equal(JSON.parse(imported.stdout).unknownDeliveries,3);
 await fs.writeFile(f.options.source,'{"secret":"private-raw-content"');const bad=await run(args(f));assert.equal(bad.code,1);
 const output=preview.stdout+preview.stderr+imported.stdout+imported.stderr+bad.stdout+bad.stderr;
 for(const value of ['Fictional','example.invalid','lastGift','receiver','private-raw-content',f.options.source])assert.equal(output.includes(value),false);
 const db=await f.open();let editions;try{editions=db.listEditions(f.group.id);}finally{db.close();}
 const store=new LocalStore(f.options.data,15,{configured:false,send:()=>assert.fail('No SMTP')},f.options.key),app=createApp(store);
 for(const url of [`/api/groups/${f.group.id}`,`/api/groups/${f.group.id}/editions/${editions[0].id}`]){const r=await app.fetch(new Request('http://localhost'+url));assert.equal(r.status,200);assert.doesNotMatch(await r.text(),/assignments|receiver|history_sequence|restrictions/);}
 const bytes=await fs.readFile(f.options.data);for(const r of f.records){assert.equal(bytes.includes(Buffer.from(r.name)),false);assert.equal(bytes.includes(Buffer.from(r.email)),false);}
 const sql=new DatabaseSync(f.options.data);try{assert.equal(sql.prepare('PRAGMA user_version').get().user_version,4);for(const row of sql.prepare('SELECT private FROM assignments').all())assert.equal(Buffer.from(row.private)[0],1);}finally{sql.close();}
});
test('import refuses uninitialized or older storage without creating a key or running migrations',async()=>{
 const f=await fixture();await f.write();const missing={...f.options,data:path.join(f.root,'missing/state.sqlite'),key:path.join(f.root,'missing-key/key')};
 await assert.rejects(importCli(missing));await assert.rejects(fs.stat(missing.data),{code:'ENOENT'});await assert.rejects(fs.stat(missing.key),{code:'ENOENT'});
 const sql=new DatabaseSync(f.options.data);sql.exec('PRAGMA user_version=2');sql.close();const before=await fs.readFile(f.options.data);await assert.rejects(f.preview(),/SQLite v4/);assert.deepEqual(await fs.readFile(f.options.data),before);
});
test('legacy CLI keeps Base64 round trip and draw/mail behavior without SMTP',async()=>{
 const {readJson}=require('../build/utils/commonUtils'),{createNewSecretGiftList,createMailList}=require('../build/drawParticipants');
 const f=await fixture();await f.write();assert.deepEqual(readJson(f.options.source),f.records);
 const nodemailer=require('nodemailer'),create=nodemailer.createTransport;nodemailer.createTransport=()=>assert.fail('No SMTP');
 try{const draw=createNewSecretGiftList(f.records);assert.equal(draw.length,3);assert.equal(createMailList(draw).length,3);
  // Exercise serialization in a child so process cwd never changes for other tests.
  const script=`process.chdir(${JSON.stringify(f.root)});require(${JSON.stringify(path.resolve('build/utils/commonUtils'))}).writeJson(${JSON.stringify(draw)});`;
  const result=await new Promise((resolve,reject)=>{const c=spawn(process.execPath,['-e',script],{stdio:'ignore'});c.once('error',reject);c.once('close',resolve);});assert.equal(result,0);assert.deepEqual(readJson(path.join(f.root,'newParticipants.json')),draw);
 }finally{nodemailer.createTransport=create;}
});

test('imported manual restrictions remain subordinate to verified history without altering earlier snapshots',async()=>{
 const f=await fixture();await f.write(f.makePlan('assignments'));await f.commit();const first=(await f.state())[0];
 const links=first.state.participants.map((p,record)=>({record,personId:p.id}));
 await f.write(f.makePlan('manual',{edition:{name:'Manual after history',year:2002},identities:links}),rows(3,2));await f.commit();
 const pending=(await f.state())[1],scope={groupId:f.group.id,editionId:pending.edition.id};
 const store=new LocalStore(f.options.data,15,{configured:false,send:()=>assert.fail('No SMTP')},f.options.key),v=await store.status(scope);
 await store.mutate('draw',{confirm:true,expectedRevision:v.revision},undefined,scope);
 const editions=await f.state();assert.deepEqual(editions[0],first);
 for(const a of editions[1].state.draw.assignments){const p=editions[1].state.participants.find(p=>p.id===a.giver);assert.equal(a.receiver,p.previousId);assert.notEqual(a.receiver,first.state.draw.assignments.find(x=>x.giver===a.giver).receiver);}
});
