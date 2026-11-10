import type { StateResponse } from './api';

interface Props {
    state: StateResponse;
    pending: boolean;
    onDraw: () => void;
    onReset: () => void;
}
export default function DrawPanel({ state, pending, onDraw, onReset }: Props) {
    return <section aria-labelledby="draw-title">
        <h2 id="draw-title">Estado del sorteo</h2>
        <p>{state.draw.completed
            ? `Sorteo completado · ${state.draw.participantCount} participantes. Las asignaciones permanecen privadas.`
            : 'Pendiente. Nadie se regalará a sí mismo ni repetirá el destinatario anterior. La viabilidad se comprobará al realizar el sorteo.'}</p>
        <button disabled={pending || state.draw.completed || state.participants.length < 2} onClick={onDraw}>Realizar sorteo</button>
        <button className="secondary" disabled={pending || !state.draw.completed} onClick={onReset}>Reiniciar sorteo</button>
    </section>;
}
