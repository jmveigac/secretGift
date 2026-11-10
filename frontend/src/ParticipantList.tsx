import type { Participant } from './api';

interface Props {
    participants: Participant[];
    max: number;
    disabled: boolean;
    onEdit: (participant: Participant) => void;
    onRemove: (participant: Participant) => void;
}
export default function ParticipantList({ participants, max, disabled, onEdit, onRemove }: Props) {
    return <section aria-labelledby="participants-title">
        <h2 id="participants-title">Participantes</h2>
        <p>{participants.length} / {max} participantes</p>
        {participants.length === 0 && <p>Añade participantes para preparar el sorteo.</p>}
        <ul>
            {participants.map(participant => {
                const previous = participants.find(p => p.id === participant.previousId);
                return <li key={participant.id}>
                    <div className="participant-details">
                        <strong>{participant.name}</strong><span>{participant.email}</span>
                        {previous && <span>Año anterior: {previous.name}</span>}
                    </div>
                    <div>
                        <button disabled={disabled} onClick={() => onEdit(participant)} aria-label={`Editar a ${participant.name}`}>Editar</button>
                        <button className="secondary" disabled={disabled} onClick={() => onRemove(participant)} aria-label={`Eliminar a ${participant.name}`}>Eliminar</button>
                    </div>
                </li>;
            })}
        </ul>
    </section>;
}
