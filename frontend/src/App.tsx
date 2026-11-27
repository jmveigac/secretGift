import { useEffect, useRef, useState, type FormEvent } from 'react';
import { groupsApi, editionApi, type Group, type GroupResponse } from './api';
import GroupPeople from './GroupPeople';
import DrawWizard, { type ReferenceDraw } from './DrawWizard';
import DrawDetail, { eventLabel } from './DrawDetail';

type View = 'groups' | 'new' | 'remind' | 'repeat';
const navigation: { id: View; label: string }[] = [{ id: 'groups', label: 'Mis grupos' }, { id: 'new', label: 'Nuevo sorteo' }, { id: 'remind', label: 'Recordar sorteo' }, { id: 'repeat', label: 'Repetir sorteo' }];
export default function App() {
    const [groups, setGroups] = useState<Group[]>([]), [group, setGroup] = useState<GroupResponse>();
    const [view, setView] = useState<View>('groups'), [tab, setTab] = useState<'draws' | 'people' | 'settings'>('draws');
    const [editionId, setEditionId] = useState(''), [reference, setReference] = useState<ReferenceDraw>();
    const [pending, setPending] = useState(true), [childBusy, setChildBusy] = useState(false), [error, setError] = useState('');
    const [name, setName] = useState(''), [rename, setRename] = useState('');
    const lock = useRef(false), heading = useRef<HTMLHeadingElement>(null);
    const busy = pending || childBusy;
    useEffect(() => { groupsApi.list().then(data => setGroups(data.groups)).catch(() => setError('No se pudieron cargar los grupos. Actualiza para reintentar.')).finally(() => setPending(false)); }, []);
    useEffect(() => { heading.current?.focus(); }, [view, group?.group.id, editionId, tab]);
    async function listGroups() { setGroups((await groupsApi.list()).groups); }
    async function refreshGroup() { if (group) setGroup(await groupsApi.get(group.group.id)); }
    async function run(operation: () => Promise<void>) {
        if (lock.current || busy) { setError('Espera a que termine la solicitud en curso.'); return false; }
        lock.current = true; setPending(true); setError('');
        try { await operation(); return true; } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo completar la operación.'); return false; }
        finally { lock.current = false; setPending(false); }
    }
    function navigate(next: View) { if (busy || lock.current || next === view && (view === 'new' || view === 'repeat' && reference)) return; if ((view === 'new' || view === 'repeat' && reference) && !window.confirm('¿Salir del sorteo en preparación? Los datos de este asistente no se guardarán.')) return; setView(next); setEditionId(''); setReference(undefined); setError(''); if (next === 'groups') { setGroup(undefined); setTab('draws'); } }
    function openGroup(id: string) { void run(async () => { const next = await groupsApi.get(id); setGroup(next); setRename(next.group.name); setEditionId(''); setTab('draws'); }); }
    async function createGroup(event: FormEvent) { event.preventDefault(); await run(async () => { const next = await groupsApi.create(name); setGroup(next); setRename(next.group.name); setName(''); setTab('people'); await listGroups(); }); }
    function prepareRepeat() {
        if (!group || !editionId) return;
        void run(async () => { const state = await editionApi({ groupId: group.group.id, editionId }).state(); const source = group.editions.find(e => e.edition.id === editionId)!; setReference({ id: editionId, name: source.edition.name, personIds: state.participants.map(p => p.id) }); });
    }
    const selected = group?.editions.find(e => e.edition.id === editionId);
    const wizard = view === 'new' || view === 'repeat' && !!reference;
    return <div className="app-shell">
        <a className="skip-link" href="#workspace">Saltar al contenido</a>
        <aside className="sidebar">
        <header className="brand"><h1>secretGift</h1></header>
        <nav className="main-nav" aria-label="Navegación principal">{navigation.map(item => <button key={item.id} className={view === item.id ? 'nav-active' : 'nav-item'} aria-current={view === item.id ? 'page' : undefined} disabled={busy} onClick={() => navigate(item.id)}>{item.label}</button>)}</nav>
        <div className="sidebar-note"><span className="eyebrow">Amigo invisible</span><p>Cada grupo, su historia.<br />Cada regalo, una sorpresa.</p></div>
        </aside>
        <main id="workspace" tabIndex={-1}>
        <div className="workspace-label"><span>Organiza tu amigo invisible</span><span className="local-label">Espacio local</span></div>
        {error && <p role="alert">{error}</p>}{pending && <p role="status">Cargando o guardando datos…</p>}
        {wizard ? <DrawWizard key={`${view}:${reference?.id ?? 'new'}`} groups={groups} initialGroup={group} reference={reference} onBusy={setChildBusy} onGroupsChanged={listGroups} onDone={(next, id) => { setGroup(next); setEditionId(id); setView('groups'); setTab('draws'); setReference(undefined); }} /> : <>
            {view === 'groups' && !group && <section aria-labelledby="groups-heading"><div className="section-heading"><div><p className="eyebrow">Tu punto de partida</p><h2 id="groups-heading" ref={heading} tabIndex={-1}>Mis grupos</h2><p className="section-lead">Reúne a tu gente. Prepara el próximo sorteo.</p></div><button className="secondary" disabled={busy} onClick={() => { void run(listGroups); }}>Actualizar grupos</button></div>
                {!groups.length && <div className="empty-state"><span className="empty-mark" aria-hidden="true">01</span><div><h3>Tu primer grupo empieza aquí</h3><p>No hay grupos todavía. Crea uno para preparar tu primer sorteo.</p></div></div>}
                <div className="group-grid">{groups.map(g => <button className="group-card" disabled={busy} key={g.id} onClick={() => openGroup(g.id)}><span className="group-monogram" aria-hidden="true">{g.name.slice(0, 1).toUpperCase()}</span><strong>{g.name}</strong><span>Abrir grupo →</span></button>)}</div>
                <details className="create-group" open={!groups.length}><summary>Crear grupo</summary><form onSubmit={event => { void createGroup(event); }}><label htmlFor="new-group">Nombre del grupo</label><input id="new-group" value={name} onChange={e => setName(e.target.value)} required maxLength={100} disabled={busy} /><button disabled={busy}>Guardar grupo</button></form></details>
            </section>}
            {view !== 'groups' && <section aria-label="Seleccionar sorteo"><p className="eyebrow">{view === 'remind' ? 'Las mismas asignaciones, otro aviso' : 'Una nueva edición, su propia historia'}</p><h2 ref={heading} tabIndex={-1}>{view === 'remind' ? 'Recordar sorteo' : 'Repetir sorteo'}</h2><p>{view === 'remind' ? 'Reenvía a todos sin cambiar parejas ni fecha. Cada recordatorio tiene sus propios resultados de envío.' : 'Prepara un nuevo sorteo a partir de uno anterior. El original se conserva y se aplican los antecedentes vigentes.'}</p>
                <div className="form-grid"><div><label htmlFor="operation-group">Grupo</label><select id="operation-group" value={group?.group.id ?? ''} disabled={busy} onChange={e => openGroup(e.target.value)}><option value="" disabled>Selecciona un grupo</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div><div><label htmlFor="operation-edition">Sorteo confirmado</label><select id="operation-edition" value={editionId} disabled={busy || !group} onChange={e => setEditionId(e.target.value)}><option value="" disabled>Selecciona un sorteo</option>{group?.editions.filter(e => e.draw.completed).map(e => <option key={e.edition.id} value={e.edition.id}>{e.edition.name} · {e.edition.year} · {eventLabel(e)}</option>)}</select></div></div>
                {group && !group.editions.some(e => e.draw.completed) && <p>Este grupo no tiene sorteos confirmados.</p>}
                {view === 'repeat' && <button disabled={busy || !selected} onClick={prepareRepeat}>Preparar nuevo sorteo</button>}
            </section>}
            {group && view === 'groups' && <>
                <div className="section-heading group-heading"><div><p className="eyebrow">Grupo</p><h2 ref={heading} tabIndex={-1}>{group.group.name}</h2></div><div className="actions"><button className="secondary" disabled={busy} onClick={() => { void run(refreshGroup); }}>Actualizar grupo</button><button disabled={busy || group.busy} onClick={() => { setView('new'); setReference(undefined); }}>Crear otro sorteo</button></div></div>
                {group.busy && <p role="status">Hay un envío en curso. Actualiza el grupo cuando termine.</p>}
                <nav className="sub-nav" aria-label="Secciones del grupo">{(['draws', 'people', 'settings'] as const).map(id => <button key={id} aria-current={tab === id ? 'page' : undefined} className={tab === id ? 'nav-active' : 'nav-item'} disabled={busy} onClick={() => { setTab(id); setEditionId(''); }}>{id === 'draws' ? 'Sorteos' : id === 'people' ? 'Participantes' : 'Ajustes'}</button>)}</nav>
                {tab === 'people' && <GroupPeople key={group.group.id} people={group.people} disabled={busy || group.busy} onSave={(person, id) => run(async () => setGroup(await groupsApi.person(group, person, id)))} />}
                {tab === 'settings' && <section><h3>Nombre del grupo</h3><form onSubmit={e => { e.preventDefault(); void run(async () => { const next = await groupsApi.rename(group, rename); setGroup(next); await listGroups(); }); }}><label htmlFor="rename-group">Nombre</label><input id="rename-group" value={rename} onChange={e => setRename(e.target.value)} required maxLength={100} disabled={busy || group.busy} /><button disabled={busy || group.busy}>Guardar nombre</button></form></section>}
                {tab === 'draws' && !selected && <section aria-label="Historial de sorteos"><div className="section-heading"><h3>Historial de sorteos</h3><span className="badge">{group.editions.length} ediciones</span></div>{!group.editions.length && <p>No hay sorteos todavía. Crea el primero para reunir a este grupo.</p>}<div className="draw-grid">{group.editions.map(e => <article className="draw-card" key={e.edition.id}><div className="section-heading"><h4>{e.edition.name}</h4><span className={`badge ${e.draw.completed ? 'badge-confirmed' : 'badge-draft'}`}>{e.draw.completed ? 'Confirmado' : 'Borrador'}</span></div><p>{e.edition.year} · {eventLabel(e)}</p><p>{e.draw.participantCount} participantes · {e.results?.available ? 'Resultados disponibles' : 'Asignaciones ocultas'}</p><p className="delivery-summary">Correos · {e.delivery?.mode === 'test' ? 'pruebas' : e.delivery?.mode === 'production' ? 'producción' : 'sin configurar'}<br /><strong>{e.delivery?.accepted ?? 0} aceptados</strong>{!!((e.delivery?.failed ?? 0) + (e.delivery?.uncertain ?? 0)) ? ' · Hay entregas que revisar' : ` · ${e.delivery?.pending ?? 0} pendientes`}</p><button className="secondary" disabled={busy} onClick={() => setEditionId(e.edition.id)}>Abrir {e.edition.name}</button></article>)}</div></section>}
            </>}
            {group && selected && (view === 'remind' || view === 'groups' && tab === 'draws') && <><button className="secondary" disabled={busy} onClick={() => setEditionId('')}>Volver a sorteos</button><DrawDetail key={`${group.group.id}:${selected.edition.id}`} group={group} edition={selected} reminderOnly={view === 'remind'} onBusy={setChildBusy} onChanged={refreshGroup} /></>}
        </>}
        <footer><details><summary>Ayuda y herramientas</summary><p><a href="/mail-preview" target="_blank" rel="noopener noreferrer">Vista previa del correo</a> · Ejemplo ficticio; no envía mensajes.</p><p>Uso local sin autenticación. Antes de la revelación, la API oculta las asignaciones incluso al organizador; los correos individuales pueden contenerlas. Después, cualquier persona con acceso a la aplicación puede ver los resultados.</p></details></footer>
    </main></div>;
}
