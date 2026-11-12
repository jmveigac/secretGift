const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {resolveSchedule}=require('../build/domain/schedule');
const {EncryptedDatabase}=require('../build/web/database');
const {LocalStore}=require('../build/web/store');
const {createApp}=require('../build/web/app');
async function fixture(mail={mode:'test',configured:true,send:async()=>assert.fail('No SMTP expected')},count=4){
 await fs.mkdir('.task/tests',{recursive:true});const dir=await fs.mkdtemp(path.resolve('.task/tests/guided-'));
 const file=path.join(dir,'data/state.sqlite'),key=path.join(dir,'keys/storage.key');let clock=Date.parse('2026-01-01T00:00:00Z');
 const store=new LocalStore(file,Math.max(15,count),mail,key,()=>clock),app=createApp(store);
 const request=async(url,body,method=body===undefined?'GET':'POST')=>{const r=await app.fetch(new Request('http://localhost'+url,{method,headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}));return {status:r.status,data:await r.json(),headers:r.headers};};
 let g=await store.manage('createGroup',{name:'Synthetic group'});
 for(let i=0;i<count;i++)g=await store.manage('addPerson',{name:'Person '+i,email:`p${i}@example.invalid`,expectedRevision:g.revision},g.group.id);
 const group=()=>store.group(g.group.id),ids=g.people.map(p=>p.id),base=`/api/groups/${g.group.id}`;
 const create=async(extra={})=>{const current=await group();return request(base+'/editions',{name:'Celebration',year:2026,personIds:ids,expectedRevision:current.revision,schedule:{localDateTime:'2026-12-24T20:00',timeZone:'Europe/Madrid'},confirmDraw:true,...extra});};
 const scope=e=>({groupId:g.group.id,editionId:e.edition.id});
 const open=()=>EncryptedDatabase.open(file,key,path.join(dir,'data/state.json'),()=>{});
 const read=async(e)=>{const db=await open();try{return db.readEdition(g.group.id,e.edition.id);}finally{db.close();}};
 return {file,key,open,store,request,group,ids,base,create,scope,read,setClock:t=>clock=Date.parse(t)};
}
const sendPayload=s=>({confirm:true,drawId:s.draw.completedAt,revision:s.delivery.revision,expectedRevision:s.revision});
test('wall time rejects invalid, nonexistent and ambiguous dates; uses explicit zone independently of browser',()=>{
 assert.equal(resolveSchedule({localDateTime:'2026-12-24T20:00',timeZone:'Europe/Madrid'}).eventAt,'2026-12-24T19:00:00.000Z');
 assert.equal(resolveSchedule({localDateTime:'2026-07-01T20:00',timeZone:'Europe/Madrid'}).eventAt,'2026-07-01T18:00:00.000Z');
 for(const localDateTime of ['2026-02-30T12:00','2026-03-29T02:30','2026-10-25T02:30','2026-12-24T25:00'])assert.throws(()=>resolveSchedule({localDateTime,timeZone:'Europe/Madrid'}));
 assert.throws(()=>resolveSchedule({localDateTime:'2026-12-24T20:00',timeZone:'Invalid/Zone'}));
 assert.equal(resolveSchedule({localDateTime:'2020-01-01T00:00',timeZone:'UTC'}).eventAt,'2020-01-01T00:00:00.000Z');
});
test('atomic wizard preserves partial manual relations, confirms without SMTP and exposes results only at server deadline',async()=>{
 const f=await fixture();const r=await f.create({previousIds:{[f.ids[0]]:f.ids[1]}});assert.equal(r.status,201);
 const e=r.data.editions.find(e=>e.draw.completed),s=f.scope(e),url=f.base+'/editions/'+e.edition.id;const original=await f.read(e);
 assert.notEqual(original.draw.assignments.find(a=>a.giver===f.ids[0]).receiver,f.ids[1]);
 assert.equal(e.edition.schedule.revealAt,'2026-12-24T19:00:00.000Z');
 for(const instant of ['2026-01-01T00:00:00Z','2026-12-24T18:59:59.999Z']){f.setClock(instant);const response=await f.request(url+'/results?now=2099-01-01');assert.equal(response.status,403);assert.doesNotMatch(JSON.stringify(response.data),/giver|receiver|assignments/);}
 for(const endpoint of ['/api/state',f.base,url,'/api/groups']){const response=await f.request(endpoint);assert.equal(response.status,200);assert.doesNotMatch(JSON.stringify(response.data),/assignments|receiver|giver|restrictions/);}
 f.setClock('2026-12-24T19:00:00Z');let response=await f.request(url+'/results');assert.equal(response.status,200);assert.equal(response.data.assignments.length,4);assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.deepEqual(response.data.assignments.map(a=>({giver:a.giver.id,receiver:a.receiver.id})),original.draw.assignments);
 f.setClock('2027-01-01T00:00:00Z');assert.equal((await f.request(url+'/results')).status,200);
 const restart=new LocalStore(f.file,15,{configured:false,send:async()=>assert.fail('SMTP')},f.key,()=>Date.parse('2026-12-24T19:00:00Z'));assert.equal((await restart.status(s)).results.available,true);
 const v=await f.store.status(s);assert.equal((await f.request(url,{name:'Change',schedule:{localDateTime:'2020-01-01T12:00',timeZone:'UTC'},expectedRevision:v.revision},'PUT')).status,409);
 assert.deepEqual(await f.read(e),original);
});
test('historical undated editions remain hidden even with a past year, and ordinary updates cannot regularize them',async()=>{
 const f=await fixture();const r=await f.create({year:1999,schedule:undefined,confirmDraw:undefined});assert.equal(r.status,201);const e=r.data.editions.at(-1),scope=f.scope(e);let s=await f.store.status(scope);
 await f.store.mutate('draw',{confirm:true,expectedRevision:s.revision},undefined,scope);f.setClock('2099-01-01T00:00:00Z');s=await f.store.status(scope);assert.equal(s.results.reason,'missing-date');assert.equal(s.results.available,false);
 const url=f.base+'/editions/'+e.edition.id;assert.equal((await f.request(url+'/results')).status,403);assert.equal((await f.request(url,{name:'Change',schedule:{localDateTime:'1999-01-01T12:00',timeZone:'UTC'},expectedRevision:s.revision},'PUT')).status,409);
});
test('preview validates IDs and manual relations, prioritizes verified history without revealing pairs, and impossible draws roll back',async()=>{
 const f=await fixture(undefined,4);let g=await f.group();
 const preview=previousIds=>f.request(f.base+'/preview',{personIds:f.ids,previousIds,expectedRevision:g.revision});
 let r=await preview({[f.ids[0]]:f.ids[1]});assert.equal(r.status,200);assert.equal(r.data.restrictions[0].source,'manual');assert.equal(r.data.viable,true);
 assert.equal((await preview({[f.ids[0]]:f.ids[0]})).status,400);assert.equal((await preview({[f.ids[0]]:'missing'})).status,400);
 const full=Object.fromEntries(f.ids.map((id,i)=>[id,f.ids[(i+1)%4]]));assert.equal((await f.create({previousIds:full})).status,201);g=await f.group();r=await preview(full);assert.equal(r.status,200);assert.ok(r.data.restrictions.every(x=>x.source==='verified'));assert.ok(r.data.restrictions.every(x=>x.previousId===undefined));assert.doesNotMatch(JSON.stringify(r.data),/receiver|giver|assignments/);
 const t=await fixture(undefined,2);const first=await t.create();assert.equal(first.status,201);const before=await t.group();const impossible=await t.create({name:'Impossible'});assert.equal(impossible.status,422);assert.deepEqual((await t.group()).editions,before.editions);
 const invalid=await t.create({name:'Bad',previousIds:{[t.ids[0]]:t.ids[0]}});assert.equal(invalid.status,400);
});
test('repeat uses forkEdition to create a distinct confirmed edition, retains original snapshots and applies latest history',async()=>{
 const f=await fixture();const first=await f.create();const source=first.data.editions.find(e=>e.draw.completed);const original=await f.read(source);
 const second=await f.create({name:'Next',referenceEditionId:source.edition.id,schedule:{localDateTime:'2026-12-25T20:00',timeZone:'Europe/Madrid'}});assert.equal(second.status,201);const next=second.data.editions.find(e=>e.edition.name==='Next');assert.notEqual(next.edition.id,source.edition.id);
 const state=await f.read(next);for(const a of state.draw.assignments)assert.notEqual(a.receiver,original.draw.assignments.find(p=>p.giver===a.giver).receiver);assert.deepEqual(await f.read(source),original);
 const duplicate=await f.create({name:'Celebration',schedule:{localDateTime:'2026-12-26T20:00',timeZone:'Europe/Madrid'}});assert.equal(duplicate.status,201);
});
test('reminders resend original pairs to all including initial accepted and retain independent campaigns, revisions and retry uncertainty',async()=>{
 let mode='accepted',calls=[];const mail={mode:'test',configured:true,send:async m=>{calls.push(m);return mode;}};const f=await fixture(mail);const created=await f.create(),e=created.data.editions.find(e=>e.draw.completed),scope=f.scope(e),url=f.base+'/editions/'+e.edition.id;
 let s=await f.store.status(scope);await f.store.send(sendPayload(s),scope);assert.equal(calls.length,4);const before=await f.read(e);
 s=await f.store.status(scope);const payload=sendPayload(s);let r=await f.request(url+'/reminders',payload);assert.equal(r.status,200);assert.equal(calls.length,8);assert.equal(r.data.campaigns.length,1);assert.equal(r.data.campaigns[0].accepted,4);assert.equal(r.data.delivery.accepted,4);assert.equal(r.data.results.available,false);
 assert.deepEqual(calls.slice(0,4),calls.slice(4,8));assert.equal((await f.request(url+'/reminders',payload)).status,409);
 mode='uncertain';s=await f.store.status(scope);r=await f.request(url+'/reminders',sendPayload(s));assert.equal(r.data.campaigns.length,2);const c=r.data.campaigns[1];assert.equal(c.uncertain,4);assert.equal(calls.length,12);
 mode='accepted';s=await f.store.status(scope);r=await f.request(url+'/reminders/'+c.id+'/send',{...sendPayload(s),revision:c.revision});assert.equal(r.status,200);assert.equal(calls.length,12);
 const current=r.data.campaigns[1];r=await f.request(url+'/reminders/'+c.id+'/send',{...sendPayload(r.data),revision:current.revision,retryUncertain:true});assert.equal(r.status,200);assert.equal(calls.length,16);assert.equal(r.data.campaigns[1].accepted,4);
 assert.deepEqual((await f.read(e)).draw.assignments,before.draw.assignments);assert.deepEqual((await f.read(e)).draw.deliveries,before.draw.deliveries);
 const restart=new LocalStore(f.file,15,mail,f.key);assert.equal((await restart.status(scope)).campaigns.length,2);
 const prod=new LocalStore(f.file,15,{...mail,mode:'production'},f.key);s=await prod.status(scope);await assert.rejects(prod.send({...sendPayload(s),revision:s.campaigns[0].revision},scope,c.id),e=>e.status===409);
});
test('v4 migration preserves ciphertext, key and delivery states; rolls back dates and campaign tables on failure',async()=>{
 const f=await fixture();const r=await f.create({schedule:undefined,confirmDraw:undefined}),e=r.data.editions.at(-1);const before=await f.read(e),key=await fs.readFile(f.key);
 let db=new DatabaseSync(f.file);const rows=db.prepare('SELECT private FROM participants').all().map(r=>Buffer.from(r.private));db.exec('DROP TABLE campaign_deliveries; DROP TABLE mail_campaigns; ALTER TABLE editions DROP COLUMN schedule; PRAGMA user_version=4');db.close();const bytes=await fs.readFile(f.file),exec=DatabaseSync.prototype.exec;
 DatabaseSync.prototype.exec=function(sql){if(sql==='PRAGMA user_version=5')throw new Error('Synthetic v5 failure');return exec.call(this,sql);};
 try{await assert.rejects(f.open(),/Synthetic v5 failure/);}finally{DatabaseSync.prototype.exec=exec;}
 assert.deepEqual(await fs.readFile(f.file),bytes);assert.deepEqual(await fs.readFile(f.key),key);db=await f.open();assert.deepEqual(db.readEdition(f.scope(e).groupId,e.edition.id),before);db.close();
 db=new DatabaseSync(f.file);try{assert.equal(db.prepare('PRAGMA user_version').get().user_version,5);assert.deepEqual(db.prepare('SELECT private FROM participants').all().map(r=>Buffer.from(r.private)),rows);}finally{db.close();}
});
test('draft schedule changes invalidate optimistic revisions, while browser dates cannot bypass an undated historical gate',async()=>{
 const f=await fixture();const r=await f.create({schedule:undefined,confirmDraw:undefined}),e=r.data.editions.at(-1),scope=f.scope(e),url=f.base+'/editions/'+e.edition.id;const stale=await f.store.status(scope);
 const body={name:'Scheduled draft',schedule:{localDateTime:'2026-12-31T20:00',timeZone:'Europe/Madrid'},expectedRevision:stale.revision};
 const first=await f.request(url,body,'PUT');assert.equal(first.status,200);assert.notEqual(first.data.revision,stale.revision);assert.equal((await f.request(url,body,'PUT')).status,409);
 assert.equal((await f.request(url+'/results')).status,409);
 const invalid=await f.request(url,{...body,expectedRevision:first.data.revision,schedule:{localDateTime:'2026-03-29T02:30',timeZone:'Europe/Madrid'}},'PUT');assert.equal(invalid.status,400);
});
test('past dates are explicit, verified absent recipients override manual input, and invalid dates never create an edition',async()=>{
 const f=await fixture();let r=await f.create({year:2025,schedule:{localDateTime:'2025-12-24T20:00',timeZone:'Europe/Madrid'}});assert.equal(r.status,201);const e=r.data.editions.find(e=>e.draw.completed);assert.equal((await f.store.status(f.scope(e))).results.available,true);
 const original=await f.read(e),giver=f.ids[0],receiver=original.draw.assignments.find(a=>a.giver===giver).receiver,ids=f.ids.filter(id=>id!==receiver),g=await f.group();
 r=await f.request(f.base+'/preview',{personIds:ids,previousIds:{[giver]:ids.find(id=>id!==giver)},expectedRevision:g.revision});assert.equal(r.status,200);const info=r.data.restrictions.find(x=>x.personId===giver);assert.equal(info.source,'verified');assert.equal(info.previousId,undefined);
 const count=g.editions.length;r=await f.create({name:'Invalid',schedule:{localDateTime:'2026-10-25T02:30',timeZone:'Europe/Madrid'}});assert.equal(r.status,400);assert.equal((await f.group()).editions.length,count);
});
test('reminder transport stays redirected through partial rejection and connection failure, with independent production campaign',async()=>{
 const nodemailer=require('nodemailer'),{smtpSender}=require('../build/web/mail');const original=nodemailer.createTransport,delivered=[];let partial=true;
 nodemailer.createTransport=()=>({sendMail:async m=>{delivered.push(m);const n=delivered.length;if(partial&&n===2)throw {responseCode:550};if(partial&&n===3)throw {code:'ECONNECTION'};return {accepted:[m.to]};},close(){}});
 try{
  const env={APP_MODE:'test',TEST_EMAIL:'test@example.invalid',HOST:'smtp.example.invalid',PORT:'465',FROM:'sender@example.invalid'};
  const f=await fixture(smtpSender(env)),r=await f.create(),e=r.data.editions.find(e=>e.draw.completed),scope=f.scope(e);let s=await f.store.status(scope);
  s=await f.store.send(sendPayload(s),scope,'new');let c=s.campaigns[0];assert.equal(c.accepted,2);assert.equal(c.failed,1);assert.equal(c.uncertain,1);assert.equal(s.delivery.pending,4);
  partial=false;s=await f.store.send({...sendPayload(s),revision:c.revision},scope,c.id);assert.equal(delivered.length,5);c=s.campaigns[0];assert.equal(c.accepted,3);assert.equal(c.uncertain,1);
  s=await f.store.send({...sendPayload(s),revision:c.revision,retryUncertain:true},scope,c.id);assert.equal(delivered.length,6);assert.equal(s.campaigns[0].accepted,4);
  for(const m of delivered){assert.equal(m.to,env.TEST_EMAIL);assert.deepEqual(m.envelope.to,[env.TEST_EMAIL]);assert.equal(m.cc,undefined);assert.equal(m.bcc,undefined);assert.doesNotMatch(JSON.stringify({...m,html:undefined,text:undefined}),/p[0-9]@example/);}
  const production=new LocalStore(f.file,15,smtpSender({...env,APP_MODE:'production'}),f.key);s=await production.status(scope);s=await production.send(sendPayload(s),scope,'new');assert.equal(s.campaigns.length,2);assert.equal(s.campaigns[0].mode,'test');assert.equal(s.campaigns[1].mode,'production');assert.equal(s.campaigns[1].accepted,4);
  for(const m of delivered.slice(6))assert.ok(/^p[0-9]@example.invalid$/.test(m.to));assert.equal(s.delivery.pending,4);assert.equal((await f.group()).editions.filter(e=>e.draw.completed).length,1);
 }finally{nodemailer.createTransport=original;}
});
test('concurrent reminder requests cannot duplicate a campaign and post-acceptance storage failure recovers as uncertain',async()=>{
 let resume,started;const ready=new Promise(r=>started=r),wait=new Promise(r=>resume=r);let calls=0;
 const f=await fixture({mode:'test',configured:true,send:async()=>{calls++;started();await wait;return 'accepted';}}),r=await f.create(),e=r.data.editions.find(e=>e.draw.completed),scope=f.scope(e),input=sendPayload(await f.store.status(scope));
 const first=f.store.send(input,scope,'new');await ready;let s=await f.store.status(scope);assert.equal(s.campaigns.length,1);assert.equal(s.campaigns[0].uncertain,1);
 await assert.rejects(f.store.send(input,scope,'new'),e=>e.status===409);const other=new LocalStore(f.file,15,{mode:'test',configured:true,send:async()=>assert.fail('Duplicate')},f.key);await assert.rejects(other.send(input,scope,'new'),e=>e.status===409);
 resume();await first;assert.equal(calls,4);
 const original=EncryptedDatabase.prototype.updateCampaign;let attempted=false;
 const failing=new LocalStore(f.file,15,{mode:'test',configured:true,send:async()=>{attempted=true;EncryptedDatabase.prototype.updateCampaign=()=>{throw new Error('Synthetic campaign persistence failure');};return 'accepted';}},f.key);
 try{await assert.rejects(failing.send(sendPayload(await failing.status(scope)),scope,'new'),/Synthetic campaign persistence failure/);}finally{EncryptedDatabase.prototype.updateCampaign=original;}
 assert.equal(attempted,true);s=await other.status(scope);assert.equal(s.campaigns.length,2);assert.equal(s.campaigns[1].uncertain,1);assert.equal(s.campaigns[1].pending,3);assert.equal(s.campaigns[1].accepted,0);assert.equal(s.delivery.pending,4);
});
test('the existing configurable limit supports a hundred participants with complete manual relations in one bounded HTTP request',async()=>{
 const f=await fixture(undefined,100),previousIds=Object.fromEntries(f.ids.map((id,i)=>[id,f.ids[(i+1)%100]]));
 const g=await f.group();let r=await f.request(f.base+'/preview',{personIds:f.ids,previousIds,expectedRevision:g.revision});assert.equal(r.status,200);assert.equal(r.data.viable,true);
 r=await f.create({name:'One hundred',previousIds});assert.equal(r.status,201);assert.equal(r.data.editions.find(e=>e.draw.completed).draw.participantCount,100);
});
test('confirmed schedules cannot be edited through repository operations and date envelopes cannot move between editions',async()=>{
 const f=await fixture();const first=await f.create(),e=first.data.editions.find(e=>e.draw.completed);const second=await f.create({name:'Later',schedule:{localDateTime:'2026-12-25T20:00',timeZone:'Europe/Madrid'}});const next=second.data.editions.find(x=>x.edition.name==='Later');
 let db=await f.open();try{assert.throws(()=>db.configureEdition(f.scope(e).groupId,e.edition.id,'Change',2026,resolveSchedule({localDateTime:'2026-12-01T00:00',timeZone:'UTC'})),/immutable/);}finally{db.close();}
 const bytes=await fs.readFile(f.file);assert.equal(bytes.includes(Buffer.from('2026-12-24T19:00:00.000Z')),false);
 db=new DatabaseSync(f.file);const blob=db.prepare('SELECT schedule FROM editions WHERE id=?').get(e.edition.id).schedule;db.prepare('UPDATE editions SET schedule=? WHERE id=?').run(blob,next.edition.id);db.close();await assert.rejects(f.open());
});
