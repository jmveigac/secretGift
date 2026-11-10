import type { StateResponse } from './api';

interface Props {
    state: StateResponse;
    pending: boolean;
    sending: boolean;
    onDraw: () => void;
    onReset: () => void;
    onSend: (retryUncertain?: boolean) => void;
    onRefresh: () => void;
}
export default function DrawPanel({ state, pending, sending, onDraw, onReset, onSend, onRefresh }: Props) {
    const delivery = state.delivery;
    const busy = pending || !!delivery?.active;
    return <section aria-labelledby="draw-title">
        <h2 id="draw-title">Estado del sorteo</h2>
        <p>{state.draw.completed
            ? `Sorteo completado · ${state.draw.participantCount} participantes. Las asignaciones permanecen privadas.`
            : 'Pendiente. Nadie se regalará a sí mismo ni repetirá el destinatario anterior. La viabilidad se comprobará al realizar el sorteo.'}</p>
        <button disabled={busy || state.draw.completed || state.participants.length < 2} onClick={onDraw}>Realizar sorteo</button>
        <button className="secondary" disabled={busy || !state.draw.completed} onClick={onReset}>Reiniciar sorteo</button>
        {state.draw.completed && delivery && <div>
            <h3>Envío de asignaciones</h3>
            <p>{delivery.active || sending ? 'Envíos en curso.' : delivery.accepted === state.draw.participantCount ? 'Envíos completados: aceptados por SMTP.' : delivery.failed ? 'Hay envíos fallidos.' : delivery.uncertain ? 'Hay envíos con resultado incierto.' : 'Envíos pendientes.'}</p>
            <p>Aceptados: {delivery.accepted} · Pendientes: {delivery.pending} · Fallidos: {delivery.failed} · Inciertos: {delivery.uncertain}</p>
            <p>La aceptación por SMTP no confirma la llegada a la bandeja de entrada.</p>
            {!delivery.configured && <p role="alert">SMTP no está configurado. Configura las variables privadas y reinicia la aplicación.</p>}
            <button disabled={busy || !delivery.configured || delivery.pending + delivery.failed === 0} onClick={() => onSend()}>Enviar pendientes y fallidos</button>
            {delivery.uncertain > 0 && <>
                <p>Un envío incierto puede haber sido aceptado. Reenviarlo puede producir un duplicado.</p>
                <button disabled={busy || !delivery.configured} onClick={() => onSend(true)}>Reenviar también inciertos</button>
            </>}
            <button className="secondary" disabled={pending} onClick={onRefresh}>Actualizar estado</button>
        </div>}
    </section>;
}
