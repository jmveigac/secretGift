import { useEffect, useRef, useState } from 'react';
import { editionApi, type EditionScope, type Person, type Participant, type ParticipantInput, type StateResponse } from './api';
import ParticipantList from './ParticipantList';
import ParticipantForm from './ParticipantForm';
import DrawPanel from './DrawPanel';

interface Props { requireSchedule?: boolean; scope?: EditionScope; people?: Person[]; groupRevision?: string; blocked?: boolean; onBusy?: (busy: boolean) => void; onChanged?: (state: StateResponse) => Promise<void> }
export default function EditionPanel({ requireSchedule = false, scope, people = [], groupRevision, blocked = false, onBusy, onChanged }: Props) {
    const [state, setState] = useState<StateResponse | null>(null);
    const [editing, setEditing] = useState<Participant | null>(null);
    const [formVersion, setFormVersion] = useState(0);
    const [pending, setPending] = useState(true);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
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
        if (pending || (!readOnly && (blocked || state?.delivery?.active)) || inFlight.current) {
            setError('La operación está bloqueada por otra solicitud. Espera y actualiza el estado.');
            return false;
        }
        inFlight.current = true;
        setPending(true);
        setError('');
        setNotice('');
        try {
            const next = await operation();
            setState(next);
            try { await onChanged?.(next); }
            catch { setError('La operación se completó, pero no se pudo actualizar el grupo. Actualiza el estado antes de continuar.'); }
            clearForm();
            return true;
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'No se pudo completar la operación.');
            return false;
        } finally {
            inFlight.current = false;
            setPending(false);
        }
    }
    async function save(input: ParticipantInput, id?: string) {
        await mutate(() => api.save(input, id));
    }
    function remove(participant: Participant) {
        if (!pending && !blocked && window.confirm('¿Eliminar a este participante? Se retirarán sus restricciones manuales.')) {
            void mutate(() => api.remove(participant.id));
        }
    }
    function draw() {
        if (requireSchedule && !state?.schedule) { setError('Guarda una fecha de revelación antes de confirmar el sorteo.'); return; }
        if (!pending && !blocked && window.confirm('¿Realizar el sorteo con la lista y restricciones actuales? Quedará bloqueado hasta reiniciarlo. No se enviarán correos.')) {
            void mutate(api.draw);
        }
    }
    function send(retryUncertain = false) {
        if (pending || blocked || inFlight.current || state?.delivery?.active) {
            setError('La operación está bloqueada por otra solicitud. Espera y actualiza el estado.');
            return;
        }
        if (!state?.draw.completed || !state.delivery || !state.delivery.configured) {
            setError(state?.delivery?.configurationError ?? 'No se puede enviar: confirma el sorteo y revisa la configuración.');
            return;
        }
        const delivery = state.delivery;
        const count = delivery.pending + delivery.failed + (retryUncertain ? delivery.uncertain : 0);
        const target = delivery.mode === 'test' ? `Modo PRUEBAS. Destinatario exclusivo: ${delivery.testEmail}.` : 'Modo PRODUCCIÓN. Destinatarios: los participantes de esta edición.';
        const warning = `${target} Se enviarán correos reales para el sorteo de ${state.draw.participantCount} participantes: ${count} mensajes.`
            + (retryUncertain ? ' Incluye inciertos: reenviarlos puede duplicarlos.' : ' Solo pendientes o fallidos.') + ' ¿Confirmas el envío?';
        if (window.confirm(warning)) {
            const drawId = state.draw.completedAt;
            void mutate(async () => {
                setSending(true);
                try { return await api.send(drawId, delivery.revision, retryUncertain); }
                finally { setSending(false); }
            }).then(completed => { if (completed) setNotice('Solicitud de envío completada. Revisa los contadores; aceptación SMTP no confirma recepción.'); });
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
        {notice && <p role="status">{notice}</p>}
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
            <DrawPanel drawBlocked={requireSchedule && !state.schedule} state={state} pending={pending || blocked} sending={sending} onDraw={draw} onReset={reset} onSend={send} onRefresh={() => { void mutate(api.state, true); }} />
        </>}
    </section>;
}
