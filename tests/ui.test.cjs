const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { script } = require('../build/web/ui');

// Minimal DOM with select value/reset semantics, exercising the shipped script.
function ui() {
 class Element {
  constructor() { this.children = []; this._value = ''; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  add(option) { this.children.push(option); }
  get value() { return this.select && !this.children.some(o => o.value === this._value) ? '' : this._value; }
  set value(value) { this._value = value; }
  focus() {}
 }
 const ids = ['form','form-title','name','email','previous','fields','participants','count','draw','reset','draw-status','message','cancel'];
 const elements = Object.fromEntries(ids.map(id => [id,new Element()]));
 elements.previous.select = true;
 elements.form.reset = () => { for (const id of ['name','email','previous']) elements[id].value = ''; };
 let data = {participants:[
  {id:'a',name:'A',email:'a@example.invalid',previousId:'b'},
  {id:'b',name:'B',email:'b@example.invalid',previousId:null},
  {id:'c',name:'C',email:'c@example.invalid',previousId:null}
 ],maxParticipants:15,draw:{completed:false}};
 const calls = []; let fail = false;
 const context = vm.createContext({document:{getElementById:id=>elements[id],createElement:()=>new Element()},Option:class {constructor(text,value){this.text=text;this.value=value;}},confirm:()=>true,
  fetch:async (url,options) => {
   calls.push({url,...options});
   if (options.method === 'PUT' && !fail) { const body=JSON.parse(options.body);data={...data,participants:data.participants.map(p=>p.id==='a'?{...p,...body}:p)}; }
   return {ok:!fail,json:async()=>fail?{error:'Synthetic failure'}:data};
  }});
 vm.runInContext(script,context);
 return {elements,calls,run:code=>vm.runInContext(code,context),fail:value=>{fail=value;}};
}
const settle = () => new Promise(resolve=>setImmediate(resolve));
test('editing restores, preserves and saves previous recipient; cancel clears the form', async () => {
 const {elements:e,calls,run,fail} = ui(); await settle();
 e.participants.children[0].children[1].onclick();
 assert.equal(e.previous.value,'b'); assert.equal(e.name.value,'A');
 assert.equal(e.previous.children.some(o=>o.value==='a'),false);
 e.name.value='Edited A'; e.email.value='edited@example.invalid';e.previous.value='c';
 run('render()'); assert.equal(e.previous.value,'c'); assert.equal(e.name.value,'Edited A');
 fail(true);e.form.onsubmit({preventDefault(){}}); await settle();
 assert.equal(e.previous.value,'c');assert.equal(e.name.value,'Edited A');
 fail(false);e.form.onsubmit({preventDefault(){}}); await settle();
 const saved=JSON.parse(calls.filter(c=>c.method==='PUT').at(-1).body);
 assert.equal(saved.previousId,'c');assert.equal(saved.name,'Edited A');
 e.participants.children[0].children[1].onclick();assert.equal(e.previous.value,'c');
 e.cancel.onclick();assert.equal(e.previous.value,'');assert.equal(e.name.value,'');assert.equal(e.email.value,'');
 assert.equal(e.previous.children.some(o=>o.value==='a'),true);
});
