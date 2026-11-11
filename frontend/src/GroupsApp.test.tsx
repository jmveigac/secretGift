import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import type { GroupResponse, StateResponse } from './api';

const fetchMock = vi.fn<typeof fetch>();
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const path = (g: string, e: string) => `/api/groups/${g}/editions/${e}`;
const person = (id: string, name: string) => ({ id, name, email: `${name.toLowerCase()}@example.invalid`, active: true });
let a: GroupResponse, b: GroupResponse, states: Record<string, StateResponse>;
let drawRequest: (() => Promise<Response>) | undefined;
const edition = (g: string, id: string, name: string, completed = false) => ({
    edition: { id, groupId: g, name, year: 2026 },
    draw: completed ? { completed: true as const, participantCount: 2, completedAt: '2026-01-01T00:00:00Z' } : { completed: false as const, participantCount: 2 },
    delivery: { revision: 'mail', configured: true, active: false, pending: completed ? 2 : 0, accepted: 0, failed: 0, uncertain: 0 }
});
beforeEach(() => {
    a = { group: { id: 'a', name: 'Familia' }, people: [person('ana', 'Ana'), person('bea', 'Bea')], editions: [edition('a', 'e1', 'Navidad'), edition('a', 'e2', 'Verano', true)], revision: 'ga1', maxParticipants: 15, busy: false };
    b = { group: { id: 'b', name: 'Amigos' }, people: [person('cora', 'Cora')], editions: [edition('b', 'e3', 'Reunión')], revision: 'gb1', maxParticipants: 15, busy: false };
    states = {};
    for (const group of [a, b]) for (const e of group.editions) states[path(group.group.id, e.edition.id)] = {
        participants: group.people.map(({ active, ...p }) => ({ ...p, previousId: null })), maxParticipants: 15,
        draw: e.draw, delivery: e.delivery, scope: { groupId: group.group.id, editionId: e.edition.id }, revision: e.edition.id + '-rev'
    };
    drawRequest = undefined; fetchMock.mockReset();
    fetchMock.mockImplementation(async (input, init) => {
        const url = String(input), method = init?.method ?? 'GET';
        const body = init?.body ? JSON.parse(init.body as string) : {};
        if (url === '/api/groups') {
            if (method === 'POST') { b = { ...b, group: { id: 'b', name: body.name }, people: [], editions: [] }; return response(b, 201); }
            return response({ groups: [a.group, b.group] });
        }
        if (url === '/api/groups/a' || url === '/api/groups/b') {
            const g = url.endsWith('/a') ? a : b;
            if (method === 'PUT') g.group.name = body.name;
            return response(g);
        }
        if (/^\/api\/groups\/[ab]\/people/.test(url)) {
            const group = url.startsWith('/api/groups/a/') ? a : b;
            const old = group.people.find(p => url.endsWith('/' + p.id));
            if (old) Object.assign(old, { name: body.name, email: body.email, active: body.active });
            else group.people.push(person('new', body.name));
            group.revision += 'x'; return response(group);
        }
        if (url === '/api/groups/a/editions' && method === 'POST') {
            const e = edition('a', 'new' + a.editions.length, body.name);
            e.edition.year = body.year; a.editions.push(e);
            states[path('a', e.edition.id)] = { ...states[path('a', 'e1')], participants: a.people.filter(p => body.personIds.includes(p.id)).map(({ active, ...p }) => ({ ...p, previousId: null })), scope: { groupId: 'a', editionId: e.edition.id }, revision: e.edition.id + '-rev' };
            return response(a, 201);
        }
        if (url.endsWith('/draw') && method === 'POST') {
            if (drawRequest) return drawRequest();
            const state = states[url.slice(0, -5)];
            state.draw = { completed: true, participantCount: state.participants.length, completedAt: '2026-01-01T00:00:00Z' };
            state.revision += 'drawn'; return response(state);
        }
        if (method === 'GET' && states[url]) return response(states[url]);
        return response({ error: 'La edición ha cambiado. Actualiza su estado antes de continuar.' }, 409);
    });
    vi.stubGlobal('fetch', fetchMock); vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function load() {
    render(<App />); await screen.findByRole('button', { name: 'Editar a Ana' });
    await waitFor(() => expect(screen.getByLabelText('Grupo activo')).toBeEnabled());
}
const panel = () => within(screen.getByRole('region', { name: 'Edición seleccionada' }));

it('loads groups and scoped editions, keeps preview fictitious and switches without writes', async () => {
    const user = userEvent.setup(); await load();
    expect(screen.getByRole('heading', { name: 'Grupo: Familia' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Vista previa del correo' })).toHaveAttribute('href', '/mail-preview');
    expect(screen.getByRole('link', { name: 'Vista previa del correo' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText(/Uso local sin autenticación/)).toHaveTextContent('SQLite no está cifrado íntegramente');
    await user.selectOptions(screen.getByLabelText('Edición activa'), 'e2');
    await screen.findByText(/Sorteo completado/); expect(panel().getByRole('button', { name: 'Guardar participante' })).toBeDisabled();
    await waitFor(() => expect(screen.getByLabelText('Grupo activo')).toBeEnabled());
    await user.selectOptions(screen.getByLabelText('Grupo activo'), 'b');
    await screen.findByRole('heading', { name: 'Grupo: Amigos' }); await screen.findByRole('button', { name: 'Editar a Cora' });
    expect(screen.queryByText('ana@example.invalid')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Grupo activo')).toBeEnabled());
    await user.selectOptions(screen.getByLabelText('Grupo activo'), 'a'); await screen.findByRole('button', { name: 'Editar a Ana' });
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
    expect(window.confirm).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent(/"assignments"|"receiver"|"giver"/);
});
it('creates and selects a group, then renames it with confirmation', async () => {
    const user = userEvent.setup(); await load();
    await user.type(screen.getByLabelText('Nombre del nuevo grupo'), 'Trabajo');
    await user.click(screen.getByRole('button', { name: 'Crear grupo' }));
    await screen.findByRole('heading', { name: 'Grupo: Trabajo' });
    await user.clear(screen.getByLabelText('Nombre del grupo')); await user.type(screen.getByLabelText('Nombre del grupo'), 'Oficina');
    await user.click(screen.getByRole('button', { name: 'Guardar nombre del grupo' }));
    await screen.findByRole('heading', { name: 'Grupo: Oficina' });
    expect(fetchMock).toHaveBeenCalledWith('/api/groups/b', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ name: 'Oficina', expectedRevision: 'gb1' }) }));
    await user.type(screen.getByLabelText('Nombre de persona'), 'Eva'); await user.type(screen.getByLabelText('Correo de persona'), 'eva@example.invalid');
    await user.click(screen.getByRole('button', { name: 'Guardar persona' }));
    await screen.findByRole('button', { name: 'Editar contacto de Eva' });
    expect(fetchMock).toHaveBeenCalledWith('/api/groups/b/people', expect.objectContaining({ method: 'POST' }));
});
it('edits and deactivates contacts without changing the selected edition snapshot', async () => {
    const user = userEvent.setup(); await load();
    await user.click(screen.getByRole('button', { name: 'Editar contacto de Ana' }));
    await user.clear(screen.getByLabelText('Nombre de persona')); await user.type(screen.getByLabelText('Nombre de persona'), 'Ana actual');
    await user.click(screen.getByRole('button', { name: 'Guardar persona' }));
    await screen.findByRole('button', { name: 'Editar contacto de Ana actual' });
    expect(panel().getByRole('button', { name: 'Editar a Ana' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Desactivar a Ana actual' }));
    await screen.findByRole('button', { name: 'Activar a Ana actual' });
    expect(screen.queryByRole('checkbox', { name: /Ana actual/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Activar a Ana actual' }));
    await screen.findByRole('checkbox', { name: /Ana actual/ });
    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT');
    expect(writes).toHaveLength(3); expect(writes.every(([url]) => String(url) === '/api/groups/a/people/ana')).toBe(true);
    expect(JSON.parse(writes[0][1]!.body as string)).not.toHaveProperty('id');
});
it('selects active people and creates two distinct editions in the same year', async () => {
    const user = userEvent.setup(); await load();
    for (const name of ['Primavera', 'Otoño']) {
        await user.type(screen.getByLabelText('Nombre de la nueva edición'), name);
        await user.clear(screen.getByLabelText('Año de referencia')); await user.type(screen.getByLabelText('Año de referencia'), '2026');
        await user.click(screen.getByRole('checkbox', { name: /Ana ·/ }));
        await user.click(screen.getByRole('button', { name: 'Crear edición' }));
        await screen.findByRole('heading', { name: `Edición: ${name} · 2026` });
        await waitFor(() => expect(screen.getByLabelText('Edición activa')).toBeEnabled());
        expect(panel().getByText('1 / 15 participantes')).toBeInTheDocument();
    }
    const requests = fetchMock.mock.calls.filter(([url, init]) => url === '/api/groups/a/editions' && init?.method === 'POST');
    expect(requests).toHaveLength(2);
    expect(JSON.parse(requests[0][1]!.body as string)).toEqual(expect.objectContaining({ name: 'Primavera', year: 2026, personIds: ['ana'], expectedRevision: 'ga1' }));
});
it('binds a draw to the displayed edition and blocks selection while its request is pending', async () => {
    const user = userEvent.setup(); await load(); let finish!: (response: Response) => void;
    drawRequest = () => new Promise(resolve => { finish = resolve; });
    await user.click(screen.getByRole('button', { name: 'Realizar sorteo' }));
    expect(screen.getByLabelText('Grupo activo')).toBeDisabled(); expect(screen.getByLabelText('Edición activa')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Grupo activo'), { target: { value: 'b' } });
    fireEvent.change(screen.getByLabelText('Edición activa'), { target: { value: 'e2' } });
    expect(fetchMock).toHaveBeenCalledWith(path('a', 'e1') + '/draw', expect.objectContaining({ method: 'POST', body: JSON.stringify({ confirm: true, expectedRevision: 'e1-rev' }) }));
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/groups/b')).toBe(false);
    finish(response({ ...states[path('a', 'e1')], draw: { completed: true, participantCount: 2, completedAt: '2026-01-01T00:00:00Z' } }));
    await screen.findByText(/Sorteo completado/);
    expect(screen.getByRole('heading', { name: 'Edición: Navidad · 2026' })).toBeInTheDocument();
});
it('keeps the form after a stale rejection and permits refreshing an undrawn edition', async () => {
    const user = userEvent.setup(); await load();
    await user.type(panel().getByLabelText('Nombre'), 'Eva'); await user.type(panel().getByLabelText('Correo'), 'eva@example.invalid');
    await user.click(panel().getByRole('button', { name: 'Guardar participante' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La edición ha cambiado');
    expect(panel().getByLabelText('Nombre')).toHaveValue('Eva');
    await user.click(screen.getByRole('button', { name: 'Actualizar estado' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith('/api/groups/a', expect.objectContaining({ method: 'GET' }));
});
it('includes an existing active identity in an undrawn edition without creating another contact', async () => {
    a.people.push(person('cora', 'Cora'));
    const handler = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
        if (String(input) === path('a', 'e1') + '/participants' && init?.method === 'POST') {
            const state = states[path('a', 'e1')];
            state.participants.push({ id: 'cora', name: 'Cora', email: 'cora@example.invalid', previousId: null });
            state.revision += 'changed'; return response(state, 201);
        }
        return handler(input, init);
    });
    const user = userEvent.setup(); await load();
    await user.selectOptions(screen.getByLabelText('Añadir persona activa del grupo a esta edición'), 'cora');
    await user.click(screen.getByRole('button', { name: 'Incluir persona en la edición' }));
    await waitFor(() => expect(panel().getByRole('button', { name: 'Editar a Cora' })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(path('a', 'e1') + '/participants', expect.objectContaining({ method: 'POST', body: JSON.stringify({ personId: 'cora', expectedGroupRevision: 'ga1', expectedRevision: 'e1-rev' }) }));
    expect(a.people).toHaveLength(3);
});
it('distinguishes existing historical editions with identical names and years without rewriting them', async () => {
    a.editions[1].edition.name = 'Navidad';
    const user = userEvent.setup(); await load();
    expect(screen.getByRole('heading', { name: 'Edición: Navidad · 2026 · n.º 1' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Navidad · 2026 · n.º 2 · Sorteada' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Edición activa'), 'e2');
    await screen.findByRole('heading', { name: 'Edición: Navidad · 2026 · n.º 2' });
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
});
