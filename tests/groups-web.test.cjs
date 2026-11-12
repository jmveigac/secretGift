const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {LocalStore}=require('../build/web/store');
const {createApp}=require('../build/web/app');
const {EncryptedDatabase}=require('../build/web/database');
const {createV1}=require('./helpers/v1-storage.cjs');
const {DatabaseSync}=require('node:sqlite');
async function setup(mail={configured:true,send:async()=>assert.fail('Unexpected SMTP')}){
 await fs.mkdir('.task/tests',{recursive:true});const root=await fs.mkdtemp(path.resolve('.task/tests/groups-web-'));
 const file=path.join(root,'data/state.sqlite'),key=path.join(root,'keys/storage.key');
 const restart=()=>createApp(new LocalStore(file,15,mail,key));let app=restart();
 const call=async(route,method='GET',body,headers={})=>{
  const response=await app.fetch(new Request('http://localhost'+route,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)}));
  const data=method==='HEAD'?null:await response.json();
  assert.doesNotMatch(JSON.stringify(data),/"(?:assignments|receiver|giver|private|verifier)"/);
  return {status:response.status,data};
 };
 const create=async name=>{const r=await call('/api/groups','POST',{name});assert.equal(r.status,201);return r.data;};
 const get=async id=>(await call('/api/groups/'+id)).data;
 const manage=async(g,suffix,method,body)=>call('/api/groups/'+g.group.id+suffix,method,{...body,expectedRevision:g.revision});
 const add=async(g,name)=>{const r=await manage(g,'/people','POST',{name,email:name.toLowerCase()+'@example.invalid'});assert.equal(r.status,201);return r.data;};
 const edition=async(g,name,ids=g.people.filter(p=>p.active).map(p=>p.id))=>{const r=await manage(g,'/editions','POST',{name,year:2026,personIds:ids});assert.equal(r.status,201);return r.data;};
 const base=(g,e)=>`/api/groups/${g.group.id}/editions/${e}`;
 const state=async(g,e)=>(await call(base(g,e))).data;
 const write=async(g,e,s,suffix,body={},method='POST')=>call(base(g,e)+suffix,method,{...body,expectedRevision:s.revision});
 return {root,file,key,call,create,get,manage,add,edition,base,state,write,restart:()=>{app=restart();},open:()=>EncryptedDatabase.open(file,key,path.join(root,'data/state.json'),()=>{})};
}
test('group and person management is scoped, validated, revision checked and persistent',async()=>{
 const f=await setup();let a=await f.create('Familia'),b=await f.create('Amigos');
 assert.equal((await f.call('/api/groups','POST',{name:'  FAMILIA  '})).status,409);
 for(const name of ['', ' ', 'bad\u0000name', 'x'.repeat(101)])assert.equal((await f.call('/api/groups','POST',{name})).status,400);
 const stale=a;a=await f.add(a,'Ana');assert.equal((await f.manage(stale,'/people','POST',{name:'Bea',email:'b@example.invalid'})).status,409);
 assert.equal((await f.get(b.group.id)).people.length,0);
 assert.equal((await f.manage(a,'/people','POST',{name:'ANA',email:'other@example.invalid'})).status,409);
 assert.equal((await f.manage(b,'/people/'+a.people[0].id,'PUT',{name:'Otra',email:'other@example.invalid',active:true})).status,404);
 let r=await f.manage(a,'','PUT',{name:'Casa'});assert.equal(r.status,200);a=r.data;
 r=await f.manage(a,'/people/'+a.people[0].id,'PUT',{name:'Ana nueva',email:'new@example.invalid',active:false});assert.equal(r.status,200);a=r.data;
 const id=a.people[0].id;assert.equal(a.people[0].active,false);
 r=await f.manage(a,'/people/'+id,'PUT',{name:'Ana nueva',email:'new@example.invalid',active:true});assert.equal(r.status,200);a=r.data;
 f.restart();assert.deepEqual(await f.get(a.group.id),a);assert.equal((await f.get(b.group.id)).people.length,0);
 assert.equal((await f.call('/api/groups/'+a.group.id,'DELETE',{})).status,405);
 assert.equal((await f.call('/api/groups/'+randomUUID())).status,404);
 assert.equal((await f.manage(a,'/people','POST',{name:'Bad',email:'bad'})).status,400);
 assert.equal((await f.call('/api/groups','POST',{name:'Blocked'},{Origin:'http://evil.invalid'})).status,403);
});
test('editions capture selected active people, preserve contact snapshots and isolate independent draws',async()=>{
 const f=await setup();let a=await f.create('Familia'),b=await f.create('Trabajo');
 for(const name of ['Ana','Bea','Cora'])a=await f.add(a,name);
 b=await f.add(b,'Ana');b=await f.add(b,'Bea');
 a=await f.edition(a,'Navidad',a.people.slice(0,2).map(p=>p.id));const first=a.editions[0].edition.id;
 let s=await f.state(a,first);assert.equal(s.participants.length,2);assert.equal(s.participants[0].name,'Ana');
 const contact=a.people[0];let r=await f.manage(a,'/people/'+contact.id,'PUT',{name:'Ana actual',email:'updated@example.invalid',active:contact.active});assert.equal(r.status,200);a=r.data;
 assert.equal((await f.state(a,first)).participants[0].name,'Ana');
 a=await f.edition(a,'Verano');const second=a.editions[1].edition.id;assert.notEqual(first,second);
 assert.equal((await f.state(a,second)).participants[0].name,'Ana actual');
 assert.equal((await f.manage(a,'/editions','POST',{name:'NAVIDAD',year:2026,personIds:[]})).status,409);
 assert.equal((await f.manage(a,'/editions','POST',{name:'Foreign',year:2026,personIds:[b.people[0].id]})).status,400);
 r=await f.manage(a,'/people/'+contact.id,'PUT',{name:a.people[0].name,email:a.people[0].email,active:false});a=r.data;
 assert.equal((await f.manage(a,'/editions','POST',{name:'Inactive',year:2026,personIds:[contact.id]})).status,400);
 assert.equal((await f.write(a,first,s,'/draw',{confirm:true})).status,200);
 assert.equal((await f.write(a,first,s,'/draw',{confirm:true})).status,409);
 assert.equal((await f.write(a,second,s,'/draw',{confirm:true})).status,409);
 assert.equal((await f.call(f.base(b,first))).status,404);
 b=await f.edition(b,'Navidad');const other=b.editions[0].edition.id;
 let t=await f.state(b,other);assert.equal(t.draw.completed,false);assert.equal((await f.write(b,other,t,'/draw',{confirm:true})).status,200);
 assert.equal((await f.state(a,second)).draw.completed,false);
 const drawn=await f.state(a,first);
 assert.equal((await f.write(a,first,drawn,'/participants/'+contact.id,{name:'Historia alterada',email:'x@example.invalid',previousId:null},'PUT')).status,409);
 const bytes=await fs.readFile(f.file);await f.get(a.group.id);await f.state(a,first);assert.deepEqual(await fs.readFile(f.file),bytes);
 f.restart();assert.equal((await f.state(a,first)).draw.completed,true);assert.equal((await f.state(b,other)).draw.completed,true);
});
test('scoped participant form preserves identities, rejects stale changes and reset forks without altering history',async()=>{
 const f=await setup();let g=await f.create('Grupo');g=await f.edition(g,'Inicial',[]);const id=g.editions[0].edition.id;
 let s=await f.state(g,id),r=await f.write(g,id,s,'/participants',{name:'Ana',email:'ana@example.invalid',previousId:null});assert.equal(r.status,201);s=r.data;
 r=await f.write(g,id,s,'/participants',{name:'Bea',email:'bea@example.invalid',previousId:null});assert.equal(r.status,201);const stale=s;s=r.data;
 assert.equal((await f.write(g,id,stale,'/participants/'+s.participants[0].id,{},'DELETE')).status,409);
 assert.equal((await f.get(g.group.id)).people.length,2);
 r=await f.write(g,id,s,'/participants/'+s.participants[1].id,{},'DELETE');assert.equal(r.status,200);
 const identity=s.participants[1].id;s=r.data;
 r=await f.write(g,id,s,'/participants',{personId:identity,expectedGroupRevision:g.revision});assert.equal(r.status,409);
 r=await f.write(g,id,s,'/participants',{personId:identity,expectedGroupRevision:(await f.get(g.group.id)).revision});assert.equal(r.status,201);s=r.data;
 assert.equal(s.participants[1].id,identity);assert.equal((await f.get(g.group.id)).people.length,2);
 r=await f.write(g,id,s,'/participants/'+s.participants[0].id,{name:'Ana edición',email:'snapshot@example.invalid',previousId:null},'PUT');assert.equal(r.status,200);s=r.data;
 assert.equal((await f.get(g.group.id)).people[0].name,'Ana');
 r=await f.write(g,id,s,'/draw',{confirm:true});assert.equal(r.status,200);s=r.data;
 const original=s;const db=await f.open();const privateState=db.readEdition(g.group.id,id);db.close();
 r=await f.write(g,id,s,'/draw/reset',{confirm:true});assert.equal(r.status,200);assert.notEqual(r.data.scope.editionId,id);assert.equal(r.data.draw.completed,false);
 assert.deepEqual(await f.state(g,id),original);
 const check=await f.open();try{assert.deepEqual(check.readEdition(g.group.id,id),privateState);}finally{check.close();}
 const all=await f.get(g.group.id);assert.equal(all.editions.length,2);
});
test('scoped SMTP retains acceptance, uncertainty, revisions and storage-wide exclusion during sends',{timeout:15000},async()=>{
 let resume,started;const ready=new Promise(r=>started=r),wait=new Promise(r=>resume=r);const sent=[];
 const f=await setup({configured:true,send:async m=>{sent.push(m);if(sent.length===1){started();await wait;return 'accepted';}return sent.length===2?'uncertain':'accepted';}});
 let a=await f.create('A'),b=await f.create('B');for(const n of ['Ana','Bea','Cora'])a=await f.add(a,n);
 a=await f.edition(a,'Edición');const id=a.editions[0].edition.id;
 let s=await f.state(a,id);s=(await f.write(a,id,s,'/draw',{confirm:true})).data;
 assert.equal((await f.write(a,id,s,'/draw/send',{confirm:false,drawId:s.draw.completedAt,revision:s.delivery.revision})).status,400);
 const input={confirm:true,drawId:s.draw.completedAt,revision:s.delivery.revision};
 const sending=f.write(a,id,s,'/draw/send',input);await ready;
 try{
  assert.equal((await f.manage(b,'/people','POST',{name:'Blocked',email:'blocked@example.invalid'})).status,409);
  assert.equal((await f.write(a,id,s,'/draw/reset',{confirm:true})).status,409);
  assert.equal((await f.write(a,id,s,'/draw/send',input)).status,409);
  assert.equal((await f.state(a,id)).delivery.active,true);
  assert.equal((await f.get(b.group.id)).busy,true);
 }finally{resume();}
 const result=await sending;assert.equal(result.status,200);s=result.data;assert.equal(s.delivery.accepted,2);assert.equal(s.delivery.uncertain,1);
 assert.equal((await f.write(a,id,s,'/draw/send',input)).status,409);assert.equal(sent.length,3);
 f.restart();s=await f.state(a,id);
 s=(await f.write(a,id,s,'/draw/send',{confirm:true,drawId:s.draw.completedAt,revision:s.delivery.revision})).data;assert.equal(sent.length,3);
 s=(await f.write(a,id,s,'/draw/send',{confirm:true,drawId:s.draw.completedAt,revision:s.delivery.revision,retryUncertain:true})).data;
 assert.equal(sent.length,4);assert.equal(s.delivery.accepted,3);
});
test('scoped new identities roll back with their participation and concurrent stale writers cannot both succeed',async()=>{
 const f=await setup();let g=await f.create('Atómico');g=await f.edition(g,'Preparación',[]);const id=g.editions[0].edition.id;
 let s=await f.state(g,id);
 let sql=new DatabaseSync(f.file);sql.exec("CREATE TRIGGER synthetic_failure BEFORE INSERT ON participants BEGIN SELECT RAISE(ABORT, 'synthetic private error'); END;");sql.close();
 const body={name:'Ana',email:'ana@example.invalid',previousId:null};
 let r=await f.write(g,id,s,'/participants',body);assert.equal(r.status,503);assert.doesNotMatch(JSON.stringify(r.data),/synthetic private error/);
 assert.equal((await f.get(g.group.id)).people.length,0);assert.deepEqual(await f.state(g,id),s);
 sql=new DatabaseSync(f.file);sql.exec('DROP TRIGGER synthetic_failure');sql.close();
 r=await f.write(g,id,s,'/participants',body);assert.equal(r.status,201);s=r.data;
 const results=await Promise.all(['Bea','Cora'].map(name=>f.write(g,id,s,'/participants',{name,email:name.toLowerCase()+'@example.invalid',previousId:null})));
 assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 assert.equal((await f.state(g,id)).participants.length,2);assert.equal((await f.get(g.group.id)).people.length,2);
 sql=new DatabaseSync(f.file);try{assert.equal(sql.prepare('PRAGMA user_version').get().user_version,4);}finally{sql.close();}
});
test('a scoped persistence failure after SMTP acceptance retains uncertainty and releases the lock',async()=>{
 const original=EncryptedDatabase.prototype.writeEdition;
 const f=await setup({configured:true,send:async()=>{EncryptedDatabase.prototype.writeEdition=function(){throw new Error('synthetic private persistence failure');};return 'accepted';}});
 let g=await f.create('Fallo seguro');g=await f.add(g,'Ana');g=await f.add(g,'Bea');g=await f.edition(g,'Prueba');const id=g.editions[0].edition.id;
 let s=await f.state(g,id);s=(await f.write(g,id,s,'/draw',{confirm:true})).data;
 try{assert.equal((await f.write(g,id,s,'/draw/send',{confirm:true,drawId:s.draw.completedAt,revision:s.delivery.revision})).status,503);}
 finally{EncryptedDatabase.prototype.writeEdition=original;}
 f.restart();s=await f.state(g,id);assert.equal(s.delivery.uncertain,1);assert.equal(s.delivery.pending,1);assert.equal(s.delivery.accepted,0);
 g=await f.get(g.group.id);assert.equal((await f.manage(g,'','PUT',{name:'Recuperado'})).status,200);
});
test('v1 data remains accessible through both APIs and preview never touches the selected group',async()=>{
 const f=await setup(),participants=['Ana','Bea'].map(name=>({id:randomUUID(),name,email:name.toLowerCase()+'@example.invalid',previousId:null}));
 await createV1(f.file,f.key,{version:1,participants,draw:null});
 const g=(await f.call('/api/groups')).data.groups[0],detail=await f.get(g.id),id=detail.editions[0].edition.id;
 assert.deepEqual((await f.state(detail,id)).participants,participants);
 assert.deepEqual((await f.call('/api/state')).data.participants,participants);
 const before=await fs.readFile(f.file);
 // Preview is HTML; exercise it directly rather than through the JSON helper.
 const preview=await createApp(new LocalStore(f.file,15,{configured:true,send:async()=>assert.fail('preview SMTP')},f.key)).fetch(new Request('http://localhost/mail-preview?groupId='+g.id));
 assert.match(await preview.text(),/ejemplo ficticio/);assert.deepEqual(await fs.readFile(f.file),before);
});
