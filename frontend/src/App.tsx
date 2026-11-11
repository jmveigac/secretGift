import { useEffect, useRef, useState } from 'react';
import { api, type Participant, type ParticipantInput, type StateResponse } from './api';
import ParticipantList from './ParticipantList';
import ParticipantForm from './ParticipantForm';
import DrawPanel from './DrawPanel';

export default function App() {
    const [state, setState] = useState<StateResponse | null>(null);
    const [editing, setEditing] = useState<Participant | null>(null);
    const [formVersion, setFormVersion] = useState(0);
    const [pending, setPending] = useState(true);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const inFlight = useRef(false);

    useEffect(() => {
        let active = true;
        api.state().then(data => { if (active) setState(data); })
            .catch(() => { if (active) setError('No se pudieron cargar los datos. Recarga la página para reintentar.'); })
            .finally(() => { if (active) setPending(false); });
        return () => { active = false; };
    }, []);

    function clearForm() {
        setEditing(null);
        setFormVersion(version => version + 1);
    }
    async function mutate(operation: () => Promise<StateResponse>) {
        if (pending || inFlight.current) return;
        inFlight.current = true;
        setPending(true);
        setError('');
        try {
            setState(await operation());
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
        if (!pending && window.confirm('¿Eliminar a este participante? Se retirarán sus referencias del año anterior.')) {
            void mutate(() => api.remove(participant.id));
        }
    }
    function draw() {
        if (!pending && window.confirm('¿Realizar el sorteo con la lista y restricciones actuales? Quedará bloqueado hasta reiniciarlo. No se enviarán correos.')) {
            void mutate(api.draw);
        }
    }
    function send(retryUncertain = false) {
        if (!state?.draw.completed || !state.delivery || pending) return;
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
        if (!pending && window.confirm('¿Reiniciar el sorteo? Se descartarán las asignaciones actuales y se conservarán los participantes.')) {
            void mutate(api.reset);
        }
    }
    const locked = state?.draw.completed ?? false;
    return <main>
        <p className="tag">AMIGO INVISIBLE · LOCAL</p>
        <h1>secretGift</h1>
        <p>Prepara la lista y deja que empiece la sorpresa.</p>
        <p><a href="/mail-preview" target="_blank" rel="noopener noreferrer">Vista previa del correo</a> (se abre en otra pestaña).
            {' '}Solo datos ficticios; no envía correos ni utiliza tu sorteo.</p>
        <p role="status" aria-live="polite">{pending ? state ? 'Guardando cambios…' : 'Cargando datos…' : ''}</p>
        {error && <p role="alert">{error}</p>}
        {state && <>
            <ParticipantList participants={state.participants} max={state.maxParticipants} disabled={pending || locked}
                onEdit={participant => { setEditing(participant); setFormVersion(version => version + 1); }} onRemove={remove} />
            <ParticipantForm key={formVersion} participant={editing} participants={state.participants}
                disabled={pending || locked || (!editing && state.participants.length >= state.maxParticipants)}
                onSave={save} onCancel={clearForm} />
            <DrawPanel state={state} pending={pending} sending={sending} onDraw={draw} onReset={reset} onSend={send} onRefresh={() => { void mutate(api.state); }} />
        </>}
        <small>Uso local sin autenticación: quien tenga acceso a la aplicación puede gestionar los datos. Los campos personales y las asignaciones privadas se guardan cifrados; SQLite no está cifrado íntegramente. Los correos solo se envían tras confirmación.</small>
    </main>;
}
