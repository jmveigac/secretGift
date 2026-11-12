import type { StateResponse } from './api';

interface Props {
    state: StateResponse;
    drawBlocked?: boolean;
    pending: boolean;
    sending: boolean;
    onDraw: () => void;
    onReset: () => void;
    onSend: (retryUncertain?: boolean) => void;
    onRefresh: () => void;
}
export default function DrawPanel({ drawBlocked = false, state, pending, sending, onDraw, onReset, onSend, onRefresh }: Props) {
    const delivery = state.delivery;
    const busy = pending || !!delivery?.active;
    return <section aria-labelledby="draw-title">
        <h2 id="draw-title">Estado del sorteo</h2>
        <p>{state.draw.completed
            ? `Sorteo completado · ${state.draw.participantCount} participantes. Las asignaciones permanecen privadas.`
            : 'Pendiente. Nadie se regalará a sí mismo ni repetirá el destinatario anterior. Se aplicará el último antecedente verificado de cada persona en este grupo; sin él, su restricción manual. El historial privado no se muestra. La viabilidad se comprobará al realizar el sorteo.'}</p>
        <button disabled={drawBlocked || busy || state.draw.completed || state.participants.length < 2} onClick={onDraw}>Realizar sorteo</button>
        {state.draw.completed && <p>Fecha del sorteo: {new Date(state.draw.completedAt).toLocaleString('es-ES')}</p>}
        <button className="secondary" disabled={busy || !state.draw.completed} onClick={onReset}>Reiniciar sorteo</button>
        {state.draw.completed && delivery && <div>
            <h3>Envío de asignaciones</h3>
            {delivery.mode === 'test' ? <p><strong>Modo PRUEBAS</strong> · Destinatario exclusivo: {delivery.testEmail ?? 'sin configurar'}. Los resultados siguientes son de prueba.</p>
                : delivery.mode === 'production' ? <p><strong>Modo PRODUCCIÓN</strong> · Destinatarios: los participantes de esta edición.</p> : <p>Modo de envío sin configurar.</p>}
            {delivery.production && delivery.test && <p>Historial independiente: producción {delivery.production.accepted} aceptados; pruebas {delivery.test.accepted} aceptados.</p>}
            <p>Mensajes pendientes o fallidos para enviar: {delivery.pending + delivery.failed}.</p>
            <p>{delivery.active || sending ? 'Envíos en curso.' : delivery.accepted === state.draw.participantCount ? 'Envíos completados: aceptados por SMTP.' : delivery.failed ? 'Hay envíos fallidos.' : delivery.uncertain ? 'Hay envíos con resultado incierto.' : 'Envíos pendientes.'}</p>
            <p>Aceptados: {delivery.accepted} · Pendientes: {delivery.pending} · Fallidos: {delivery.failed} · Inciertos: {delivery.uncertain}</p>
            <p>La aceptación por SMTP no confirma la llegada a la bandeja de entrada.</p>
            {!delivery.configured && <p role="alert">{delivery.configurationError ?? 'SMTP no está configurado. Configura las variables privadas y reinicia la aplicación.'}</p>}
            <button disabled={busy || !delivery.configured || delivery.pending + delivery.failed === 0} onClick={() => onSend()}>Enviar pendientes y fallidos</button>
            {delivery.uncertain > 0 && <>
                <p>Un envío incierto puede haber sido aceptado. Reenviarlo puede producir un duplicado.</p>
                <button disabled={busy || !delivery.configured} onClick={() => onSend(true)}>Reenviar también inciertos</button>
            </>}
        </div>}
        <button className="secondary" disabled={pending} onClick={onRefresh}>Actualizar estado</button>
    </section>;
}
