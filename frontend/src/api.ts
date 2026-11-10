import type { ParticipantInput, StateResponse } from '../../src/web/contracts';
export type { Participant, ParticipantInput, StateResponse } from '../../src/web/contracts';

async function request(path: string, method = 'GET', body?: unknown): Promise<StateResponse> {
    const response = await fetch(path, {
        method,
        cache: 'no-store',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'No se pudo completar la operación.');
    return data as StateResponse;
}

export const api = {
    state: () => request('/api/state'),
    save: (participant: ParticipantInput, id?: string) =>
        request(`/api/participants${id ? `/${id}` : ''}`, id ? 'PUT' : 'POST', participant),
    remove: (id: string) => request(`/api/participants/${id}`, 'DELETE', {}),
    draw: () => request('/api/draw', 'POST', { confirm: true }),
    send: (drawId: string, revision: string, retryUncertain = false) => request('/api/draw/send', 'POST', { confirm: true, drawId, revision, retryUncertain }),
    reset: () => request('/api/draw/reset', 'POST', { confirm: true }),
};
