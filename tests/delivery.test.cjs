const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { LocalStore } = require('../build/web/store');
const { createApp } = require('../build/web/app');
const { smtpSender } = require('../build/web/mail');
const { assignmentContent } = require('../build/web/mail-template');
const { EncryptedDatabase } = require('../build/web/database');
async function diskState(file) { const db=await EncryptedDatabase.open(file,path.join(path.dirname(file),'../keys/storage.key'),path.join(path.dirname(file),'state.json'),()=>{});try{return db.read();}finally{db.close();} }
async function writeState(file,state) { const db=await EncryptedDatabase.open(file,path.join(path.dirname(file),'../keys/storage.key'),path.join(path.dirname(file),'state.json'),()=>{});try{db.write(state);}finally{db.close();} }
const { storageLock } = require('../build/web/lock');
async function setup(mail = { configured: true, send: async () => 'accepted' }) {
 await fs.mkdir('.task/tests', {recursive:true});
 const dir = await fs.mkdtemp(path.resolve('.task/tests/mail-'));
 const file = path.join(dir,'data','state.sqlite');
 const store = new LocalStore(file,15,mail);
 const app=createApp(store);
 const call=(body, headers={})=>app.fetch(new Request('http://localhost/api/draw/send',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)}));
 for (const name of ['Ana','Bea','Cora']) await store.mutate('add',{name,email:name.toLowerCase()+'@example.invalid',previousId:null});
 const confirm=async()=>store.mutate('draw',{confirm:true});
 const payload=async(extra={})=>{const s=await store.status();return {confirm:true,drawId:s.draw.completedAt,revision:s.delivery.revision,...extra};};
 return {store,file,call,confirm,payload};
}
test('requires confirmed draw, explicit confirmation, current revision and private SMTP configuration',async()=>{
 const {call,confirm,payload}=await setup({configured:false,send:async()=>assert.fail('must not send')});
 assert.equal((await call({confirm:true})).status,409);
 await confirm();
 assert.equal((await call({})).status,400);
 assert.equal((await call(await payload())).status,409);
 assert.equal((await call(await payload(),{Origin:'http://evil.invalid'})).status,403);
 assert.equal((await call({...await payload(),drawId:'old'})).status,409);
 for(const env of [{},{HOST:'smtp.example.invalid',FROM:'a@example.invalid',PORT:'bad'},{HOST:'host',FROM:'a@example.invalid',PORT:'25',MAILUSER:'user'},{HOST:'host',FROM:'invalid',PORT:'25'}]) assert.equal(smtpSender(env).configured,false);
 assert.equal(smtpSender({APP_MODE:'production',HOST:'host',FROM:'a@example.invalid',PORT:'25'}).configured,true);
});
test('uses persisted assignments, partial failure retries skip accepted and duplicate HTTP requests cannot retry failures',async()=>{
 const sent=[];let fail=true;
 const {store,file,call,confirm,payload}=await setup({configured:true,send:async m=>{sent.push(m);return m.name==='Bea'&&fail?'failed':'accepted';}});
 await confirm(); const before=await diskState(file); const request=await payload();
 let response=await call(request);assert.equal(response.status,200);
 let state=await response.json();assert.equal(state.delivery.accepted,2);assert.equal(state.delivery.failed,1);
 for(const message of sent){const giver=before.participants.find(p=>p.email===message.to);const a=before.draw.assignments.find(a=>a.giver===giver.id);assert.equal(message.name,giver.name);assert.equal(message.receiver,before.participants.find(p=>p.id===a.receiver).name);}
 assert.doesNotMatch(JSON.stringify(state),/assignments|receiver|giver|MAILPWD/);
 assert.equal((await call(request)).status,409);assert.equal(sent.length,3);
 fail=false;response=await call(await payload());assert.equal(response.status,200);assert.equal((await response.json()).delivery.accepted,3);assert.equal(sent.length,4);assert.equal(sent[3].name,'Bea');
 assert.deepEqual((await diskState(file)).draw.assignments,before.draw.assignments);
 const restarted=new LocalStore(file,15,{configured:true,send:async()=>assert.fail('accepted must not resend')});
 const publicState=await restarted.status();await restarted.send({confirm:true,drawId:publicState.draw.completedAt,revision:publicState.delivery.revision});
 await store.mutate('reset',{confirm:true}); assert.equal((await store.status()).delivery.accepted,0);assert.equal((await diskState(file)).draw,null);
 await confirm();assert.equal((await store.status()).delivery.pending,3);
});
test('concurrent send and reset are blocked while progress remains readable',async()=>{
 let resume,started;const ready=new Promise(r=>started=r);const wait=new Promise(r=>resume=r);
 let calls=0;const {store,file,call,confirm,payload}=await setup({configured:true,send:async()=>{calls++;started();await wait;return 'accepted';}});
 await confirm();const request=await payload();const first=call(request);await ready;
 assert.equal((await call(request)).status,409);
 const other=new LocalStore(file,15,{configured:true,send:async()=>assert.fail('duplicate')});
 await assert.rejects(other.send(request),e=>e.status===409);
 await assert.rejects(store.mutate('reset',{confirm:true}),e=>e.status===409);
 const progress=await store.status();assert.equal(progress.delivery.active,true);assert.equal(progress.delivery.uncertain,1);
 resume();assert.equal((await first).status,200);assert.equal(calls,3);
});
test('phase 2 JSON migrates lazily; restart retains uncertain results until explicit retry',async()=>{
 const {file,confirm}=await setup();await confirm();const disk=await diskState(file);
 assert.equal(Object.values(disk.draw.deliveries).every(s=>s==='pending'),true);delete disk.draw.deliveryRevision;await writeState(file,disk);
 let calls=0;const restart=()=>new LocalStore(file,15,{configured:true,send:async()=>{calls++;return 'accepted';}});
 let store=restart();assert.equal((await store.status()).delivery.pending,3);
 disk.draw.deliveries=Object.fromEntries(disk.participants.map((p,i)=>[p.id,i===0?'uncertain':i===1?'accepted':'failed']));
 await writeState(file,disk);store=restart();
 let state=await store.status();await store.send({confirm:true,drawId:state.draw.completedAt,revision:state.delivery.revision});assert.equal(calls,1);
 store=restart();state=await store.status();assert.equal(state.delivery.uncertain,1);assert.equal(state.delivery.accepted,2);
 await store.send({confirm:true,drawId:state.draw.completedAt,revision:state.delivery.revision,retryUncertain:true});assert.equal(calls,2);
});
test('SMTP outcome is never persisted as accepted before confirmation; storage failure leaves uncertain on disk',async()=>{
 const {file,store,confirm,payload}=await setup({configured:true,send:async()=>{const disk=await diskState(file);assert.ok(Object.values(disk.draw.deliveries).includes('uncertain'));throw new Error('sensitive SMTP error');}});
 await confirm();await store.send(await payload());assert.equal((await store.status()).delivery.uncertain,3);
 const bad=await diskState(file);bad.draw.deliveries[bad.participants[0].id]='delivered';await assert.rejects(writeState(file,bad));
});
test('process termination leaves uncertain mail persistent and releases the OS lock',async()=>{
 const {file,confirm,payload}=await setup();await confirm();const request=await payload();
 const {spawn}=require('node:child_process');
 const child=spawn(process.execPath,['-e',`const {LocalStore}=require('./build/web/store');const store=new LocalStore(${JSON.stringify(file)},15,{configured:true,send:async()=>{console.log('ready');await new Promise(()=>{setInterval(()=>{},1000)});return 'accepted'}});store.send(${JSON.stringify(request)})`],{stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',()=>reject(new Error('child exited')));});
 await assert.rejects(storageLock(file));
 const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await done;
 // flock's holder exits asynchronously when the dead parent's pipe closes.
 let release;
 for(let i=0;i<100;i++){try{release=await storageLock(file);break;}catch{await new Promise(r=>setTimeout(r,10));}}
 assert.ok(release);await release();
 let sent=0;const restarted=new LocalStore(file,15,{configured:true,send:async()=>{sent++;return 'accepted';}});
 let state=await restarted.status();assert.equal(state.delivery.uncertain,1);assert.equal(state.delivery.pending,2);
 await restarted.send({confirm:true,drawId:state.draw.completedAt,revision:state.delivery.revision});
 assert.equal(sent,2);assert.equal((await restarted.status()).delivery.uncertain,1);
});
test('failed persistence after SMTP acceptance keeps an uncertain result after restart',async()=>{
 const originalWrite=EncryptedDatabase.prototype.write;
 const {file,confirm,store,payload}=await setup({configured:true,send:async()=>{EncryptedDatabase.prototype.write=function(){throw new Error('disk failure');};return 'accepted';}});
 await confirm();const request=await payload();
 try{await assert.rejects(store.send(request),/disk failure/);}finally{EncryptedDatabase.prototype.write=originalWrite;}
 const restarted=new LocalStore(file,15,{configured:true,send:async()=>assert.fail('uncertain must not resend')});
 const state=await restarted.status();assert.equal(state.delivery.uncertain,1);assert.equal(state.delivery.accepted,0);
});
test('web SMTP transport sends only the individual assignment and classifies definite rejections conservatively',async()=>{
 const nodemailer=require('nodemailer');const original=nodemailer.createTransport;
 let options,message,closed=0,mode='accepted';
 nodemailer.createTransport=o=>{options=o;return {sendMail:async m=>{message=m;if(mode==='reject')throw {responseCode:550,message:'private error'};if(mode==='timeout')throw new Error('private timeout');return {accepted:[m.to]};},close:()=>closed++};};
 try{
  const sender=smtpSender({APP_MODE:'production',HOST:'smtp.example.invalid',FROM:'"Organizador" <sender@example.invalid>',PORT:'465',MAILUSER:'synthetic',MAILPWD:'synthetic'});
  const input={to:'ana@example.invalid',name:'Ana',receiver:'Bea'};
  assert.equal(sender.configured,true);assert.equal(await sender.send(input),'accepted');
  assert.equal(options.secure,true);assert.equal(message.to,input.to);assert.match(message.text,/Hola Ana/);assert.match(message.text,/regalar a Bea/);assert.equal(message.cc,undefined);assert.equal(message.bcc,undefined);
  assert.equal(message.subject,'Amigo invisible');
  assert.equal(message.html,assignmentContent(input.name,input.receiver).html);
  assert.equal(message.text,assignmentContent(input.name,input.receiver).text);
  assert.doesNotMatch(message.html+message.text,/Cora|cora@example\.invalid|bea@example\.invalid|assignments|giver/);
  mode='reject';assert.equal(await sender.send(input),'failed');mode='timeout';assert.equal(await sender.send(input),'uncertain');assert.equal(closed,3);
 }finally{nodemailer.createTransport=original;}
});
test('preview leaves SQLite, key and delivery states unchanged and does not invoke SMTP',async()=>{
 let calls=0;
 const {store,file,confirm,payload}=await setup({configured:true,send:async()=>['accepted','failed','uncertain'][calls++]});
 await confirm();await store.send(await payload());
 assert.equal(calls,3);
 const before=await diskState(file), bytes=await fs.readFile(file);
 const keyPath=path.join(path.dirname(file),'../keys/storage.key'), key=await fs.readFile(keyPath);
 const app=createApp(store);
 for(let i=0;i<2;i++){
  const preview=await app.fetch(new Request('http://localhost/mail-preview'));
  assert.equal(preview.status,200);
  const html=await preview.text();assert.match(html,/ejemplo ficticio/);
  for(const p of before.participants){assert.equal(html.includes(p.name),false);assert.equal(html.includes(p.email),false);assert.equal(html.includes(p.id),false);}
 }
 assert.equal(calls,3);assert.deepEqual(await fs.readFile(file),bytes);assert.deepEqual(await fs.readFile(keyPath),key);
 assert.deepEqual(await diskState(file),before);
});
