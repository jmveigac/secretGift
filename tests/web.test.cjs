const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { LocalStore } = require('../build/web/store');
const { createApp } = require('../build/web/app');
const { createWebServer } = require('../build/web/server');
async function setup(t, max = 15) {
 await fs.mkdir('.task/tests', {recursive:true});
 const dir = await fs.mkdtemp(path.resolve('.task/tests/run-'));
 const file = path.join(dir,'data','state.json');
 const store = new LocalStore(file, max);
 const app = createApp(store);
 const call = (route, method='GET', body, headers={}) => app.fetch(new Request('http://localhost'+route, {method, headers: {'Content-Type':'application/json', ...headers}, body: body === undefined ? undefined : JSON.stringify(body)}));
 return {dir,file,store,app,call};
}
const person = name => ({name,email:name.toLowerCase()+'@example.invalid',previousId:null});

test('CRUD validates, normalizes, preserves ID references and clears deleted references', async t => {
 const {call} = await setup(t, 3);
 let r = await call('/api/participants','POST',person('A')); assert.equal(r.status,201);
 const a = (await r.json()).participants[0];
 r = await call('/api/participants','POST',{...person('B'),previousId:a.id}); const b=(await r.json()).participants[1];
 r = await call('/api/participants/'+a.id,'PUT',{...person('C'),name:'  C  '}); assert.equal(r.status,200);
 assert.equal((await r.json()).participants[1].previousId,a.id);
 for (const value of [person('C'), {...person('D'),email:'bad'}, {...person('D'),email:'c@example.invalid'}, {...person('D'),previousId:'missing'}, {...person('D'),name:'X'.repeat(101)}, {...person('D'),extra:true}, {...person('D'),email:'bad\u0000@example.invalid'}, {...person('D'),name:'bad\u0000name'}, null]) assert.equal((await call('/api/participants','POST',value)).status,400);
 assert.equal((await call('/api/participants/'+b.id,'PUT',{...person('B'),previousId:b.id})).status,400);
 await call('/api/participants','POST',person('D'));
 assert.equal((await call('/api/participants','POST',person('E'))).status,400);
 r=await call('/api/participants/'+a.id,'DELETE',{}); assert.equal((await r.json()).participants[0].previousId,null);
 assert.equal((await call('/api/participants/'+a.id,'DELETE',{})).status,404);
});

test('draw requires confirmation, persists privately, locks edits and survives a new store', async t => {
 const {call, file} = await setup(t);
 assert.equal((await call('/api/draw','POST',{confirm:true})).status,422);
 await call('/api/participants','POST',person('A')); await call('/api/participants','POST',person('B'));
 assert.equal((await call('/api/draw','POST',{})).status,400);
 const results = await Promise.all([call('/api/draw','POST',{confirm:true}),call('/api/draw','POST',{confirm:true})]);
 assert.deepEqual(results.map(r=>r.status),[200,409]);
 for (const response of [results[0], await call('/api/state')]) {
  const data=await response.json(); assert.equal(data.draw.completed,true); assert.equal(data.draw.participantCount,2);
  assert.equal(JSON.stringify(data).includes('assignments'),false);
 }
 const disk=JSON.parse(await fs.readFile(file,'utf8')); assert.equal(disk.draw.assignments.length,2);
 const restarted = new LocalStore(file); assert.equal((await restarted.status()).draw.completed,true);
 assert.equal((await call('/api/participants','POST',person('C'))).status,409);
 assert.equal((await call('/api/draw/reset','POST',{})).status,400);
 assert.equal((await call('/api/draw/reset','POST',{confirm:true})).status,200);
 assert.equal((await restarted.status()).participants.length,2);
 assert.equal((await restarted.status()).draw.completed,false);
 assert.equal((await fs.stat(file)).mode & 0o777,0o600);
 assert.equal((await fs.stat(path.dirname(file))).mode & 0o777,0o700);
});

test('serialized updates, atomic replacement and corrupt storage protection', async t => {
 const {call,file,store} = await setup(t);
 const responses = await Promise.all(Array.from({length:10},(_,i)=>call('/api/participants','POST',person('P'+i))));
 assert.ok(responses.every(r=>r.status===201)); assert.equal((await store.status()).participants.length,10);
 const handle=await fs.open(file,'r');
 await call('/api/participants','POST',person('New'));
 assert.equal(JSON.parse(await handle.readFile('utf8')).participants.length,10); assert.equal(JSON.parse(await fs.readFile(file,'utf8')).participants.length,11); await handle.close();
 assert.deepEqual(await fs.readdir(path.dirname(file)),['state.json']);
 for (const corrupt of ['{bad', JSON.stringify({version:1,participants:[],draw:{assignments:[]}})]) {
  await fs.writeFile(file,corrupt);
  assert.equal((await call('/api/state')).status,503);
  assert.equal((await call('/api/participants','POST',person('Blocked'))).status,503);
  assert.equal(await fs.readFile(file,'utf8'),corrupt);
 }
});

test('storage failure does not report success or poison mutation queue', async t => {
 const {dir} = await setup(t); const blocked=path.join(dir,'blocked'); await fs.writeFile(blocked,'x');
 const store=new LocalStore(path.join(blocked,'state.json'));
 await assert.rejects(store.status()); await assert.rejects(store.mutate('add',person('A')));
});

test('HTTP adapter accepts bodies, limits sizes and protects private routes', async t => {
 const {app} = await setup(t); const server=createWebServer(app);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port;
 const post=(route,body,extra={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...extra},body});
 assert.equal((await post('/api/participants',JSON.stringify(person('A')))).status,201);
 assert.equal((await post('/api/participants','{')).status,400);
 assert.equal((await post('/api/participants','x'.repeat(9000))).status,413);
 assert.equal((await post('/api/participants','{}',{'Content-Type':'text/plain'})).status,415);
 assert.equal((await post('/api/draw','{"confirm":true}',{Origin:'http://evil.invalid'})).status,403);
 for(const route of ['/api/mail','/.env','/data/state.json','/participants.json','/src/web/store.ts','/../state.json']) assert.equal((await fetch(base+route)).status,404);
 const health=await fetch(base+'/api/health'); assert.deepEqual(await health.json(),{status:'ok'});
 assert.equal(health.headers.get('cache-control'),'no-store'); assert.ok(health.headers.get('content-security-policy'));
 assert.equal((await post('/api/health','{}')).status,405);
 assert.equal((await fetch(base+'/api/draw')).status,405);
 assert.equal(await (await fetch(base+'/api/state',{method:'HEAD'})).text(),'');
 const home=await fetch(base);const html=await home.text();
 assert.match(html,/secretGift/);assert.match(html,/<div id="root"><\/div>/);
 const assetPaths=[...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(match=>match[1]);
 assert.equal(assetPaths.length,2);
 for (const asset of assetPaths) {
  const response=await fetch(base+asset);assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),asset.endsWith('.js')?/text\/javascript/:/text\/css/);
  assert.equal((await fetch(base+asset,{method:'HEAD'})).status,200);
 }
 assert.equal(home.headers.get('content-security-policy').includes('unsafe-inline'),false);
 for (const route of ['/app.js','/src/main.tsx','/frontend/src/App.tsx','/vite.config.mts','/assets/../state.json','/assets/%2e%2e%2fstate.json','/assets/index.js.map','/assets/missing.js','/assets/.env']) assert.equal((await fetch(base+route)).status,404);
});

test('failed atomic replacement preserves committed state and releases the queue', async t => {
 const {store,file} = await setup(t);
 await store.mutate('add',person('A'));
 const before=await fs.readFile(file,'utf8');
 const rename=fs.rename;
 fs.rename=async()=>{throw new Error('synthetic write error');};
 try { await assert.rejects(store.mutate('add',person('B'))); } finally {fs.rename=rename;}
 assert.equal(await fs.readFile(file,'utf8'),before);
 assert.deepEqual(await fs.readdir(path.dirname(file)),['state.json']);
 assert.equal((await store.mutate('add',person('B'))).participants.length,2);
});

test('direct Request API also enforces streaming body limits and impossible restrictions', async t => {
 const {app,call} = await setup(t);
 const response=await app.fetch(new Request('http://localhost/api/participants',{method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(9000)}));
 assert.equal(response.status,413);
 let r=await call('/api/participants','POST',person('A'));const a=(await r.json()).participants[0];
 r=await call('/api/participants','POST',{...person('B'),previousId:a.id}); const b=(await r.json()).participants[1];
 await call('/api/participants/'+a.id,'PUT',{...person('A'),previousId:b.id});
 assert.equal((await call('/api/draw','POST',{confirm:true})).status,422);
 assert.equal((await (await call('/api/state')).json()).draw.completed,false);
});

test('HTTP rejects attacker-controlled Host even when Origin matches it', async t => {
 const {app,store} = await setup(t);const server=createWebServer(app);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const port=server.address().port;
 const request=(host,origin,target='/api/participants')=>new Promise((resolve,reject)=>{
  const req=require('node:http').request({hostname:'127.0.0.1',port,path:target,method:'POST',headers:{Host:host,Origin:origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json'}},res=>{
   res.resume();res.on('end',()=>resolve(res.statusCode));
  });req.on('error',reject);req.end(JSON.stringify(person('HostTest')));
 });
 assert.equal(await request(`evil.invalid:${port}`,`http://evil.invalid:${port}`),403);
 assert.equal(await request(`localhost:${port}`,'http://evil.invalid'),403);
 assert.equal(await request(`localhost:${port}`,`http://localhost:${port}`,'http://evil.invalid/api/participants'),400);
 assert.equal((await store.status()).participants.length,0);
 assert.equal(await request(`localhost:${port}`,`http://localhost:${port}`),201);
});

test('directory synchronization failure after rename reports the committed state honestly', async t => {
 const {store,file,call} = await setup(t);await store.mutate('add',person('A'));
 const originalOpen=fs.open;let directorySyncs=0;
 fs.open=async (...args)=>{
  const handle=await originalOpen(...args);
  if (args[0]===path.dirname(file) && args[1]==='r') handle.sync=async()=>{directorySyncs++;throw new Error('synthetic directory sync failure');};
  return handle;
 };
 let response;
 try {response=await call('/api/participants','POST',person('B'));} finally {fs.open=originalOpen;}
 assert.equal(directorySyncs,1);assert.equal(response.status,503);
 assert.match((await response.json()).error,/durabilidad/);
 assert.equal((await store.status()).participants.length,2);
 assert.equal(JSON.parse(await fs.readFile(file,'utf8')).participants.length,2);
 assert.equal((await fs.stat(file)).mode&0o777,0o600);
 assert.equal((await fs.stat(path.dirname(file))).mode&0o777,0o700);
 assert.equal((await store.mutate('add',person('C'))).participants.length,3);
});

test('write and file-sync failures before rename preserve state and permissions', async t => {
 const {store,file} = await setup(t);await store.mutate('add',person('A'));
 const before=await fs.readFile(file,'utf8');
 for (const operation of ['writeFile','sync']) {
  const originalOpen=fs.open;
  fs.open=async (...args)=>{
   const handle=await originalOpen(...args);
   if (args[1]==='wx') handle[operation]=async()=>{throw new Error('synthetic pre-rename failure');};
   return handle;
  };
  try {await assert.rejects(store.mutate('add',person('B')),/synthetic pre-rename failure/);} finally {fs.open=originalOpen;}
  assert.equal(await fs.readFile(file,'utf8'),before);
  assert.deepEqual(await fs.readdir(path.dirname(file)),['state.json']);
  assert.equal((await fs.stat(file)).mode&0o777,0o600);
  assert.equal((await fs.stat(path.dirname(file))).mode&0o777,0o700);
 }
 assert.equal((await store.mutate('add',person('B'))).participants.length,2);
});

test('atomic write syncs the directory only after file synchronization and rename', async t => {
 const {store,file} = await setup(t);await store.mutate('add',person('A'));
 const originalOpen=fs.open, originalRename=fs.rename;const events=[];
 fs.open=async (...args)=>{
  const handle=await originalOpen(...args),sync=handle.sync.bind(handle);
  const kind=args[1]==='wx'?'file':args[0]===path.dirname(file)?'directory':null;
  if (kind) handle.sync=async()=>{events.push(kind);return sync();};
  return handle;
 };
 fs.rename=async (...args)=>{events.push('rename');return originalRename(...args);};
 try {await store.mutate('add',person('B'));} finally {fs.open=originalOpen;fs.rename=originalRename;}
 assert.deepEqual(events,['file','rename','directory']);
});
