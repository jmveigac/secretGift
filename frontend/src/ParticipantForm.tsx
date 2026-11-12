import { useState, type FormEvent } from 'react';
import type { Participant, ParticipantInput } from './api';

interface Props {
    participant: Participant | null;
    participants: Participant[];
    disabled: boolean;
    onSave: (input: ParticipantInput, id?: string) => Promise<void>;
    onCancel: () => void;
}
export default function ParticipantForm({ participant, participants, disabled, onSave, onCancel }: Props) {
    const [name, setName] = useState(participant?.name ?? '');
    const [email, setEmail] = useState(participant?.email ?? '');
    const [previousId, setPreviousId] = useState(participant?.previousId ?? '');
    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!disabled) void onSave({ name, email, previousId: previousId || null }, participant?.id);
    }
    return <section aria-labelledby="form-title">
        <h2 id="form-title">{participant ? 'Editar participante' : 'Añadir participante'}</h2>
        <form onSubmit={submit}>
            <fieldset disabled={disabled}>
                <label htmlFor="participant-name">Nombre</label>
                <input id="participant-name" value={name} onChange={e => setName(e.target.value)} required maxLength={100} autoComplete="off" />
                <label htmlFor="participant-email">Correo</label>
                <input id="participant-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} autoComplete="off" />
                <label htmlFor="previous">Restricción manual: destinatario anterior (opcional)</label>
                <select id="previous" value={previousId} onChange={e => setPreviousId(e.target.value)}>
                    <option value="">Sin restricción anterior</option>
                    {participants.filter(p => p.id !== participant?.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <div className="form-actions">
                    <button type="submit">Guardar participante</button>
                    <button type="button" className="secondary" onClick={onCancel}>Cancelar edición</button>
                </div>
            </fieldset>
        </form>
    </section>;
}
