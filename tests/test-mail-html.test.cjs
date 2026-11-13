const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const nodemailer=require('nodemailer');
const {smtpDelivery}=require('../build/mail/delivery');
const {smtpSender}=require('../build/web/mail');
const {assignmentContent}=require('../build/web/mail-template');
const {createHtmlMessage}=require('../build/utils/messageUtils');
const config={APP_MODE:'test',TEST_EMAIL:'test@example.invalid',HOST:'smtp.example.invalid',PORT:'465',FROM:'Synthetic <sender@example.invalid>',MAILUSER:'synthetic',MAILPWD:'synthetic'};

async function capture(run){
 const original=nodemailer.createTransport,messages=[],compiled=[];
 // Exercise Nodemailer's real MIME/Message-ID generation entirely in memory, without a socket.
 nodemailer.createTransport=()=>{
  const transport=original({streamTransport:true,buffer:true});
  return {async sendMail(message){messages.push(message);const info=await transport.sendMail(message);compiled.push(info);return {...info,accepted:[message.to],rejected:[],response:'250 2.0.0 synthetic acceptance'};},close(){transport.close();}};
 };
 try{await run({messages,compiled});}finally{nodemailer.createTransport=original;}
}
function documentFor(html){
 assert.match(html,/^<!doctype html>/i);
 for(const tag of ['html','head','body']){
  assert.equal((html.match(new RegExp(`<${tag}\\b`,'gi'))||[]).length,1);
  assert.equal((html.match(new RegExp(`</${tag}\\s*>`,'gi'))||[]).length,1);
 }
 const document=new JSDOM(html).window.document;
 assert.equal(document.doctype.name,'html');
 assert.equal(document.compatMode,'CSS1Compat');
 assert.equal(document.body.querySelector('meta,title'),null);
 return document;
}

test('test web mail keeps the document, original content and text; banner stays escaped inside body',async()=>{
 await capture(async({messages,compiled})=>{
  const input={to:'person@example.invalid',name:'Synthetic $& <script> & "name"',receiver:'Synthetic recipient'};
  const original=assignmentContent(input.name,input.receiver);
  assert.equal(await smtpSender(config).send(input),'accepted');
  const message=messages[0],document=documentFor(message.html);
  const notice=`PRUEBA — Participante original: ${input.name}`;
  assert.equal(document.body.firstElementChild.tagName,'P');
  assert.equal(document.body.firstElementChild.textContent,notice);
  assert.equal(document.querySelector('script'),null);
  assert.equal(document.head.querySelector('meta[charset]').getAttribute('charset'),'utf-8');
  assert.equal(document.documentElement.lang,'es');
  const withoutBanner=new JSDOM(message.html).window.document;withoutBanner.body.firstElementChild.remove();
  assert.equal(withoutBanner.documentElement.outerHTML,new JSDOM(original.html).window.document.documentElement.outerHTML);
  assert.equal(message.text,notice+'\n\n'+original.text);
  assert.equal(message.subject,'[PRUEBA] Amigo invisible');
  assert.equal(message.to,config.TEST_EMAIL);assert.deepEqual(message.envelope.to,[config.TEST_EMAIL]);
  assert.equal(message.cc,undefined);assert.equal(message.bcc,undefined);
  const mime=compiled[0].message.toString();assert.match(mime,/Content-Type: multipart\/alternative/);assert.match(mime,/Content-Type: text\/plain; charset=utf-8/);assert.match(mime,/Content-Type: text\/html; charset=utf-8/);
 });
});

test('test CLI fragments become one complete document without losing their original HTML',async()=>{
 await capture(async({messages})=>{
  const fragment=createHtmlMessage({name:'Synthetic name'},'Synthetic recipient');
  await smtpDelivery(config).send({to:'person@example.invalid',participant:'Synthetic name',subject:'CLI',text:'Original plain text',html:fragment});
  const message=messages[0],document=documentFor(message.html);
  assert.ok(message.html.includes(fragment));assert.equal(document.body.firstElementChild.textContent,'PRUEBA — Participante original: Synthetic name');
  assert.equal(message.text,'PRUEBA — Participante original: Synthetic name\n\nOriginal plain text');
  assert.equal(message.to,config.TEST_EMAIL);assert.deepEqual(message.envelope.to,[config.TEST_EMAIL]);
 });
});

test('body attributes and case survive inserting the banner without duplicating document tags',async()=>{
 await capture(async({messages})=>{
  const html='<!DOCTYPE html><HTML><HEAD><title>Original</title></HEAD><BODY class="original"><p>Original content</p></BODY></HTML>';
  await smtpDelivery(config).send({to:'person@example.invalid',participant:'Synthetic',subject:'Test',text:'Original',html});
  const document=documentFor(messages[0].html);assert.equal(document.body.className,'original');assert.equal(document.body.lastElementChild.textContent,'Original content');assert.equal(document.head.querySelector('title').textContent,'Original');
 });
});

test('production keeps original HTML, text, subject and recipient byte for byte',async()=>{
 await capture(async({messages})=>{
  const content=assignmentContent('Synthetic name','Synthetic recipient');
  await smtpSender({...config,APP_MODE:'production'}).send({to:'person@example.invalid',name:'Synthetic name',receiver:'Synthetic recipient'});
  const message=messages[0];assert.equal(message.html,content.html);assert.equal(message.text,content.text);assert.equal(message.subject,'Amigo invisible');assert.equal(message.to,'person@example.invalid');assert.deepEqual(message.envelope.to,['person@example.invalid']);assert.doesNotMatch(message.html,/PRUEBA/);
 });
});

test('distinct deliveries get distinct MIME Message-IDs even for identical test content and recipient',async()=>{
 await capture(async({compiled,messages})=>{
  const sender=smtpSender(config),input={to:'person@example.invalid',name:'Synthetic name',receiver:'Synthetic recipient'};
  await sender.send(input);await sender.send(input);
  assert.ok(compiled[0].messageId);assert.ok(compiled[1].messageId);assert.notEqual(compiled[0].messageId,compiled[1].messageId);
  for(let i=0;i<2;i++){assert.ok(compiled[i].message.toString().includes('Message-ID: '+compiled[i].messageId));assert.equal(messages[i].to,config.TEST_EMAIL);assert.deepEqual(compiled[i].envelope.to,[config.TEST_EMAIL]);}
 });
});
