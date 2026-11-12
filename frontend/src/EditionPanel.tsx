import { useEffect, useRef, useState } from 'react';
import { editionApi, type EditionScope, type Person, type Participant, type ParticipantInput, type StateResponse } from './api';
import ParticipantList from './ParticipantList';
import ParticipantForm from './ParticipantForm';
import DrawPanel from './DrawPanel';

interface Props { scope?: EditionScope; people?: Person[]; groupRevision?: string; blocked?: boolean; onBusy?: (busy: boolean) => void; onChanged?: (state: StateResponse) => Promise<void> }
export default function EditionPanel({ scope, people = [], groupRevision, blocked = false, onBusy, onChanged }: Props) {
    const [state, setState] = useState<StateResponse | null>(null);
    const [editing, setEditing] = useState<Participant | null>(null);
    const [formVersion, setFormVersion] = useState(0);
    const [pending, setPending] = useState(true);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const inFlight = useRef(false);
    const [personId, setPersonId] = useState('');

    const api = editionApi(scope, state?.revision, groupRevision);
    useEffect(() => {
        onBusy?.(pending || sending);
        return () => onBusy?.(false);
    }, [pending, sending, onBusy]);

    useEffect(() => {
        let active = true;
        api.state().then(data => { if (active) setState(data); })
            .catch(() => { if (active) setError('No se pudieron cargar los datos. Recarga la página para reintentar.'); })
            .finally(() => { if (active) setPending(false); });
        return () => { active = false; };
    }, []);

    function clearForm() {
        setEditing(null);
        setPersonId('');
        setFormVersion(version => version + 1);
    }
    async function mutate(operation: () => Promise<StateResponse>, readOnly = false) {
        if (pending || (!readOnly && (blocked || state?.delivery?.active)) || inFlight.current) return;
        inFlight.current = true;
        setPending(true);
        setError('');
        try {
            const next = await operation();
            setState(next);
            await onChanged?.(next);
            clearForm();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'No se pudo completar la operación.');
        } finally {
            inFlight.current = false;
            setPending(false);
        }
    }
    function save(input: ParticipantInput, id?: string) {
        return mutate(() => api.save(input, id));
    }
    function remove(participant: Participant) {
        if (!pending && !blocked && window.confirm('¿Eliminar a este participante? Se retirarán sus restricciones manuales.')) {
            void mutate(() => api.remove(participant.id));
        }
    }
    function draw() {
        if (!pending && !blocked && window.confirm('¿Realizar el sorteo con la lista y restricciones actuales? Quedará bloqueado hasta reiniciarlo. No se enviarán correos.')) {
            void mutate(api.draw);
        }
    }
    function send(retryUncertain = false) {
        if (!state?.draw.completed || !state.delivery || pending || blocked) return;
        const warning = retryUncertain
            ? `Se enviarán correos reales para el sorteo de ${state.draw.participantCount} participantes, incluidos los inciertos. Estos podrían haber sido aceptados por SMTP. Reenviarlos puede duplicarlos. ¿Confirmas esta decisión?`
            : `Se enviarán correos reales para el sorteo de ${state.draw.participantCount} participantes, solo a los pendientes o fallidos. ¿Confirmas el envío?`;
        if (window.confirm(warning)) {
            const drawId = state.draw.completedAt;
            void mutate(async () => {
                setSending(true);
                try { return await api.send(drawId, state.delivery!.revision, retryUncertain); }
                finally { setSending(false); }
            });
        }
    }
    function reset() {
        if (!pending && !blocked && window.confirm('¿Reiniciar el sorteo? Se conservará esta edición y se abrirá otra sin sorteo con los mismos participantes.')) {
            void mutate(api.reset);
        }
    }
    const locked = state?.draw.completed ?? false;
    const available = people.filter(p => p.active && !state?.participants.some(member => member.id === p.id));
    return <section aria-label="Edición seleccionada">
        <p role="status" aria-live="polite">{pending ? state ? 'Guardando cambios…' : 'Cargando datos…' : ''}</p>
        {error && <p role="alert">{error}</p>}
        {state && <>
            {scope && <fieldset disabled={pending || blocked || locked || !!state.delivery?.active || state.participants.length >= state.maxParticipants}>
                <label htmlFor="edition-person">Añadir persona activa del grupo a esta edición</label>
                <select id="edition-person" value={personId} onChange={e => setPersonId(e.target.value)}>
                    <option value="">Selecciona una persona</option>
                    {available.map(p => <option key={p.id} value={p.id}>{p.name} · {p.email}</option>)}
                </select>
                <button disabled={!available.some(p => p.id === personId)} onClick={() => { void mutate(() => api.addPerson(personId)); }}>Incluir persona en la edición</button>
            </fieldset>}
            <ParticipantList participants={state.participants} max={state.maxParticipants} disabled={pending || blocked || !!state.delivery?.active || locked}
                onEdit={participant => { setEditing(participant); setFormVersion(version => version + 1); }} onRemove={remove} />
            <ParticipantForm key={formVersion} participant={editing} participants={state.participants}
                disabled={pending || blocked || !!state.delivery?.active || locked || (!editing && state.participants.length >= state.maxParticipants)}
                onSave={save} onCancel={clearForm} />
            <DrawPanel state={state} pending={pending || blocked} sending={sending} onDraw={draw} onReset={reset} onSend={send} onRefresh={() => { void mutate(api.state, true); }} />
        </>}
    </section>;
}
