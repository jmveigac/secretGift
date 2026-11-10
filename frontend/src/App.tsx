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
        <p role="status" aria-live="polite">{pending ? state ? 'Guardando cambios…' : 'Cargando datos…' : ''}</p>
        {error && <p role="alert">{error}</p>}
        {state && <>
            <ParticipantList participants={state.participants} max={state.maxParticipants} disabled={pending || locked}
                onEdit={participant => { setEditing(participant); setFormVersion(version => version + 1); }} onRemove={remove} />
            <ParticipantForm key={formVersion} participant={editing} participants={state.participants}
                disabled={pending || locked || (!editing && state.participants.length >= state.maxParticipants)}
                onSave={save} onCancel={clearForm} />
            <DrawPanel state={state} pending={pending} onDraw={draw} onReset={reset} />
        </>}
        <small>Uso local sin autenticación: cualquier persona con acceso puede consultar y modificar los datos. Se guardan sin cifrar en este equipo. No se muestran asignaciones ni se envían correos.</small>
    </main>;
}
