import MailProgress, { useMailProgress } from './MailProgress';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { editionApi, workflowApi, type CampaignSummary, type DeliveryCounts, type EditionScope, type EditionSummary, type GroupResponse, type ResultsResponse, type StateResponse } from './api';
import EditionPanel from './EditionPanel';

export function eventLabel(edition: EditionSummary) {
    const s = edition.edition.schedule;
    if (!s) return 'Sin fecha de revelación';
    return `${new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeStyle: 'short', timeZone: s.timeZone }).format(new Date(s.eventAt))} (${s.timeZone})`;
}
function Counts({ counts }: { counts: DeliveryCounts }) {
    return <dl className="counts"><div><dt>Pendientes</dt><dd>{counts.pending}</dd></div><div><dt>Aceptados por el servidor</dt><dd>{counts.accepted}</dd></div><div><dt>Rechazados</dt><dd>{counts.failed}</dd></div><div><dt>Resultado incierto</dt><dd>{counts.uncertain}</dd></div></dl>;
}
interface Props { group: GroupResponse; edition: EditionSummary; section?: string; onSection: (section: string) => void; onRepeat: () => void; onGroup: () => void; onBusy: (value: boolean) => void; onChanged: () => Promise<void> }
export default function DrawDetail({ group, edition, section, onSection, onRepeat, onGroup, onBusy, onChanged }: Props) {
    const scope: EditionScope = { groupId: group.group.id, editionId: edition.edition.id };
    const [state, setState] = useState<StateResponse>();
    const [results, setResults] = useState<ResultsResponse>();
    const [pending, setPending] = useState(true), [editorBusy, setEditorBusy] = useState(false);
    const [error, setError] = useState(''), [pollError, setPollError] = useState('');
    const [title, setTitle] = useState(edition.edition.name), [date, setDate] = useState(''), [time, setTime] = useState('20:00'), [zone, setZone] = useState('Europe/Madrid');
    const lock = useRef(false);
    useEffect(() => { let active = true; editionApi(scope).state().then(s => { if (active) setState(s); }).catch(() => { if (active) setError('No se pudo cargar el sorteo. Actualiza para reintentar.'); }).finally(() => { if (active) setPending(false); }); return () => { active = false; }; }, []);
    useEffect(() => { onBusy(pending && lock.current || editorBusy); return () => onBusy(false); }, [pending, editorBusy, onBusy]);
    useMailProgress(scope, state, setState, setPollError);
    const busy = pending || editorBusy || !!state?.delivery?.active;
    async function run(action: () => Promise<void>) {
        if (lock.current || pending || editorBusy) { setError('Hay una solicitud en curso. Espera antes de continuar.'); return; }
        lock.current = true; setPending(true); setError('');
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
        const operation = kind === 'new' ? 'Nuevo recordatorio a todos, incluidas las personas cuyo correo inicial aceptó el servidor.' : typeof kind === 'object' ? 'Reintento del recordatorio seleccionado.' : 'Notificaciones iniciales pendientes o rechazadas.';
        if (!window.confirm(`${operation} «${edition.edition.name}», ${eventLabel(edition)}. ${count} mensajes. ${target}${retryUncertain ? ' Incluye inciertos: puede duplicar correos.' : ''} ¿Confirmas el envío?`)) return;
        void run(async () => {
            const next = kind === 'initial'
                ? await editionApi(scope, state.revision).send(state.draw.completed ? state.draw.completedAt : '', delivery.revision, retryUncertain)
                : await workflowApi.reminder(scope, state, typeof kind === 'object' ? kind : undefined, retryUncertain);
            await update(next);
        });
    }
    function configure(event: FormEvent) {
        event.preventDefault(); if (!state) return;
        void run(async () => update(await workflowApi.configure(scope, state, title, { localDateTime: `${date}T${time}`, timeZone: zone })));
    }
    const delivery = state?.delivery;
    const detail = useRef<HTMLElement>(null);
    const loaded = !!state;
    useEffect(() => {
        if (!section || !loaded) return;
        const target = document.getElementById(section);
        if (!target || !detail.current?.contains(target)) return;
        if (target instanceof HTMLDetailsElement) target.open = true;
        target.querySelector<HTMLElement>('h3, summary')?.focus();
        if (target instanceof HTMLHeadingElement) target.focus();
        target.scrollIntoView?.({ block: 'nearest' });
    }, [section, loaded]);
    const wasActive = useRef(false);
    const operationActive = !!delivery?.active;
    useEffect(() => {
        if (wasActive.current && !operationActive) void onChanged().catch(() => {});
        wasActive.current = operationActive;
    }, [operationActive, onChanged]);
    return <section ref={detail} className="draw-detail" aria-label="Detalle del sorteo">
        <div className="section-heading"><div><button className="secondary" disabled={pending} onClick={onGroup}>{group.group.name}</button><h2 tabIndex={-1}>{edition.edition.name}</h2><p>{state ? eventLabel({ ...edition, edition: { ...edition.edition, schedule: state.schedule } }) : eventLabel(edition)}</p></div><span className="badge">{(state?.draw.completed ?? edition.draw.completed) ? 'Confirmado' : 'Borrador'}</span></div>
        <p>{state?.draw.participantCount ?? edition.draw.participantCount} participantes · {(state?.results ?? edition.results)?.available ? 'Resultados disponibles' : 'Resultados ocultos'}</p>
        {state?.draw.completed && delivery && <p className="detail-next"><strong>{
            delivery.active ? 'Envío en curso' :
            state.mailOperation?.status === 'interrupted' ? 'Envío interrumpido · Necesita revisión' :
            delivery.failed || delivery.uncertain ? 'Necesita revisión' :
            delivery.pending ? 'Notificaciones pendientes' : delivery.configured ? 'Sin notificaciones iniciales pendientes' : 'Envío sin configurar'
        }</strong></p>}
        {state?.draw.completed && <div className="actions detail-actions">
            {delivery && <button className="secondary" onClick={() => onSection('notificaciones')}>{delivery.pending ? 'Enviar notificaciones' : 'Ver notificaciones'}</button>}
            {delivery && <button className="secondary" onClick={() => onSection('recordatorios')}>Recordar sorteo</button>}
            <button className="secondary" disabled={pending || editorBusy} onClick={onRepeat}>Repetir sorteo</button>
            {state.results?.available && <button className="secondary" onClick={() => onSection('resultados')}>Resultados</button>}
        </div>}
        {state && !state.draw.completed && <button className="secondary" onClick={() => onSection('preparar')}>Continuar preparación</button>}
        {error && <p role="alert">{error}</p>}{pollError && <p role="alert">{pollError}</p>}
        {pending && <p role="status">Solicitud en curso…</p>}
        <button className="secondary" disabled={busy} onClick={() => { void run(async () => update(await editionApi(scope).state())); }}>Actualizar estado</button>
        {state && <>
            <div className="reveal-panel" id="resultados"><h3 tabIndex={-1}>{state.results?.available ? 'Resultados disponibles' : 'Asignaciones ocultas'}</h3>
                <p>{state.schedule ? `Revelación: ${state.schedule.localDateTime.replace('T', ' · ')} (${state.schedule.timeZone}). La hora del navegador no adelanta la revelación.` : 'Este sorteo no tiene fecha de revelación. No se mostrarán sus asignaciones automáticamente.'}</p>
                {state.results?.available && <button className="secondary" disabled={pending || editorBusy} onClick={() => { void run(async () => setResults(await workflowApi.results(scope))); }}>Ver resultados</button>}
                {results && <table><caption>Asignaciones de {edition.edition.name}</caption><thead><tr><th scope="col">Regala</th><th scope="col">Recibe</th></tr></thead><tbody>{results.assignments.map(a => <tr key={a.giver.id}><td>{a.giver.name}</td><td>{a.receiver.name}</td></tr>)}</tbody></table>}
            </div>
            {state.draw.completed && delivery && <div className="notification-panel" id="notificaciones">
                <h3 tabIndex={-1}>Notificaciones</h3>
                <a href="/mail-preview" target="_blank" rel="noopener noreferrer">Vista previa del correo</a>
                <p className="mode-banner">{delivery.mode === 'test' ? <><strong>Modo PRUEBAS</strong> · Todos los mensajes irán exclusivamente a <strong>{delivery.testEmail ?? 'buzón sin configurar'}</strong>.</> : delivery.mode === 'production' ? <><strong>Modo PRODUCCIÓN</strong> · Los destinatarios son los {state.draw.participantCount} participantes de esta edición.</> : 'Modo de envío sin configurar.'}</p>
                <MailProgress state={state} />
                {!delivery.configured && <p role="alert">{delivery.configurationError ?? 'Configura el modo y las variables SMTP antes de enviar.'}</p>}
                <p>El servidor de correo puede aceptar un mensaje sin que llegue a la bandeja de entrada. Un resultado incierto puede haber llegado: reenviarlo puede duplicarlo.</p>
                <>{delivery.failed + delivery.uncertain > 0 && <p className="review-alert"><strong>Necesita revisión.</strong> Revisa los rechazos y confirma si quieres reenviar los resultados inciertos.</p>}
                    <h4>Campaña inicial · {delivery.mode === 'test' ? 'pruebas' : 'producción'}</h4><Counts counts={delivery} />
                    <div className="actions"><button disabled={busy || !delivery.configured || delivery.pending + delivery.failed === 0} onClick={() => send('initial')}>{delivery.failed ? 'Enviar pendientes y reintentar rechazos' : delivery.pending ? `Enviar ${delivery.pending} notificaciones` : 'Sin notificaciones pendientes'}</button>
                    {delivery.uncertain > 0 && <button className="secondary" disabled={busy || !delivery.configured} onClick={() => send('initial', true)}>Reenviar incluyendo resultados inciertos</button>}</div>
                    {delivery.production && delivery.test && <p className="muted">Historial independiente: {delivery.production.accepted} aceptados en producción · {delivery.test.accepted} en pruebas.</p>}</>
                <h4 id="recordatorios" tabIndex={-1}>Recordatorios</h4><p>Un nuevo recordatorio envía {state.draw.participantCount} mensajes con las asignaciones originales, aunque el servidor aceptara el envío anterior. Cada envío crea una campaña independiente. Para volver a intentar una campaña existente, usa su propia acción.</p>
                <button className="secondary" disabled={busy || !delivery.configured} onClick={() => send('new')}>Enviar recordatorio a todos</button>
                {!state.campaigns?.length && <p className="muted">Todavía no hay campañas de recordatorio.</p>}
                {state.campaigns?.map((c, i) => <article className="campaign" key={c.id}><h4>Recordatorio {i + 1} · {c.mode === 'test' ? 'Pruebas' : 'Producción'}</h4><p>{new Date(c.createdAt).toLocaleString('es-ES', { timeZone: state.schedule?.timeZone ?? 'Europe/Madrid' })} · {state.schedule?.timeZone ?? 'Europe/Madrid'}</p><Counts counts={c} />
                    <div className="actions"><button className="secondary" disabled={busy || !delivery.configured || c.mode !== delivery.mode || c.pending + c.failed === 0} onClick={() => send(c)}>Reintentar pendientes y rechazados del recordatorio {i + 1}</button>
                    {c.uncertain > 0 && <button className="secondary" disabled={busy || !delivery.configured || c.mode !== delivery.mode} onClick={() => send(c, true)}>Reenviar resultados inciertos del recordatorio {i + 1}</button>}</div></article>)}
            </div>}
            {!state.draw.completed && <details id="preparar"><summary>Preparar este borrador existente</summary>
                <form onSubmit={configure}><fieldset disabled={busy}><label htmlFor="draft-name">Título del borrador</label><input id="draft-name" value={title} onChange={e => setTitle(e.target.value)} required maxLength={100} /><div className="form-grid"><div><label htmlFor="draft-date">Fecha del evento</label><input id="draft-date" type="date" value={date} onChange={e => setDate(e.target.value)} required /></div><div><label htmlFor="draft-time">Hora del evento</label><input id="draft-time" type="time" value={time} onChange={e => setTime(e.target.value)} required /></div></div><label htmlFor="draft-zone">Zona horaria</label><input id="draft-zone" value={zone} onChange={e => setZone(e.target.value)} required /><button>Guardar fecha del borrador</button></fieldset></form>
                <EditionPanel requireSchedule key={state.revision} scope={scope} people={group.people} groupRevision={group.revision} onBusy={setEditorBusy} onChanged={update} />
            </details>}
        </>}
    </section>;
}
