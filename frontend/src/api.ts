import type { ParticipantInput, StateResponse, Group, GroupResponse, EditionScope } from '../../src/web/contracts';
export type { Participant, ParticipantInput, StateResponse, Group, GroupResponse, Person, EditionScope } from '../../src/web/contracts';

async function request<T = StateResponse>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetch(path, {
        method,
        cache: 'no-store',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'No se pudo completar la operación.');
    return data as T;
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

export const groupsApi = {
    list: () => request<{ groups: Group[] }>('/api/groups'),
    get: (id: string) => request<GroupResponse>(`/api/groups/${id}`),
    create: (name: string) => request<GroupResponse>('/api/groups', 'POST', { name }),
    rename: (group: GroupResponse, name: string) => request<GroupResponse>(`/api/groups/${group.group.id}`, 'PUT', { name, expectedRevision: group.revision }),
    person: (group: GroupResponse, person: { name: string; email: string; active: boolean }, id?: string) =>
        request<GroupResponse>(`/api/groups/${group.group.id}/people${id ? `/${id}` : ''}`, id ? 'PUT' : 'POST', { name: person.name, email: person.email, active: person.active, expectedRevision: group.revision }),
    edition: (group: GroupResponse, name: string, year: number, personIds: string[]) =>
        request<GroupResponse>(`/api/groups/${group.group.id}/editions`, 'POST', { name, year, personIds, expectedRevision: group.revision }),
};
export function editionApi(scope?: EditionScope, expectedRevision?: string, expectedGroupRevision?: string) {
    if (!scope) return { ...api, addPerson: (_id: string): Promise<StateResponse> => Promise.reject(new Error('Selecciona una edición.')) };
    const base = `/api/groups/${scope.groupId}/editions/${scope.editionId}`;
    const write = (path: string, method: string, body: object) => request(base + path, method, { ...body, expectedRevision });
    return {
        state: () => request(base),
        addPerson: (personId: string) => write('/participants', 'POST', { personId, expectedGroupRevision }),
        save: (participant: ParticipantInput, id?: string) => write(`/participants${id ? `/${id}` : ''}`, id ? 'PUT' : 'POST', participant),
        remove: (id: string) => write(`/participants/${id}`, 'DELETE', {}),
        draw: () => write('/draw', 'POST', { confirm: true }),
        send: (drawId: string, revision: string, retryUncertain = false) => write('/draw/send', 'POST', { confirm: true, drawId, revision, retryUncertain }),
        reset: () => write('/draw/reset', 'POST', { confirm: true }),
    };
}
