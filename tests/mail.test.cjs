const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {assignmentContent}=require('../build/web/mail-template');
const {createApp}=require('../build/web/app');

test('assignment HTML and plain text contain the same personalized message without external resources',()=>{
 const {html,text}=assignmentContent('Alicia de prueba','Bruno de prueba');
 const document=new JSDOM(html).window.document;
 assert.equal(document.documentElement.lang,'es');
 assert.ok(document.querySelector('meta[name="viewport"]'));
 assert.equal(document.querySelector('h1').textContent,'secretGift');
 for(const phrase of ['Hola Alicia de prueba:', 'En el sorteo de amigo invisible te ha tocado regalar a', 'Bruno de prueba', 'Mantén tu asignación en secreto. ¡Disfruta preparando el regalo!', 'Felices fiestas']){
  assert.ok(document.body.textContent.includes(phrase));assert.ok(text.includes(phrase));
 }
 assert.equal(document.querySelectorAll('script, img, link, iframe, object, embed, form, [src], [href]').length,0);
 assert.doesNotMatch(html,/url\s*\(|@import/i);
 assert.doesNotMatch(text,/<\/?(?:html|table|p)\b/);
 assert.notEqual(assignmentContent('Otra persona','Otro destinatario').html,html);
});

test('both dynamic names are escaped as text, including malicious markup, quotes and ampersands',()=>{
 const values=['Álex & "Sol" <Luna> \'Nieve\'', '</p><script>alert("name")</script><img src=x onerror=alert(1)>'];
 for(const name of values)for(const receiver of values){
  const {html,text}=assignmentContent(name,receiver);
  const document=new JSDOM(html).window.document;
  assert.equal(document.querySelector('script, img, luna'),null);
  assert.ok(document.body.textContent.includes(`Hola ${name}:`));
  assert.ok([...document.querySelectorAll('p')].some(p=>p.textContent===receiver));
  assert.ok(text.includes(`Hola ${name}:`));assert.ok(text.includes(`regalar a ${receiver}.`));
  assert.ok(html.includes('&lt;'));assert.ok(html.includes('&quot;'));
  if(name===values[0]){assert.ok(html.includes('&amp;'));assert.ok(html.includes('&#39;'));}
 }
});

test('preview uses only fixed fictitious names and never accesses storage or SMTP',async()=>{
 const forbidden=new Proxy({}, {get(){assert.fail('Preview must not access the store or its mail sender');}});
 const app=createApp(forbidden);
 const expected=assignmentContent('Lucía (ejemplo ficticio)','Mateo (ejemplo ficticio)').html;
 for(const query of ['', '?name=REAL_PERSON&receiver=REAL_RECEIVER&drawId=private']){
  const response=await app.fetch(new Request('http://localhost/mail-preview'+query));
  assert.equal(response.status,200);assert.equal(await response.text(),expected);
  assert.equal(response.headers.get('content-type'),'text/html; charset=utf-8');
  assert.equal(response.headers.get('cache-control'),'no-store');
  const policy=response.headers.get('content-security-policy');
  assert.match(policy,/default-src 'none'/);assert.match(policy,/style-src 'unsafe-inline'/);assert.match(policy,/sandbox/);
 }
 const head=await app.fetch(new Request('http://localhost/mail-preview',{method:'HEAD'}));
 assert.equal(head.status,200);assert.equal(await head.text(),'');
 assert.equal((await app.fetch(new Request('http://localhost/mail-preview',{method:'POST'}))).status,405);
});
