import { useEffect, useRef, useState, type FormEvent } from 'react';
import { editionApi, workflowApi, type CampaignSummary, type DeliveryCounts, type EditionScope, type EditionSummary, type GroupResponse, type ResultsResponse, type StateResponse } from './api';
import EditionPanel from './EditionPanel';

export function eventLabel(edition: EditionSummary) {
    const s = edition.edition.schedule;
    return s ? `${s.localDateTime.replace('T', ' · ')} (${s.timeZone})` : 'Sin fecha de revelación';
}
function Counts({ counts }: { counts: DeliveryCounts }) {
    return <dl className="counts"><div><dt>Pendientes</dt><dd>{counts.pending}</dd></div><div><dt>Aceptados por SMTP</dt><dd>{counts.accepted}</dd></div><div><dt>Rechazados</dt><dd>{counts.failed}</dd></div><div><dt>Inciertos</dt><dd>{counts.uncertain}</dd></div></dl>;
}
interface Props { group: GroupResponse; edition: EditionSummary; reminderOnly?: boolean; onBusy: (value: boolean) => void; onChanged: () => Promise<void> }
export default function DrawDetail({ group, edition, reminderOnly = false, onBusy, onChanged }: Props) {
    const scope: EditionScope = { groupId: group.group.id, editionId: edition.edition.id };
    const [state, setState] = useState<StateResponse>();
    const [results, setResults] = useState<ResultsResponse>();
    const [pending, setPending] = useState(true), [editorBusy, setEditorBusy] = useState(false);
    const [error, setError] = useState(''), [notice, setNotice] = useState('');
    const [title, setTitle] = useState(edition.edition.name), [date, setDate] = useState(''), [time, setTime] = useState('20:00'), [zone, setZone] = useState('Europe/Madrid');
    const lock = useRef(false);
    useEffect(() => { let active = true; editionApi(scope).state().then(s => { if (active) setState(s); }).catch(() => { if (active) setError('No se pudo cargar el sorteo. Actualiza para reintentar.'); }).finally(() => { if (active) setPending(false); }); return () => { active = false; }; }, []);
    useEffect(() => { onBusy(pending || editorBusy); return () => onBusy(false); }, [pending, editorBusy, onBusy]);
    const busy = pending || editorBusy || !!state?.delivery?.active;
    async function run(action: () => Promise<void>) {
        if (lock.current || pending || editorBusy) { setError('Hay una solicitud en curso. Espera antes de continuar.'); return; }
        lock.current = true; setPending(true); setError(''); setNotice('');
        try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'La solicitud no se pudo completar.'); }
        finally { lock.current = false; setPending(false); }
    }
    async function update(next: StateResponse) {
        setState(next); if (!next.results?.available) setResults(undefined);
        try { await onChanged(); } catch { setError('La operación se completó, pero no se pudo actualizar el grupo. Actualiza el estado.'); }
    }
    function send(kind: 'initial' | 'new' | CampaignSummary, retryUncertain = false) {
        if (busy || lock.current || !state?.draw.completed || !state.delivery?.configured) { setError('El envío está bloqueado. Revisa la configuración o espera a que termine la operación.'); return; }
        const delivery = state.delivery;
        const count = kind === 'new' ? state.draw.participantCount : (typeof kind === 'object' ? kind.pending + kind.failed + (retryUncertain ? kind.uncertain : 0) : delivery.pending + delivery.failed + (retryUncertain ? delivery.uncertain : 0));
        const target = delivery.mode === 'test' ? `PRUEBAS: exclusivamente a ${delivery.testEmail}.` : 'PRODUCCIÓN: a los participantes del sorteo.';
        const operation = kind === 'new' ? 'Nuevo recordatorio a todos, incluidos quienes recibieron el correo inicial.' : typeof kind === 'object' ? 'Reintento del recordatorio seleccionado.' : 'Notificaciones iniciales pendientes o rechazadas.';
        if (!window.confirm(`${operation} «${edition.edition.name}», ${eventLabel(edition)}. ${count} mensajes. ${target}${retryUncertain ? ' Incluye inciertos: puede duplicar correos.' : ''} ¿Confirmas el envío?`)) return;
        void run(async () => {
            const next = kind === 'initial'
                ? await editionApi(scope, state.revision).send(state.draw.completed ? state.draw.completedAt : '', delivery.revision, retryUncertain)
                : await workflowApi.reminder(scope, state, typeof kind === 'object' ? kind : undefined, retryUncertain);
            await update(next);
            const counts = kind === 'initial' ? next.delivery! : kind === 'new' ? next.campaigns!.at(-1)! : next.campaigns!.find(c => c.id === kind.id)!;
            setNotice(counts.pending || counts.failed || counts.uncertain
                ? 'Solicitud procesada con entregas pendientes, rechazadas o inciertas. Revisa los contadores antes de reintentar.'
                : 'Todos los mensajes de esta solicitud fueron aceptados por SMTP. Esto no confirma su recepción.');
        });
    }
    function configure(event: FormEvent) {
        event.preventDefault(); if (!state) return;
        void run(async () => update(await workflowApi.configure(scope, state, title, { localDateTime: `${date}T${time}`, timeZone: zone })));
    }
    const delivery = state?.delivery;
    return <section className="draw-detail" aria-label="Detalle del sorteo">
        <div className="section-heading"><div><p className="eyebrow">{group.group.name} · {edition.edition.year}</p><h2>{edition.edition.name}</h2><p>{state?.schedule ? `${state.schedule.localDateTime.replace('T', ' · ')} (${state.schedule.timeZone})` : eventLabel(edition)}</p></div><span className="badge">{state?.draw.completed ? 'Confirmado' : 'Borrador'}</span></div>
        {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
        {pending && <p role="status">Solicitud en curso…</p>}
        <button className="secondary" disabled={pending || editorBusy} onClick={() => { void run(async () => update(await editionApi(scope).state())); }}>Actualizar estado</button>
        {state && <>
            <div className="reveal-panel"><h3>{state.results?.available ? 'Resultados disponibles' : 'Asignaciones ocultas'}</h3>
                <p>{state.schedule ? `Revelación: ${state.schedule.localDateTime.replace('T', ' · ')} (${state.schedule.timeZone}). La hora del navegador no adelanta la revelación.` : 'Este sorteo no tiene fecha de revelación. No se mostrarán sus asignaciones automáticamente.'}</p>
                {state.results?.available && <button className="secondary" disabled={busy} onClick={() => { void run(async () => setResults(await workflowApi.results(scope))); }}>Ver resultados</button>}
                {results && <table><caption>Asignaciones de {edition.edition.name}</caption><thead><tr><th scope="col">Regala</th><th scope="col">Recibe</th></tr></thead><tbody>{results.assignments.map(a => <tr key={a.giver.id}><td>{a.giver.name}</td><td>{a.receiver.name}</td></tr>)}</tbody></table>}
            </div>
            {state.draw.completed && delivery && <div className="notification-panel">
                <h3>{reminderOnly ? 'Recordar este sorteo' : 'Notificaciones'}</h3>
                <p className="mode-banner">{delivery.mode === 'test' ? <><strong>Modo PRUEBAS</strong> · Todos los mensajes irán exclusivamente a <strong>{delivery.testEmail ?? 'buzón sin configurar'}</strong>.</> : delivery.mode === 'production' ? <><strong>Modo PRODUCCIÓN</strong> · Los destinatarios son los {state.draw.participantCount} participantes de esta edición.</> : 'Modo de envío sin configurar.'}</p>
                {!delivery.configured && <p role="alert">{delivery.configurationError ?? 'Configura el modo y las variables SMTP antes de enviar.'}</p>}
                <p>Aceptado por SMTP no significa recibido en la bandeja de entrada. Un resultado incierto puede haber llegado: reenviarlo puede duplicarlo.</p>
                {!reminderOnly && <><h4>Campaña inicial · {delivery.mode === 'test' ? 'pruebas' : 'producción'}</h4><Counts counts={delivery} />
                    <div className="actions"><button disabled={busy || !delivery.configured || delivery.pending + delivery.failed === 0} onClick={() => send('initial')}>Enviar {delivery.pending + delivery.failed} notificaciones</button>
                    {delivery.uncertain > 0 && <button className="secondary" disabled={busy || !delivery.configured} onClick={() => send('initial', true)}>Reintentar incluyendo inciertos</button>}</div>
                    {delivery.production && delivery.test && <p className="muted">Historial independiente: {delivery.production.accepted} aceptados en producción · {delivery.test.accepted} en pruebas.</p>}</>}
                <h4>Recordatorios</h4><p>Un nuevo recordatorio envía {state.draw.participantCount} mensajes con las asignaciones originales, aunque el envío anterior se aceptara. No crea otro sorteo.</p>
                <button className={reminderOnly ? undefined : 'secondary'} disabled={busy || !delivery.configured} onClick={() => send('new')}>Enviar recordatorio a todos</button>
                {!state.campaigns?.length && <p className="muted">Todavía no hay campañas de recordatorio.</p>}
                {state.campaigns?.map((c, i) => <article className="campaign" key={c.id}><h4>Recordatorio {i + 1} · {c.mode === 'test' ? 'Pruebas' : 'Producción'}</h4><p>{new Date(c.createdAt).toLocaleString('es-ES', { timeZone: state.schedule?.timeZone ?? 'Europe/Madrid' })} · {state.schedule?.timeZone ?? 'Europe/Madrid'}</p><Counts counts={c} />
                    <div className="actions"><button className="secondary" disabled={busy || !delivery.configured || c.mode !== delivery.mode || c.pending + c.failed === 0} onClick={() => send(c)}>Reintentar pendientes y rechazados del recordatorio {i + 1}</button>
                    {c.uncertain > 0 && <button className="secondary" disabled={busy || !delivery.configured || c.mode !== delivery.mode} onClick={() => send(c, true)}>Reintentar inciertos del recordatorio {i + 1}</button>}</div></article>)}
            </div>}
            {!state.draw.completed && <details><summary>Preparar este borrador existente</summary>
                <form onSubmit={configure}><fieldset disabled={busy}><label htmlFor="draft-name">Título del borrador</label><input id="draft-name" value={title} onChange={e => setTitle(e.target.value)} required maxLength={100} /><div className="form-grid"><div><label htmlFor="draft-date">Fecha del evento</label><input id="draft-date" type="date" value={date} onChange={e => setDate(e.target.value)} required /></div><div><label htmlFor="draft-time">Hora del evento</label><input id="draft-time" type="time" value={time} onChange={e => setTime(e.target.value)} required /></div></div><label htmlFor="draft-zone">Zona horaria</label><input id="draft-zone" value={zone} onChange={e => setZone(e.target.value)} required /><button>Guardar fecha del borrador</button></fieldset></form>
                <EditionPanel requireSchedule key={state.revision} scope={scope} people={group.people} groupRevision={group.revision} onBusy={setEditorBusy} onChanged={update} />
            </details>}
        </>}
    </section>;
}
