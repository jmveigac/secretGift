// Synthetic v1 fixture, independent of the current schema and migration code.
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomBytes,createCipheriv}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
async function createV1(file,keyPath,state){
 await fs.mkdir(path.dirname(file),{recursive:true});await fs.mkdir(path.dirname(keyPath),{recursive:true});
 const key=randomBytes(32);await fs.writeFile(keyPath,key,{mode:0o600});
 const seal=(data,context)=>{
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);
  cipher.setAAD(Buffer.from(`secretGift:1:${context}`));
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(data)),cipher.final()]);
  return Buffer.concat([Buffer.from([1]),nonce,cipher.getAuthTag(),encrypted]);
 };
 const db=new DatabaseSync(file);
 try{
  db.exec(`PRAGMA foreign_keys=ON;
   CREATE TABLE metadata (id INTEGER PRIMARY KEY CHECK(id=1), verifier BLOB NOT NULL);
   CREATE TABLE participants (id TEXT PRIMARY KEY, position INTEGER NOT NULL UNIQUE, private BLOB NOT NULL);
   CREATE TABLE draw (id INTEGER PRIMARY KEY CHECK(id=1), completed_at TEXT NOT NULL, revision TEXT);
   CREATE TABLE assignments (giver TEXT PRIMARY KEY REFERENCES participants(id), private BLOB NOT NULL,
    draw_id INTEGER NOT NULL REFERENCES draw(id), status TEXT NOT NULL CHECK(status IN ('pending','uncertain','accepted','failed')));
   CREATE INDEX assignments_draw ON assignments(draw_id);
   PRAGMA user_version=1;`);
  db.prepare('INSERT INTO metadata VALUES (1, ?)').run(seal('secretGift','key-verifier'));
  state.participants.forEach(({id,...data},i)=>db.prepare('INSERT INTO participants VALUES (?, ?, ?)').run(id,i,seal(data,`participant:${id}`)));
  if(state.draw){
   db.prepare('INSERT INTO draw VALUES (1, ?, ?)').run(state.draw.completedAt,state.draw.deliveryRevision??null);
   for(const a of state.draw.assignments)db.prepare('INSERT INTO assignments VALUES (?, ?, 1, ?)').run(a.giver,seal(a.receiver,`assignment:${a.giver}`),state.draw.deliveries?.[a.giver]??'pending');
  }
 }finally{db.close();}
 return key;
}
module.exports={createV1};
