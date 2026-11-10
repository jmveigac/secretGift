export const page = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>secretGift · Amigo invisible</title>
<style>:root{font-family:system-ui,sans-serif;color:#253b32;background:#f6f4ed}body{margin:0}main{max-width:54rem;margin:auto;padding:2rem 1rem}h1{font-size:clamp(3rem,9vw,5rem);margin:.5rem 0}.tag{color:#486d5a;letter-spacing:.1em}section{background:white;border:1px solid #d3ddd5;border-radius:1rem;padding:1.25rem;margin:1rem 0}p{line-height:1.6}label{display:block;margin:.7rem 0}input,select{display:block;box-sizing:border-box;width:100%;padding:.65rem;font:inherit;border:1px solid #9bad9f;border-radius:.4rem}button{font:inherit;background:#285440;color:white;border:0;border-radius:.5rem;padding:.65rem .9rem;margin:.25rem;cursor:pointer}button:disabled{opacity:.5;cursor:default}li{padding:.7rem 0;border-bottom:1px solid #d3ddd5;overflow-wrap:anywhere}ul{padding:0;list-style:none}.secondary{background:#edf1eb;color:#253b32}#message{min-height:1.5rem;font-weight:600}small{line-height:1.6}fieldset{border:0;padding:0;margin:0}</style><script src="/app.js" defer></script></head><body><main><p class="tag">AMIGO INVISIBLE · LOCAL</p><h1>secretGift</h1><p>Prepara la lista y deja que empiece la sorpresa.</p><p id="message" role="status" aria-live="polite"></p><section><h2>Participantes</h2><p id="count"></p><ul id="participants"></ul></section><section><h2 id="form-title">Añadir participante</h2><form id="form"><fieldset id="fields"><label>Nombre<input id="name" name="name" required maxlength="100" autocomplete="off"></label><label>Correo<input id="email" name="email" type="email" required maxlength="254" autocomplete="off"></label><label>Destinatario del año anterior (opcional)<select id="previous"><option value="">Sin restricción anterior</option></select></label><button type="submit">Guardar participante</button><button id="cancel" class="secondary" type="button">Cancelar edición</button></fieldset></form></section><section><h2>Estado del sorteo</h2><p id="draw-status">Cargando datos…</p><button id="draw" type="button" disabled>Realizar sorteo</button><button id="reset" type="button" class="secondary" disabled>Reiniciar sorteo</button></section><small>Uso local sin autenticación: cualquier persona con acceso puede consultar y modificar los datos. Se guardan sin cifrar en este equipo. No se muestran asignaciones ni se envían correos.</small><noscript><p>Activa JavaScript para gestionar el sorteo.</p></noscript></main></body></html>`;
export const script = `
const $ = id => document.getElementById(id);
let state, editing = null, busy = false;
function clearForm() { editing = null; $('form').reset(); $('form-title').textContent = 'Añadir participante'; render(); }
function render() {
 if (!state) return;
 const locked = state.draw.completed;
 $('count').textContent = state.participants.length + ' / ' + state.maxParticipants + ' participantes';
 $('participants').replaceChildren();
 for (const p of state.participants) {
  const li = document.createElement('li');
  const text = document.createElement('span');
  const previous = state.participants.find(x => x.id === p.previousId);
  text.textContent = p.name + ' · ' + p.email + (previous ? ' · Año anterior: ' + previous.name : ''); li.append(text);
  const edit = document.createElement('button'); edit.textContent = 'Editar'; edit.disabled = locked || busy;
  edit.onclick = () => { editing = p.id; render(); $('name').value = p.name; $('email').value = p.email; $('previous').value = p.previousId || ''; $('form-title').textContent = 'Editar participante'; $('name').focus(); };
  const remove = document.createElement('button'); remove.className = 'secondary'; remove.textContent = 'Eliminar'; remove.disabled = locked || busy;
  remove.onclick = () => { if (confirm('¿Eliminar a este participante? Se retirarán sus referencias del año anterior.')) perform('/api/participants/' + p.id, 'DELETE', {}); };
  li.append(edit, remove); $('participants').append(li);
 }
 const selected = $('previous').value; $('previous').replaceChildren(new Option('Sin restricción anterior', ''));
 state.participants.filter(p => p.id !== editing).forEach(p => $('previous').add(new Option(p.name, p.id)));
 $('previous').value = selected;
 $('fields').disabled = busy || locked || (!editing && state.participants.length >= state.maxParticipants);
 $('draw').disabled = busy || locked || state.participants.length < 2;
 $('reset').disabled = busy || !locked;
 $('draw-status').textContent = locked ? 'Sorteo completado · ' + state.draw.participantCount + ' participantes. Las asignaciones permanecen privadas.' : 'Pendiente. Nadie se regalará a sí mismo ni repetirá el destinatario anterior. La viabilidad se comprobará al realizar el sorteo.';
}
async function perform(path, method, body) {
 if (busy) return; busy = true; render(); $('message').textContent = '';
 try {
  const response = await fetch(path, { method, cache: 'no-store', headers: body ? {'Content-Type':'application/json'} : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación.');
  state = data; editing = null; $('form').reset(); $('form-title').textContent = 'Añadir participante';
 } catch (error) { $('message').textContent = error.message; }
 finally { busy = false; render(); }
}
$('form').onsubmit = event => { event.preventDefault(); perform('/api/participants' + (editing ? '/' + editing : ''), editing ? 'PUT' : 'POST', { name: $('name').value, email: $('email').value, previousId: $('previous').value || null }); };
$('cancel').onclick = clearForm;
$('draw').onclick = () => { if (confirm('¿Realizar el sorteo con la lista y restricciones actuales? Quedará bloqueado hasta reiniciarlo. No se enviarán correos.')) perform('/api/draw', 'POST', {confirm:true}); };
$('reset').onclick = () => { if (confirm('¿Reiniciar el sorteo? Se descartarán las asignaciones actuales y se conservarán los participantes.')) perform('/api/draw/reset', 'POST', {confirm:true}); };
perform('/api/state', 'GET');
`;
