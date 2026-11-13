const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const nodemailer=require('nodemailer');
const {smtpDelivery}=require('../build/mail/delivery');
const {smtpSender}=require('../build/web/mail');
const {LocalStore}=require('../build/web/store');
const {EncryptedDatabase}=require('../build/web/database');
const {createApp}=require('../build/web/app');
const {sendMail}=require('../build/sendMail');
const env={HOST:'smtp.example.invalid',FROM:'"Organizer" <sender@example.invalid>',PORT:'587',MAILUSER:'synthetic',MAILPWD:'synthetic'};
const payload=s=>({confirm:true,drawId:s.draw.completedAt,revision:s.delivery.revision,expectedRevision:s.revision});
async function fixture(mail){
 await fs.mkdir('.task/tests',{recursive:true});const dir=await fs.mkdtemp(path.resolve('.task/tests/modes-'));
 const file=path.join(dir,'data/state.sqlite'),key=path.join(dir,'keys/storage.key');
 const store=new LocalStore(file,15,mail);
 for(const name of ['Ana','Bea','Cora','Dani'])await store.mutate('add',{name,email:name.toLowerCase()+'@example.invalid',previousId:null});
 await store.mutate('draw',{confirm:true});
 const open=()=>EncryptedDatabase.open(file,key,path.join(dir,'data/state.json'),()=>{});
 const read=async()=>{const db=await open();try{return db.read();}finally{db.close();}};
 return {store,file,key,open,read};
}
function mockTransport(run){
 const original=nodemailer.createTransport;const messages=[];const options=[];let mode='accepted';
 nodemailer.createTransport=o=>{options.push(o);return {sendMail:async m=>{messages.push(m);if(mode==='failed')throw {responseCode:550};if(mode==='uncertain')throw {code:'ECONNECTION'};return {accepted:[m.to]};},close(){}};};
 return Promise.resolve().then(()=>run({messages,options,setMode:m=>mode=m})).finally(()=>{nodemailer.createTransport=original;});
}
const message={to:'real@example.invalid',participant:'Ana <private>',subject:'Assignment',text:'Your assignment is Bea',html:'<p>Your assignment is Bea</p>'};
test('mode is explicit and invalid test settings fail closed without creating SMTP transport',async()=>{
 await mockTransport(async({messages,options})=>{
  for(const config of [{}, {APP_MODE:''},{APP_MODE:'TEST'},{APP_MODE:'other'},{APP_MODE:'test'},...['bad','a@b','.a@example.invalid','a..b@example.invalid','a.@example.invalid','a@example.invalid,b@example.invalid','Display <a@example.invalid>','a@example.invalid\r\nBcc: x@example.invalid'].map(TEST_EMAIL=>({APP_MODE:'test',TEST_EMAIL}))]){
   const sender=smtpDelivery({...env,...config});assert.equal(sender.configured,false);assert.ok(sender.configurationError);await assert.rejects(sender.send(message));
  }
  assert.equal(options.length,0);assert.equal(messages.length,0);
  assert.equal(smtpDelivery({...env,APP_MODE:'production'}).configured,true);
  assert.equal(smtpDelivery({...env,APP_MODE:'test',TEST_EMAIL:'test@example.invalid'}).configured,true);
 });
});
test('single delivery boundary forces test headers and SMTP envelope and escapes participant identity',async()=>{
 await mockTransport(async({messages,options})=>{
  const sender=smtpDelivery({...env,APP_MODE:'test',TEST_EMAIL:'test@example.invalid'});
  await sender.send({...message,cc:'real@example.invalid',bcc:'real@example.invalid',envelope:{to:['real@example.invalid']},headers:{'Delivered-To':'real@example.invalid'}});
  const m=messages[0];assert.equal(m.to,'test@example.invalid');assert.deepEqual(m.envelope,{from:'sender@example.invalid',to:['test@example.invalid']});
  assert.equal(m.cc,undefined);assert.equal(m.bcc,undefined);assert.equal(m.headers,undefined);assert.match(m.subject,/PRUEBA/);
  assert.match(m.text,/Ana <private>/);assert.match(m.html,/Ana &lt;private&gt;/);assert.match(m.text,/Bea/);
  assert.doesNotMatch(JSON.stringify({...m,text:undefined,html:undefined}),/real@example/);
  assert.equal(options[0].secure,false);
  await smtpDelivery({...env,PORT:'465',APP_MODE:'production'}).send(message);assert.equal(messages[1].to,message.to);assert.equal(messages[1].subject,message.subject);assert.equal(options[1].secure,true);
 });
});
test('four independent tests preserve contacts, assignments and production states across restart and mode change',async()=>{
 await mockTransport(async({messages,setMode})=>{
  const config={...env,APP_MODE:'test',TEST_EMAIL:'test@example.invalid'};
  const f=await fixture(smtpSender(config));const before=await f.read();const first=payload(await f.store.status());
  const app=createApp(f.store);const call=p=>app.fetch(new Request('http://localhost/api/draw/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)}));
  assert.equal((await call(first)).status,200);assert.equal(messages.length,4);
  for(let i=0;i<4;i++){
   const a=before.draw.assignments[i];const giver=before.participants.find(p=>p.id===a.giver),receiver=before.participants.find(p=>p.id===a.receiver);
   assert.equal(messages[i].to,config.TEST_EMAIL);assert.deepEqual(messages[i].envelope.to,[config.TEST_EMAIL]);assert.ok(messages[i].text.includes(giver.name));assert.ok(messages[i].text.includes(receiver.name));
  }
  const after=await f.read();assert.deepEqual(after.participants,before.participants);assert.deepEqual(after.draw.assignments,before.draw.assignments);assert.deepEqual(after.draw.deliveries,before.draw.deliveries);
  let status=await f.store.status();assert.equal(status.delivery.accepted,4);assert.equal(status.delivery.production.pending,4);assert.equal(status.delivery.test.accepted,4);
  assert.equal((await call(first)).status,409);assert.equal(messages.length,4);
  const restarted=new LocalStore(f.file,15,smtpSender(config));status=await restarted.status();assert.equal(status.delivery.accepted,4);
  await assert.rejects(restarted.send(payload(await f.store.status())),e=>e.status===409);assert.equal(messages.length,4);
  await restarted.send(payload(status));assert.equal(messages.length,4);
  const production=new LocalStore(f.file,15,smtpSender({...env,APP_MODE:'production'}));status=await production.status();assert.equal(status.delivery.pending,4);assert.equal(messages.length,4);
  await assert.rejects(production.send(payload(await restarted.status())),e=>e.status===409);
  await production.send(payload(status));assert.equal(messages.length,8);for(const m of messages.slice(4))assert.ok(before.participants.some(p=>p.email===m.to));
  status=await production.status();assert.equal(status.delivery.accepted,4);assert.equal(status.delivery.test.accepted,4);
  const db=await f.open();try{assert.deepEqual(db.listPeople(db.listGroups()[0].id).map(p=>p.email).sort(),before.participants.map(p=>p.email).sort());}finally{db.close();}
  const bytes=await fs.readFile(f.file);for(const p of before.participants)assert.equal(bytes.includes(Buffer.from(p.email)),false);
 });
});
test('test rejections and connection uncertainty survive restart, retries stay redirected and skip accepted',async()=>{
 await mockTransport(async({messages,setMode})=>{
  const config={...env,APP_MODE:'test',TEST_EMAIL:'test@example.invalid'};
  const f=await fixture(smtpSender(config));setMode('failed');await f.store.send(payload(await f.store.status()));let s=await f.store.status();assert.equal(s.delivery.failed,4);assert.equal(s.delivery.production.pending,4);
  setMode('uncertain');await f.store.send(payload(s));s=await f.store.status();assert.equal(s.delivery.uncertain,4);
  const restarted=new LocalStore(f.file,15,smtpSender(config));s=await restarted.status();assert.equal(s.delivery.uncertain,4);
  setMode('accepted');await restarted.send(payload(s));assert.equal(messages.length,8);
  await restarted.send({...payload(await restarted.status()),retryUncertain:true});s=await restarted.status();assert.equal(s.delivery.accepted,4);assert.equal(s.delivery.production.pending,4);
  for(const m of messages){assert.equal(m.to,config.TEST_EMAIL);assert.deepEqual(m.envelope.to,[config.TEST_EMAIL]);}
 });
});
test('v3 to v4 migration preserves original key, assignments and historical production states, and rolls back on failure',async()=>{
 const f=await fixture({configured:true,send:async()=> 'accepted'});await f.store.send(payload(await f.store.status()));const before=await f.read(),key=await fs.readFile(f.key);
 let db=new DatabaseSync(f.file);db.exec('ALTER TABLE assignments DROP COLUMN test_status; PRAGMA user_version=3;');db.close();
 const bytes=await fs.readFile(f.file),exec=DatabaseSync.prototype.exec;
 DatabaseSync.prototype.exec=function(sql){if(sql==='PRAGMA user_version=4')throw new Error('Synthetic migration failure');return exec.call(this,sql);};
 try{await assert.rejects(f.open(),/Synthetic migration failure/);}finally{DatabaseSync.prototype.exec=exec;}
 assert.deepEqual(await fs.readFile(f.file),bytes);assert.deepEqual(await fs.readFile(f.key),key);
 db=await f.open();try{assert.deepEqual(db.read(),before);}finally{db.close();}
 db=new DatabaseSync(f.file);try{assert.equal(db.prepare('PRAGMA user_version').get().user_version,5);assert.equal(db.prepare("SELECT COUNT(*) n FROM assignments WHERE test_status='pending' AND status='accepted'").get().n,4);}finally{db.close();}
});
test('legacy CLI uses the same recipient boundary, including resends, without exposing transport errors',async()=>{
 const previous={...process.env};
 try{Object.assign(process.env,env,{APP_MODE:'test',TEST_EMAIL:'test@example.invalid'});
  await mockTransport(async({messages})=>{await sendMail({destinyMail:message.to,participantName:'Ana',subject:message.subject,messageText:message.text,messageHtml:message.html});assert.equal(messages[0].to,'test@example.invalid');assert.deepEqual(messages[0].envelope.to,['test@example.invalid']);assert.match(messages[0].text,/Ana/);});
 }finally{for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);}
});
test('an interrupted test send persists uncertainty before SMTP and blocks concurrent sends without touching production',async()=>{
 let entered,resume;const ready=new Promise(r=>entered=r),wait=new Promise(r=>resume=r);let calls=0;
 const f=await fixture({mode:'test',configured:true,send:async()=>{calls++;entered();await wait;return 'accepted';}});
 const input=payload(await f.store.status());const sending=f.store.send(input);await ready;
 const s=await f.store.status();assert.equal(s.delivery.active,true);assert.equal(s.delivery.uncertain,1);assert.equal(s.delivery.production.pending,4);
 const disk=await f.read();assert.equal(Object.values(disk.draw.testDeliveries).filter(v=>v==='uncertain').length,1);assert.ok(Object.values(disk.draw.deliveries).every(v=>v==='pending'));
 await assert.rejects(f.store.send(input),e=>e.status===409);
 const other=new LocalStore(f.file,15,{mode:'test',configured:true,send:async()=>assert.fail('concurrent SMTP')});await assert.rejects(other.send(input),e=>e.status===409);
 resume();await sending;assert.equal(calls,4);
 await assert.rejects(f.store.send(input),e=>e.status===409);
});
test('storage failure after a simulated test acceptance leaves only the test delivery uncertain after restart',async()=>{
 const original=EncryptedDatabase.prototype.write;
 const f=await fixture({mode:'test',configured:true,send:async()=>{EncryptedDatabase.prototype.write=()=>{throw new Error('Synthetic storage failure');};return 'accepted';}});
 try{await assert.rejects(f.store.send(payload(await f.store.status())),/Synthetic storage failure/);}finally{EncryptedDatabase.prototype.write=original;}
 const restarted=new LocalStore(f.file,15,{mode:'test',configured:true,send:async()=>assert.fail('must not send automatically')});const s=await restarted.status();
 assert.equal(s.delivery.uncertain,1);assert.equal(s.delivery.pending,3);assert.equal(s.delivery.accepted,0);assert.equal(s.delivery.production.pending,4);
});
