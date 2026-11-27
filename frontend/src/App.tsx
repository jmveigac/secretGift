import { Avatar, DeliveryMeter, EventCountdown, EventDateTile, GiftMark, ThemeChoice, useCurrentMinute } from './VisualIdentity';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { groupsApi, editionApi, type Group, type GroupResponse, type EditionSummary } from './api';
import DeleteGroup from './DeleteGroup';
import GroupPeople from './GroupPeople';
import DrawWizard, { type ReferenceDraw } from './DrawWizard';
import DrawDetail, { eventLabel } from './DrawDetail';

type Route = { view: 'groups' | 'draws' | 'help'; group?: string; edition?: string; section?: string };
function readRoute(): Route {
    const params = new URLSearchParams(location.search);
    const view = params.get('view');
    return { view: view === 'draws' || view === 'help' ? view : 'groups',
        group: params.get('group') || undefined, edition: params.get('edition') || undefined, section: params.get('section') || undefined };
}
function address(route: Route) {
    const params = new URLSearchParams();
    if (route.view !== 'groups') params.set('view', route.view);
    if (route.group) params.set('group', route.group);
    if (route.edition) params.set('edition', route.edition);
    if (route.section) params.set('section', route.section);
    return params.size ? `?${params}` : location.pathname;
}
const detailSections = new Set(['notificaciones', 'recordatorios', 'resultados', 'preparar']);
const destinations = [{ view: 'groups', label: 'Grupos' }, { view: 'draws', label: 'Sorteos' }, { view: 'help', label: 'Ayuda y herramientas' }] as const;
const leaveDraft = '¿Salir del sorteo en preparación? Los datos sin guardar se perderán.';

export default function App() {
    const now = useCurrentMinute();
    const [confirmed, setConfirmed] = useState<string>();
    const [route, setRoute] = useState(readRoute);
    const [groups, setGroups] = useState<Group[]>([]);
    const [snapshots, setSnapshots] = useState<Record<string, GroupResponse>>({});
    const [reference, setReference] = useState<ReferenceDraw>();
    const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [childBusy, setChildBusy] = useState(false);
    const [error, setError] = useState(''), [notice, setNotice] = useState('');
    const [name, setName] = useState(''), [rename, setRename] = useState<string>(), [creating, setCreating] = useState(false);
    const lock = useRef(false), workspace = useRef<HTMLElement>(null), createInput = useRef<HTMLInputElement>(null);
    const focusNext = useRef(false), historyIndex = useRef(0), restoring = useRef(false);
    const group = route.group ? snapshots[route.group] : undefined;
    const selected = group?.editions.find(item => item.edition.id === route.edition);
    const preparing = route.section === 'new' || route.section === 'repeat';
    const busy = saving || childBusy;

    function remember(next: GroupResponse) {
        setSnapshots(current => ({ ...current, [next.group.id]: next }));
        setGroups(current => current.some(item => item.id === next.group.id)
            ? current.map(item => item.id === next.group.id ? next.group : item) : [...current, next.group]);
    }
    async function load() {
        const data = (await groupsApi.list()).groups;
        setGroups(data);
        const results = await Promise.allSettled(data.map(item => groupsApi.get(item.id)));
        setSnapshots(Object.fromEntries(results.flatMap(result => result.status === 'fulfilled'
            ? [[result.value.group.id, result.value]] : [])));
        if (results.some(result => result.status === 'rejected')) setError('No se pudieron cargar algunos grupos. Vuelve a intentarlo.');
    }
    useEffect(() => {
        void load().catch(() => setError('No se pudieron cargar los grupos. Vuelve a intentarlo.')).finally(() => setLoading(false));
        historyIndex.current = history.state?.secretGiftIndex ?? 0;
        history.replaceState({ secretGiftIndex: historyIndex.current }, '');
    }, []);
    useEffect(() => {
        function pop(event: PopStateEvent) {
            const nextIndex = event.state?.secretGiftIndex;
            if (!restoring.current && address(readRoute()) === address(route)) return;
            if (restoring.current) { restoring.current = false; return; }
            if ((busy || preparing && !window.confirm(leaveDraft)) && Number.isInteger(nextIndex) && nextIndex !== historyIndex.current) {
                restoring.current = true;
                history.go(historyIndex.current - nextIndex);
                return;
            }
            historyIndex.current = Number.isInteger(nextIndex) ? nextIndex : 0;
            focusNext.current = true;
            const next = readRoute();
            if (next.edition !== route.edition) setConfirmed(undefined);
            setRoute(next); setError(''); setNotice('');
        }
        window.addEventListener('popstate', pop);
        return () => window.removeEventListener('popstate', pop);
    }, [busy, preparing, route]);
    useEffect(() => {
        if (!preparing) return;
        function beforeUnload(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ''; }
        window.addEventListener('beforeunload', beforeUnload);
        return () => window.removeEventListener('beforeunload', beforeUnload);
    }, [preparing]);
    useEffect(() => {
        if (route.section !== 'repeat' || !route.group || !selected) return;
        let current = true;
        const id = selected.edition.id;
        editionApi({ groupId: route.group, editionId: id }).state().then(data => {
            if (current) setReference({ id, name: selected.edition.name, personIds: data.participants.map(person => person.id) });
        }).catch(() => { if (current) setError('No se pudo preparar la repetición.'); });
        return () => { current = false; };
    }, [route.section, route.group, selected?.edition.id]);
    useEffect(() => {
        if (!focusNext.current || loading || preparing || route.section && detailSections.has(route.section)) return;
        focusNext.current = false;
        workspace.current?.querySelector<HTMLElement>('h2[tabindex="-1"]')?.focus();
    }, [route, loading, preparing]);
    useEffect(() => { if (creating) createInput.current?.focus(); }, [creating]);

    function navigate(next: Route, options?: { bypass?: boolean; replace?: boolean }) {
        if (address(next) === address(route)) return;
        if (!options?.bypass && (busy || lock.current || preparing && !window.confirm(leaveDraft))) return;
        if (!options?.replace) historyIndex.current++;
        history[options?.replace ? 'replaceState' : 'pushState']({ secretGiftIndex: historyIndex.current }, '', address(next));
        focusNext.current = true;
        setNotice(''); setError(''); setReference(undefined); setRoute(next);
        if (!options?.bypass && next.edition !== route.edition) setConfirmed(undefined);
        if (next.section !== 'rename') setRename(undefined);
    }
    async function run(operation: () => Promise<void>) {
        if (lock.current || busy) return false;
        lock.current = true; setSaving(true); setError(''); setNotice('');
        try { await operation(); return true; }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo completar la operación.'); return false; }
        finally { lock.current = false; setSaving(false); }
    }
    async function createGroup(event: FormEvent) {
        event.preventDefault();
        await run(async () => {
            const next = await groupsApi.create(name);
            remember(next); setName(''); setCreating(false);
            navigate({ view: 'groups', group: next.group.id, section: 'people' }, { bypass: true });
        });
    }
    function groupDeleted(id: string, remaining: Group[]) {
        setGroups(remaining);
        setSnapshots(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
        navigate({ view: 'groups' }, { bypass: true, replace: true });
        setNotice('Grupo eliminado definitivamente.');
        requestAnimationFrame(() => document.getElementById('groups-heading')?.focus());
    }
    function groupActions(item: GroupResponse) {
        return <details className="group-actions">
            <summary aria-label={`Acciones del grupo ${item.group.name}`}>Acciones del grupo</summary>
            <button className="secondary" disabled={busy || item.busy} onClick={() => {
                setRename(item.group.name); navigate({ view: 'groups', group: item.group.id, section: 'rename' });
            }}>Cambiar nombre</button>
            <DeleteGroup groupId={item.group.id} disabled={busy} onBusy={setChildBusy} onDeleted={remaining => groupDeleted(item.group.id, remaining)} compact />
        </details>;
    }
    function drawCard(item: EditionSummary, owner: GroupResponse, showGroup: boolean) {
        const upcoming = item.edition.schedule && Date.parse(item.edition.schedule.eventAt) > now;
        return <article className="draw-card" key={item.edition.id}>
            <div className="draw-card-head"><EventDateTile schedule={item.edition.schedule} /><div><h3>{item.edition.name}</h3><span className="badge" data-state={item.draw.completed ? "confirmed" : "draft"}>{item.draw.completed ? upcoming ? 'Próximo · Confirmado' : item.edition.schedule ? 'Pasado · Confirmado' : 'Confirmado' : 'Borrador'}</span></div></div>
            <p>{showGroup && `${owner.group.name} · `}{eventLabel(item)}</p>
            <p>{item.draw.participantCount} participantes{item.draw.completed && (item.results?.available ? ' · Resultados disponibles' : ' · Resultados ocultos')}</p>
            {item.draw.completed && <DeliveryMeter delivery={item.delivery} />}
            <button className="secondary" disabled={busy} onClick={() => navigate({ view: route.view, group: owner.group.id, edition: item.edition.id })}>Abrir {item.edition.name}</button>
        </article>;
    }
    const missing = !loading && (route.group && !group || route.edition && !selected);
    const ordered = (items: EditionSummary[]) => [...items].sort((a, b) => {
        const today = new Date().toISOString();
        function bucket(item: EditionSummary) {
            if (!item.draw.completed) return 1;
            return item.edition.schedule && item.edition.schedule.eventAt >= today ? 0 : 2;
        }
        const order = bucket(a) - bucket(b);
        const dates = (a.edition.schedule?.eventAt ?? '').localeCompare(b.edition.schedule?.eventAt ?? '');
        return order || (bucket(a) === 0 ? dates : -dates);
    });
    const list = groups.flatMap(item => {
        const owner = snapshots[item.id];
        return owner ? owner.editions.map(edition => ({ edition, owner })) : [];
    });
    const owners = new Map(list.map(({ edition, owner }) => [edition.edition.id, owner]));
    const groupRoute = group ? { view: 'groups' as const, group: group.group.id } : undefined;

    return <div className="app-shell">
        <a className="skip-link" href="#workspace">Saltar al contenido</a>
        <aside className="sidebar">
            <header className="brand"><span className="brand-mark"><GiftMark /></span><h1>secretGift</h1></header>
            <nav className="main-nav" aria-label="Navegación principal">{destinations.map(item =>
                <a key={item.view} href={address(item)} aria-disabled={busy || undefined} aria-current={route.view === item.view ? 'page' : undefined}
                    className={route.view === item.view ? 'nav-active' : 'nav-item'}
                    onClick={event => {
                        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                        event.preventDefault(); navigate(item);
                    }}>{item.label}</a>)}</nav>
            <ThemeChoice />
        </aside>
        <main id="workspace" ref={workspace} tabIndex={-1}>
            {error && <p role="alert">{error}{!preparing && !group && <button className="secondary" onClick={() => { void run(load); }}>Volver a intentar</button>}</p>}
            {notice && <p role="status">{notice}</p>}
            {loading ? <p role="status">Cargando grupos y sorteos…</p> : missing ? <section>
                <h2 tabIndex={-1}>Este grupo o sorteo ya no está disponible</h2>
                <button onClick={() => navigate({ view: route.view }, { bypass: true, replace: true })}>Volver a {route.view === 'draws' ? 'Sorteos' : 'Grupos'}</button>
            </section> : preparing ? <>
                <button className="secondary" disabled={busy} onClick={() => navigate(route.section === 'repeat'
                    ? { view: route.view, group: route.group, edition: route.edition } : groupRoute ?? { view: 'draws' })}>Salir de la preparación</button>
                {route.section === 'repeat' && reference?.id !== route.edition ? (!error && <p role="status">Cargando participantes del sorteo original…</p>)
                    : <DrawWizard key={address(route)} groups={groups} initialGroup={group} reference={route.section === 'repeat' ? reference : undefined}
                        onBusy={setChildBusy} onGroupsChanged={load} onDone={(next, id) => {
                            remember(next); setConfirmed(id); navigate({ view: route.view, group: next.group.id, edition: id }, { bypass: true, replace: true });
                        }} />}
            </> : selected && group ? <>
                <button className="secondary" disabled={busy} onClick={() => navigate(route.view === 'draws' ? { view: 'draws' } : groupRoute!)}>Volver a {route.view === 'draws' ? 'Sorteos' : group.group.name}</button>
                {confirmed === selected.edition.id && <div className="confirmation-moment" role="status"><GiftMark />
                    <div><strong>Sorteo confirmado</strong><p>{selected.edition.name} · {eventLabel(selected)}. Todavía no se han enviado correos.</p></div>
                    <button type="button" className="secondary" onClick={() => setConfirmed(undefined)}>Cerrar aviso</button>
                </div>}
                <DrawDetail now={now} key={selected.edition.id} group={group} edition={selected} onBusy={setChildBusy}
                    onChanged={async () => remember(await groupsApi.get(group.group.id))}
                    section={route.section}
                    onSection={section => navigate({ ...route, section })}
                    onRepeat={() => navigate({ ...route, section: 'repeat' })}
                    onGroup={() => navigate(groupRoute!)} />
            </> : group && groupRoute ? <>
                <button className="secondary" disabled={busy} onClick={() => navigate({ view: 'groups' })}>Volver a Grupos</button>
                <div className="section-heading"><h2 tabIndex={-1}>{group.group.name}</h2><button disabled={busy || group.busy} onClick={() => navigate({ ...groupRoute, section: 'new' })}>Nuevo sorteo</button></div>
                <nav className="sub-nav" aria-label="Secciones del grupo">
                    <button aria-current={route.section !== 'people' ? 'page' : undefined} onClick={() => navigate(groupRoute)}>Sorteos</button>
                    <button aria-current={route.section === 'people' ? 'page' : undefined} onClick={() => navigate({ ...groupRoute, section: 'people' })}>Participantes</button>
                    {groupActions(group)}
                </nav>
                {route.section === 'people' ? <GroupPeople key={group.group.id} people={group.people} disabled={busy || group.busy}
                    onSave={(person, id) => run(async () => remember(await groupsApi.person(group, person, id)))} />
                    : route.section === 'rename' ? <form onSubmit={event => { event.preventDefault(); void run(async () => {
                        remember(await groupsApi.rename(group, rename ?? group.group.name)); navigate(groupRoute, { bypass: true }); setNotice('Nombre actualizado.');
                    }); }}><h3>Cambiar nombre</h3><label htmlFor="rename-group">Nombre del grupo</label>
                        <input id="rename-group" value={rename ?? group.group.name} onChange={event => setRename(event.target.value)} required maxLength={100} />
                        <div className="actions"><button disabled={busy || group.busy}>Guardar nombre</button><button type="button" className="secondary" onClick={() => navigate(groupRoute)}>Cancelar</button></div>
                    </form> : <section aria-label="Sorteos del grupo">
                        <h3>Sorteos del grupo</h3>{!group.editions.length && <p>Aún no hay sorteos en este grupo.</p>}
                        <div className="draw-grid">{ordered(group.editions).map(item => drawCard(item, group, false))}</div>
                    </section>}
            </> : route.view === 'draws' ? <section>
                <div className="section-heading"><h2 tabIndex={-1}>Sorteos</h2><button onClick={() => navigate({ view: 'draws', section: 'new' })}>Nuevo sorteo</button></div>
                {!list.length && <p>Aquí aparecerán los sorteos de tus grupos.</p>}
                <div className="draw-grid">{ordered(list.map(item => item.edition)).map(item => drawCard(item, owners.get(item.edition.id)!, true))}</div>
            </section> : route.view === 'help' ? <section>
                <h2 tabIndex={-1}>Ayuda y herramientas</h2>
                <p><a href="/mail-preview" target="_blank" rel="noopener noreferrer">Vista previa del correo</a> con datos ficticios.</p>
                <p>Los resultados se pueden consultar en la aplicación a partir de la fecha de revelación. Los correos individuales pueden incluirlos antes.</p>
                <p>La aplicación es de uso local y no requiere iniciar sesión.</p>
            </section> : <section aria-labelledby="groups-heading">
                <div className="gift-hero">
                    <div className="gift-hero-copy"><p>Amigo invisible</p><h2>La magia está<br />en la sorpresa.</h2>
                        <button disabled={busy} onClick={() => groups.length
                            ? navigate({ view: 'draws', section: 'new' })
                            : setCreating(true)}>{groups.length ? 'Nuevo sorteo' : 'Crear mi primer grupo'}</button>
                    </div>
                    <div className="hero-art" aria-hidden="true">
                        <img src="/assets/gift-illustration.webp" alt="" width="700" height="673" />
                    </div>
                </div>
                <div className="section-heading groups-heading"><h2 id="groups-heading" tabIndex={-1}>Grupos</h2>
                    <button disabled={busy} onClick={() => setCreating(true)}>Crear grupo</button></div>
                {creating && <form className="contact-form" onSubmit={event => { void createGroup(event); }}>
                    <label htmlFor="new-group">Nombre del grupo</label><input ref={createInput} id="new-group" value={name} onChange={event => setName(event.target.value)} required maxLength={100} />
                    <div className="actions"><button disabled={busy}>Guardar grupo</button><button type="button" className="secondary" onClick={() => setCreating(false)}>Cancelar</button></div>
                </form>}
                {!groups.length && <p className="empty-state">Crea tu primer grupo para añadir personas y preparar un sorteo.</p>}
                <div className="group-grid">{groups.map(item => {
                    const snapshot = snapshots[item.id];
                    const target = { view: 'groups' as const, group: item.id };
                    const next = snapshot && ordered(snapshot.editions).find(draw =>
                        draw.draw.completed && draw.edition.schedule && Date.parse(draw.edition.schedule.eventAt) > now);
                    return <article className="group-card" key={item.id}>
                        <div className="group-card-head"><Avatar name={item.name} /><div><h3>{item.name}</h3>
                            {snapshot && <p>{snapshot.people.length} {snapshot.people.length === 1 ? 'persona' : 'personas'} · {snapshot.editions.length} {snapshot.editions.length === 1 ? 'sorteo' : 'sorteos'}</p>}</div></div>
                        {next && <div className="group-event">
                            <div className="group-event-title"><div><span className="badge" data-state="confirmed">Próximo · Confirmado</span>
                                <h4>{next.edition.name}</h4><p>{eventLabel(next)}</p></div>
                                <EventCountdown schedule={next.edition.schedule} now={now} /></div>
                            <DeliveryMeter delivery={next.delivery} />
                            <button className="secondary event-link" disabled={busy} onClick={() => navigate({ ...target, edition: next.edition.id })}>Ver sorteo <span aria-hidden="true">→</span></button>
                        </div>}
                        {snapshot ? <><div className="actions">
                            <button className="secondary" disabled={busy} onClick={() => navigate({ ...target, section: 'people' })}>Participantes</button>
                            <button className="secondary" disabled={busy} onClick={() => navigate(target)}>Sorteos del grupo</button>
                            <button className="secondary" disabled={busy || snapshot.busy} onClick={() => navigate({ ...target, section: 'new' })}>Nuevo sorteo</button>
                        </div>{groupActions(snapshot)}</> : <p>No se pudo cargar este grupo.</p>}
                    </article>;
                })}</div>
            </section>}
        </main>
    </div>;
}
