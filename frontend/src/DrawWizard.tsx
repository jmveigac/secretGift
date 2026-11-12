import { useEffect, useRef, useState, type FormEvent } from 'react';
import { groupsApi, workflowApi, type Group, type GroupResponse, type RestrictionPreview } from './api';
import GroupPeople from './GroupPeople';

export interface ReferenceDraw { id: string; name: string; personIds: string[] }
interface Props {
    groups: Group[]; initialGroup?: GroupResponse; reference?: ReferenceDraw;
    onBusy: (busy: boolean) => void; onGroupsChanged: () => Promise<void>;
    onDone: (group: GroupResponse, editionId: string) => void;
}
const steps = ['Grupo', 'Participantes', 'Antecedentes', 'Fecha y hora', 'Revisión'];
export function restrictionText(source: string) {
    return source === 'verified' ? 'Historial verificado prioritario y privado. Si su destinatario no participa, no se añade otra exclusión manual.'
        : source === 'manual' ? 'Se evitará el destinatario anterior indicado.' : 'Sin antecedente conocido.';
}
export default function DrawWizard({ groups, initialGroup, reference, onBusy, onGroupsChanged, onDone }: Props) {
    const [step, setStep] = useState(0), [group, setGroup] = useState(initialGroup);
    const [selected, setSelected] = useState<string[]>(reference?.personIds.filter(id => initialGroup?.people.some(p => p.id === id && p.active)) ?? initialGroup?.people.filter(p => p.active).map(p => p.id) ?? []);
    const [previous, setPrevious] = useState<Record<string, string | null>>({});
    const [name, setName] = useState(''), [newGroup, setNewGroup] = useState('');
    const [date, setDate] = useState(''), [time, setTime] = useState('20:00'), [timeZone, setZone] = useState('Europe/Madrid');
    const [preview, setPreview] = useState<RestrictionPreview>();
    const [pending, setPending] = useState(false), [error, setError] = useState('');
    const lock = useRef(false), heading = useRef<HTMLHeadingElement>(null);
    useEffect(() => { onBusy(pending); return () => onBusy(false); }, [pending, onBusy]);
    useEffect(() => { heading.current?.focus(); }, [step]);
    async function run(operation: () => Promise<void>) {
        if (lock.current) { setError('Espera a que termine la solicitud en curso.'); return false; }
        lock.current = true; setPending(true); setError('');
        try { await operation(); return true; } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo completar la solicitud.'); return false; }
        finally { lock.current = false; setPending(false); }
    }
    async function chooseGroup(id: string) {
        await run(async () => { const next = await groupsApi.get(id); setGroup(next); setSelected(next.people.filter(p => p.active).map(p => p.id)); setPrevious({}); setPreview(undefined); });
    }
    function toggle(id: string) {
        const next = selected.includes(id) ? selected.filter(v => v !== id) : [...selected, id];
        setSelected(next); setPrevious(Object.fromEntries(Object.entries(previous).filter(([giver]) => next.includes(giver)).map(([giver, receiver]) => [giver, receiver && next.includes(receiver) ? receiver : null]))); setPreview(undefined);
    }
    async function advance(event: FormEvent) {
        event.preventDefault(); if (pending || !group) return;
        if (step === 1 && (selected.length < 2 || selected.length > group.maxParticipants)) { setError(`Selecciona entre 2 y ${group.maxParticipants} personas.`); return; }
        if (step === 2 || step === 3) {
            await run(async () => {
                const next = await workflowApi.preview(group, selected, previous, step === 3 ? { localDateTime: `${date}T${time}`, timeZone } : undefined);
                setPreview(next); if (!next.viable) throw new Error('No existe un sorteo válido con esta selección y sus antecedentes. Revisa los participantes sin inventar relaciones.');
                setStep(step + 1);
            });
        } else setStep(step + 1);
    }
    function confirm() {
        if (pending || lock.current || !group || !preview?.viable) { setError('Espera o revisa los datos antes de confirmar.'); return; }
        if (!window.confirm(`¿Confirmar «${name}» para ${selected.length} participantes, el ${date} a las ${time} (${timeZone})? No se enviarán correos. La fecha de revelación quedará fija.`)) return;
        void run(async () => {
            const before = new Set(group.editions.map(e => e.edition.id));
            const next = await workflowApi.create(group, { name, year: Number(date.slice(0, 4)), personIds: selected, previousIds: previous,
                schedule: { localDateTime: `${date}T${time}`, timeZone }, confirmDraw: true, referenceEditionId: reference?.id });
            const created = next.editions.find(e => !before.has(e.edition.id));
            if (!created) throw new Error('No se pudo identificar el sorteo. Actualiza el grupo antes de volver a confirmar.');
            onDone(next, created.edition.id);
        });
    }
    const people = group?.people.filter(p => selected.includes(p.id)) ?? [];
    return <section className="wizard" aria-label={reference ? 'Repetir sorteo' : 'Nuevo sorteo'}>
        <div className="section-heading"><div><p className="eyebrow">{reference ? `A partir de ${reference.name}` : 'Un sorteo, paso a paso'}</p><h2 ref={heading} tabIndex={-1}>{steps[step]}</h2></div><span className="badge">{group?.group.name ? `${group.group.name} · ` : ''}Paso {step + 1} de 5</span></div>
        <ol className="steps" aria-label="Pasos del sorteo">{steps.map((label, i) => <li key={label} aria-current={step === i ? 'step' : undefined}><span>{i + 1}</span>{label}</li>)}</ol>
        {error && <><p role="alert">{error}</p>{group && <button className="secondary" disabled={pending} onClick={() => { void run(async () => {
            const next = await groupsApi.get(group.group.id); setGroup(next);
            const ids = selected.filter(id => next.people.some(p => p.id === id && p.active)); setSelected(ids);
            setPrevious(Object.fromEntries(Object.entries(previous).filter(([id]) => ids.includes(id)).map(([id, receiver]) => [id, receiver && ids.includes(receiver) ? receiver : null])));
            setPreview(undefined); setStep(1);
        }); }}>Actualizar grupo y revisar</button>}</>}
        {pending && <p role="status">Comprobando o guardando datos…</p>}
        {step === 0 && <>
            <label htmlFor="wizard-group">Grupo del sorteo</label><select id="wizard-group" value={group?.group.id ?? ''} disabled={pending || !!reference} onChange={e => { void chooseGroup(e.target.value); }}><option value="" disabled>Selecciona un grupo</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
            {!reference && <details><summary>Crear un grupo nuevo</summary><form onSubmit={event => { event.preventDefault(); void run(async () => { const next = await groupsApi.create(newGroup); setGroup(next); setSelected([]); setPrevious({}); setNewGroup(''); await onGroupsChanged(); }); }}><label htmlFor="wizard-new-group">Nombre del grupo</label><input id="wizard-new-group" value={newGroup} required maxLength={100} onChange={e => setNewGroup(e.target.value)} disabled={pending} /><button disabled={pending}>Crear grupo</button></form></details>}
            {group && <p>{group.people.filter(p => p.active).length} personas activas. Sus identidades e historial se conservarán.</p>}
            <button disabled={pending || !group} onClick={() => setStep(1)}>Continuar</button>
        </>}
        {step > 0 && step < 4 && <form onSubmit={event => { void advance(event); }}><fieldset disabled={pending}>
            {step === 1 && <>
                <p>Marca quién participa. Desmarcar aquí solo excluye de este sorteo; desactivar un contacto afecta al directorio.</p>
                <div className="people-grid">{group?.people.filter(p => p.active).map(p => <label className="person-choice choice-card" key={p.id}><input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} /><span>{p.name}<small>{p.email}</small></span></label>)}</div>
                {!group?.people.some(p => p.active) && <p>No hay personas activas. Añade contactos para continuar.</p>}
                <p role="status">{selected.length} participantes seleccionados · máximo {group?.maxParticipants}</p>
                {reference && <p>Se proponen las personas anteriores que siguen activas. Puedes activar otras desde el directorio.</p>}
            </>}
            {step === 2 && <>
                <p>Indica solo relaciones conocidas de fuera de secretGift. Puedes dejar huecos. Si el destinatario anterior no participa, no necesitas una exclusión manual.</p>
                <p>El último historial verificado tiene prioridad; su relación no se muestra mientras esté protegida.</p>
                <div className="people-grid">{people.map(p => <div className="choice-card" key={p.id}><label htmlFor={`previous-${p.id}`}>{p.name} regaló a</label><select id={`previous-${p.id}`} value={previous[p.id] ?? ''} onChange={e => { setPrevious({ ...previous, [p.id]: e.target.value || null }); setPreview(undefined); }}><option value="">No lo sé / sin antecedente</option>{people.filter(other => other.id !== p.id).map(other => <option key={other.id} value={other.id}>{other.name}</option>)}</select></div>)}</div>
            </>}
            {step === 3 && <>
                <p>La fecha del evento será también la fecha de revelación. Una vez confirmado, no se podrá adelantar ni cambiar.</p>
                <label htmlFor="draw-name">Título del sorteo</label><input id="draw-name" value={name} onChange={e => setName(e.target.value)} required maxLength={100} placeholder="Una cena entre amigos" />
                <div className="form-grid"><div><label htmlFor="event-date">Fecha del evento</label><input id="event-date" type="date" value={date} required onChange={e => setDate(e.target.value)} /></div><div><label htmlFor="event-time">Hora del evento</label><input id="event-time" type="time" value={time} required onChange={e => setTime(e.target.value)} /></div></div>
                <label htmlFor="event-zone">Zona horaria</label><input id="event-zone" value={timeZone} onChange={e => setZone(e.target.value)} required list="time-zones" /><datalist id="time-zones"><option value="Europe/Madrid" /><option value="UTC" /><option value="Atlantic/Canary" /></datalist>
                <p className="muted">El servidor valida la zona y los cambios de horario. Las horas ambiguas o inexistentes se rechazan.</p>
            </>}
            <div className="actions"><button type="button" className="secondary" onClick={() => { setError(''); setStep(step - 1); }}>Anterior</button><button>{step === 2 ? 'Comprobar antecedentes' : step === 3 ? 'Revisar sorteo' : 'Continuar'}</button></div>
        </fieldset></form>}
        {step === 1 && group && <details><summary>Añadir o editar contactos del grupo</summary><GroupPeople people={group.people} disabled={pending} onSave={(person, id) => run(async () => {
            const next = await groupsApi.person(group, person, id); const added = next.people.find(p => !group.people.some(old => old.id === p.id)); setGroup(next);
            const selection = [...selected.filter(pid => next.people.some(p => p.id === pid && p.active)), ...(added?.active ? [added.id] : [])];
            setSelected(selection); setPrevious(Object.fromEntries(Object.entries(previous).filter(([id]) => selection.includes(id)).map(([id, receiver]) => [id, receiver && selection.includes(receiver) ? receiver : null]))); setPreview(undefined);
        })} /></details>}
        {step === 4 && <>
            <div className="review-grid"><div><p className="eyebrow">Grupo</p><h3>{group?.group.name}</h3><p>{name}</p></div><div><p className="eyebrow">Evento y revelación</p><p>{date} · {time}<br />{timeZone}</p></div></div>
            <h3>{people.length} participantes y restricciones</h3><ul className="review-list">{people.map(p => { const r = preview?.restrictions.find(r => r.personId === p.id); return <li key={p.id}><span><strong>{p.name}</strong><small>{p.email}</small></span><span>{restrictionText(r?.source ?? 'none')}{r?.source === 'manual' && ` No repetirá con ${people.find(other => other.id === r.previousId)?.name}.`}</span></li>; })}</ul>
            <p>No se muestran asignaciones. Confirmar no envía correos. Si la fecha ya pasó, los resultados quedarán disponibles al confirmar.</p>
            <div className="actions"><button className="secondary" disabled={pending} onClick={() => setStep(3)}>Anterior</button><button disabled={pending} onClick={confirm}>Confirmar sorteo</button></div>
        </>}
    </section>;
}
