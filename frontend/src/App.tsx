import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { groupsApi, type Group, type GroupResponse, type StateResponse } from './api';
import GroupPeople from './GroupPeople';
import EditionPanel from './EditionPanel';

export default function App() {
    const [groups, setGroups] = useState<Group[]>([]);
    const [group, setGroup] = useState<GroupResponse | null>(null);
    const [editionId, setEditionId] = useState('');
    const [pending, setPending] = useState(true), [editionBusy, setEditionBusy] = useState(false);
    const [error, setError] = useState('');
    const [newGroup, setNewGroup] = useState(''), [rename, setRename] = useState('');
    const [editionName, setEditionName] = useState(''), [year, setYear] = useState(String(new Date().getFullYear()));
    const [selected, setSelected] = useState<string[]>([]);
    const inFlight = useRef(false);
    const busy = pending || editionBusy || !!group?.busy;
    const currentEdition = group?.editions.find(e => e.edition.id === editionId);
    function editionLabel(entry: GroupResponse['editions'][number]) {
        const sameName = group!.editions.filter(e => e.edition.year === entry.edition.year && e.edition.name.toLowerCase() === entry.edition.name.toLowerCase());
        const number = sameName.length > 1 ? ` · n.º ${group!.editions.indexOf(entry) + 1}` : '';
        return `${entry.edition.name} · ${entry.edition.year}${number}`;
    }

    useEffect(() => {
        let active = true;
        groupsApi.list().then(async data => {
            if (!active) return;
            setGroups(data.groups);
            if (data.groups[0]) {
                const first = await groupsApi.get(data.groups[0].id);
                if (active) { setGroup(first); setEditionId(first.editions[0]?.edition.id ?? ''); }
            }
        }).catch(() => { if (active) setError('No se pudieron cargar los grupos. Recarga la página para reintentar.'); })
            .finally(() => { if (active) setPending(false); });
        return () => { active = false; };
    }, []);
    useEffect(() => { setRename(group?.group.name ?? ''); }, [group?.group.id, group?.group.name]);

    useEffect(() => { setSelected(ids => ids.filter(id => group?.people.some(p => p.id === id && p.active))); }, [group?.people]);

    async function run(operation: () => Promise<void>): Promise<boolean> {
        if (inFlight.current || pending || editionBusy) return false;
        inFlight.current = true; setPending(true); setError('');
        try { await operation(); return true; }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo completar la operación.'); return false; }
        finally { inFlight.current = false; setPending(false); }
    }
    async function chooseGroup(id: string) {
        if (busy) return;
        await run(async () => {
            setGroup(null); setEditionId(''); setSelected([]); setEditionName('');
            const next = await groupsApi.get(id); setGroup(next); setEditionId(next.editions[0]?.edition.id ?? '');
        });
    }
    async function createGroup(event: FormEvent) {
        event.preventDefault();
        await run(async () => {
            const next = await groupsApi.create(newGroup);
            setGroups((await groupsApi.list()).groups); setGroup(next); setEditionId(''); setSelected([]); setNewGroup('');
        });
    }
    async function createEdition(event: FormEvent) {
        event.preventDefault(); if (!group) return;
        const source = group;
        await run(async () => {
            const next = await groupsApi.edition(source, editionName, Number(year), selected);
            const created = next.editions.find(e => !source.editions.some(old => old.edition.id === e.edition.id));
            setGroup(next); setEditionId(created?.edition.id ?? ''); setEditionName(''); setSelected([]);
        });
    }
    const editionChanged = useCallback(async (state: StateResponse) => {
        if (!state.scope) return;
        const next = await groupsApi.get(state.scope.groupId);
        setGroup(next); setEditionId(state.scope.editionId);
    }, []);

    return <main>
        <p className="tag">AMIGO INVISIBLE · LOCAL</p><h1>secretGift</h1>
        <p>Prepara la lista y deja que empiece la sorpresa.</p>
        <p><a href="/mail-preview" target="_blank" rel="noopener noreferrer">Vista previa del correo</a> (se abre en otra pestaña).
            {' '}Solo datos ficticios; no envía correos ni utiliza tu sorteo.</p>
        {error && <p role="alert">{error}</p>}
        <p role="status">{pending ? 'Cargando o guardando grupo…' : ''}</p>
        <section aria-labelledby="groups-title">
            <h2 id="groups-title">Grupos</h2>
            <label htmlFor="group-select">Grupo activo</label>
            <select id="group-select" value={group?.group.id ?? ''} disabled={busy} onChange={e => { void chooseGroup(e.target.value); }}>
                <option value="" disabled>Selecciona un grupo</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <form onSubmit={event => { void createGroup(event); }}><fieldset disabled={busy}>
                <label htmlFor="group-new">Nombre del nuevo grupo</label>
                <input id="group-new" required maxLength={100} value={newGroup} onChange={e => setNewGroup(e.target.value)} />
                <button>Crear grupo</button>
            </fieldset></form>
            {group && <>
                <form onSubmit={event => {
                    event.preventDefault(); if (!window.confirm('¿Cambiar el nombre de este grupo?')) return;
                    void run(async () => { const next = await groupsApi.rename(group, rename); setGroup(next); setGroups((await groupsApi.list()).groups); });
                }}><fieldset disabled={busy}>
                    <label htmlFor="group-name">Nombre del grupo</label>
                    <input id="group-name" required maxLength={100} value={rename} onChange={e => setRename(e.target.value)} />
                    <button>Guardar nombre del grupo</button>
                </fieldset></form>
                <button className="secondary" disabled={pending || editionBusy} onClick={() => { void run(async () => { setGroup(await groupsApi.get(group.group.id)); setGroups((await groupsApi.list()).groups); }); }}>Actualizar grupo</button>
                {group.busy && <p>Hay un envío en curso. Actualiza el grupo cuando termine para editar sus datos.</p>}
            </>}
        </section>
        {group && <>
            <h2>Grupo: {group.group.name}</h2>
            <GroupPeople key={`${group.group.id}:${group.revision}`} people={group.people} disabled={busy} onSave={(person, id) => {
                if (id && (person.name !== group.people.find(p => p.id === id)?.name || person.email !== group.people.find(p => p.id === id)?.email)
                    && !window.confirm('¿Actualizar este contacto? Las ediciones existentes conservarán sus datos.')) return Promise.resolve(false);
                return run(async () => { setGroup(await groupsApi.person(group, person, id)); });
            }} />
            <section aria-labelledby="editions-title">
                <h2 id="editions-title">Ediciones</h2>
                <label htmlFor="edition-select">Edición activa</label>
                <select id="edition-select" value={editionId} disabled={busy || group.editions.length === 0} onChange={e => {
                    if (!busy) setEditionId(e.target.value);
                }}>
                    <option value="" disabled>Selecciona una edición</option>
                    {group.editions.map(e => <option key={e.edition.id} value={e.edition.id}>{editionLabel(e)} · {e.draw.completed ? 'Sorteada' : 'Pendiente'}</option>)}
                </select>
                <form onSubmit={event => { void createEdition(event); }}><fieldset disabled={busy}>
                    <label htmlFor="edition-name">Nombre de la nueva edición</label>
                    <input id="edition-name" required maxLength={100} value={editionName} onChange={e => setEditionName(e.target.value)} />
                    <label htmlFor="edition-year">Año de referencia</label>
                    <input id="edition-year" type="number" required min={1} max={9999} value={year} onChange={e => setYear(e.target.value)} />
                    <p>Selecciona personas activas. La edición guardará una copia de sus contactos actuales.</p>
                    {group.people.filter(p => p.active).map(p => <label className="person-choice" key={p.id}>
                        <input type="checkbox" checked={selected.includes(p.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id))} />
                        {p.name} · {p.email}
                    </label>)}
                    <p>{selected.length} / {group.maxParticipants} personas seleccionadas</p>
                    <button disabled={selected.length > group.maxParticipants}>Crear edición</button>
                </fieldset></form>
            </section>
            {currentEdition && <>
                <h2>Edición: {editionLabel(currentEdition)}</h2>
                <p>Los cambios de esta lista afectan solo a esta edición. Añadir un participante crea también su identidad en el grupo.</p>
                <EditionPanel key={`${group.group.id}:${editionId}`} scope={{ groupId: group.group.id, editionId }} people={group.people} groupRevision={group.revision} blocked={pending}
                    onBusy={setEditionBusy} onChanged={editionChanged} />
            </>}
        </>}
        <small>Uso local sin autenticación: quien tenga acceso a la aplicación puede gestionar los datos. Los campos personales y las asignaciones privadas se guardan cifrados; SQLite no está cifrado íntegramente. Los correos solo se envían tras confirmación.</small>
    </main>;
}
