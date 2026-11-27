import { useEffect } from 'react';
import { editionApi, type EditionScope, type StateResponse } from './api';

export function useMailProgress(
    scope: EditionScope | undefined, state: StateResponse | null | undefined,
    update: (state: StateResponse) => void, onError: (message: string) => void,
) {
    const active = state?.delivery?.active;
    const groupId = scope?.groupId, editionId = scope?.editionId;
    useEffect(() => {
        if (!active) return;
        const controller = new AbortController();
        let stopped = false;
        let timer: ReturnType<typeof setTimeout>;
        const api = editionApi(groupId && editionId ? { groupId, editionId } : undefined);
        async function poll() {
            try {
                const next = await api.state(controller.signal);
                if (stopped) return;
                onError('');
                update(next);
                if (!next.delivery?.active) return;
            } catch {
                if (stopped) return;
                onError('No se pudo consultar el progreso. Volveremos a intentarlo.');
            }
            timer = setTimeout(poll, 1500);
        }
        timer = setTimeout(poll, 1500);
        return () => { stopped = true; clearTimeout(timer); controller.abort(); };
    }, [active, groupId, editionId, update, onError]);
}

export default function MailProgress({ state }: { state: StateResponse }) {
    const operation = state.mailOperation;
    const delivery = state.delivery;
    if (!operation || !delivery) return null;
    if (operation.mode !== (delivery.mode ?? 'production')) {
        return delivery.active ? <p role="status">Hay un envío en curso en otro modo para esta edición.</p> : null;
    }
    const counts = operation.campaignId ? state.campaigns?.find(c => c.id === operation.campaignId) : delivery;
    if (!counts) return null;
    const title = {
        initial: 'Envío de asignaciones',
        reminder: 'Envío de recordatorio',
        retryInitial: 'Reintento de asignaciones',
        retryReminder: 'Reintento de recordatorio',
    }[operation.kind];
    const status = {
        running: 'En curso. Los mensajes se procesan de uno en uno.',
        finished: 'Operación finalizada. Revisa el resultado de los mensajes.',
        limited: 'El servidor SMTP limitó la frecuencia. La operación se detuvo.',
        interrupted: 'Operación interrumpida. Revisa los estados antes de continuar.',
    }[operation.status];
    return <div className="mail-progress">
        <p role="status"><strong>{title}</strong> · {status}</p>
        <label>{operation.processed} de {operation.total} mensajes procesados
            <progress max={Math.max(operation.total, 1)} value={operation.total ? operation.processed : 1} />
        </label>
        <p>Aceptados por SMTP: {counts.accepted} · Pendientes: {counts.pending} · Rechazados: {counts.failed} · Inciertos: {counts.uncertain}</p>
    </div>;
}
