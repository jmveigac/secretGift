import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import DrawWizard from './DrawWizard';
import type { GroupResponse, StateResponse, EditionSummary } from './api';
const fetchMock = vi.fn<typeof fetch>();
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const p = (id: string, name: string) => ({ id, name, email: `${name.toLowerCase()}@example.invalid`, active: true });
const delivery = { revision: 'mail', configured: true, mode: 'test' as const, testEmail: 'test@example.invalid', active: false, pending: 2, accepted: 0, failed: 0, uncertain: 0 };
const schedule = { localDateTime: '2026-12-24T20:00', timeZone: 'Europe/Madrid', eventAt: '2026-12-24T19:00:00.000Z', revealAt: '2026-12-24T19:00:00.000Z' };
let group: GroupResponse, state: StateResponse, createStatus: number;
const base = '/api/groups/g/editions/e';
function summary(id = 'e', name = 'Navidad'): EditionSummary { return { edition: { id, groupId: 'g', name, year: 2026, schedule }, draw: { completed: true, participantCount: 2, completedAt: '2026-01-01T00:00:00Z' }, delivery, results: { available: false, reason: 'scheduled' } }; }
beforeEach(() => {
    group = { group: { id: 'g', name: 'Familia' }, people: [p('ana', 'Ana'), p('bea', 'Bea')], editions: [summary()], revision: 'group-rev', maxParticipants: 15, busy: false };
    state = { scope: { groupId: 'g', editionId: 'e' }, revision: 'edition-rev', participants: group.people.map(person => ({ ...person, previousId: null })), draw: group.editions[0].draw, maxParticipants: 15, delivery: { ...delivery }, schedule, results: { available: false, reason: 'scheduled' }, campaigns: [] };
    createStatus = 201; fetchMock.mockReset();
    fetchMock.mockImplementation(async (input, init) => {
        const url = String(input), body = init?.body ? JSON.parse(init.body as string) : {};
        if (url === '/api/groups') {
            if (init?.method === 'POST') { group = { ...group, group: { id: 'g', name: body.name }, people: [], editions: [] }; return response(group, 201); }
            return response({ groups: [group.group] });
        }
        if (url === '/api/groups/g') { if (init?.method === 'PUT') { group.group.name = body.name; group.revision += 'x'; } return response(group); }
        if (url.startsWith('/api/groups/g/people')) {
            const existing = group.people.find(p => url.endsWith('/' + p.id));
            if (existing) Object.assign(existing, body); else group.people.push(p('new', body.name)); group.revision += 'x'; return response(group);
        }
        if (url === '/api/groups/g/preview') return response({ viable: true, schedule, restrictions: body.personIds.map((id: string) => ({ personId: id, source: body.previousIds?.[id] ? 'manual' : 'none', previousId: body.previousIds?.[id] })) });
        if (url === '/api/groups/g/editions' && init?.method === 'POST') {
            if (createStatus !== 201) return response({ error: 'La fecha es ambigua. Elige otra hora.' }, createStatus);
            group.editions.push(summary('new', body.name)); return response(group, 201);
        }
        if (url === base + '/results') return state.results?.available ? response({ assignments: [{ giver: { id: 'ana', name: 'Ana' }, receiver: { id: 'bea', name: 'Bea' } }] }) : response({ error: 'Asignaciones ocultas' }, 403);
        if (url.endsWith('/reminders') && init?.method === 'POST') { state.campaigns = [{ id: 'c', createdAt: '2026-01-01T00:00:00Z', revision: 'campaign', mode: 'test', pending: 0, accepted: 2, failed: 0, uncertain: 0 }]; return response(state); }
        if (url.endsWith('/draw/send')) { state.delivery = { ...delivery, accepted: 2, pending: 0 }; return response(state); }
        if ((url === base || url.endsWith('/new')) && init?.method === 'GET') return response(state);
        return response({ error: 'La edición ha cambiado' }, 409);
    });
    vi.stubGlobal('fetch', fetchMock); vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function load() { render(<App />); await screen.findByRole('button', { name: /Familia.*Abrir grupo/ }); }
async function open() { const user = userEvent.setup(); await load(); await user.click(screen.getByRole('button', { name: /Familia.*Abrir grupo/ })); await screen.findByRole('heading', { name: 'Familia' }); return user; }
const button = (name: string) => screen.getByRole('button', { name });

it('keeps the header limited to the centered brand and navigates compact views without writes', async () => {
    const user = await open();
    expect(screen.getByRole('banner')).toHaveTextContent(/^secretGift$/);
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    for (const name of ['Mis grupos', 'Nuevo sorteo', 'Recordar sorteo', 'Repetir sorteo']) expect(within(nav).getByRole('button', { name })).toBeInTheDocument();
    expect(screen.queryByLabelText('Nombre de persona')).not.toBeInTheDocument();
    await user.click(button('Participantes')); expect(screen.getByLabelText('Nombre de persona')).toBeInTheDocument();
    await user.click(button('Sorteos')); expect(screen.queryByLabelText('Nombre de persona')).not.toBeInTheDocument();
    await user.click(screen.getByText('Ayuda y herramientas'));
    expect(screen.getByRole('link', { name: 'Vista previa del correo' })).toHaveAttribute('href', '/mail-preview');
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
});
it('creates groups and edits contacts without altering historical snapshots', async () => {
    const user = await open(); const snapshot = structuredClone(state.participants);
    await user.click(button('Participantes')); await user.click(button('Editar contacto de Ana'));
    const name = screen.getByLabelText('Nombre de persona'); await user.clear(name); await user.type(name, 'Ana nueva'); await user.click(button('Guardar persona'));
    await screen.findByRole('button', { name: 'Editar contacto de Ana nueva' }); expect(state.participants).toEqual(snapshot);
    await user.click(button('Desactivar a Ana nueva')); await screen.findByRole('button', { name: 'Activar a Ana nueva' }); expect(state.participants).toEqual(snapshot);
    await user.click(button('Ajustes')); await user.clear(screen.getByLabelText('Nombre')); await user.type(screen.getByLabelText('Nombre'), 'Amistad'); await user.click(button('Guardar nombre'));
    await screen.findByRole('heading', { name: 'Amistad' });
    await user.click(button('Mis grupos')); await user.click(screen.getByText('Crear grupo', { selector: 'summary' })); await user.type(screen.getByLabelText('Nombre del grupo'), 'Trabajo'); await user.click(button('Guardar grupo'));
    await screen.findByRole('heading', { name: 'Trabajo' }); expect(group.editions).toHaveLength(0);
});
it('hides results until the server enables them; changing browser time grants no access', async () => {
    const user = await open(); await user.click(button('Abrir Navidad')); await screen.findByRole('heading', { name: 'Asignaciones ocultas' });
    expect(screen.queryByRole('button', { name: 'Ver resultados' })).not.toBeInTheDocument();
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2099-01-01T00:00:00Z'));
    await user.click(button('Actualizar estado')); await waitFor(() => expect(button('Actualizar estado')).toBeEnabled());
    expect(screen.queryByRole('button', { name: 'Ver resultados' })).not.toBeInTheDocument();
    state.results = { available: true, reason: 'scheduled' }; await user.click(button('Actualizar estado')); await screen.findByRole('button', { name: 'Ver resultados' });
    await user.click(button('Ver resultados')); expect(await screen.findByRole('table')).toHaveTextContent('Ana');
});
it('recalls all original assignments with the effective mailbox and campaign-specific results', async () => {
    const user = await open(); await user.click(button('Recordar sorteo')); await user.selectOptions(screen.getByLabelText('Sorteo confirmado'), 'e');
    await screen.findByRole('button', { name: 'Enviar recordatorio a todos' });
    await user.click(button('Enviar recordatorio a todos'));
    expect(window.confirm).toHaveBeenLastCalledWith(expect.stringMatching(/todos.*Navidad.*2 mensajes.*test@example.invalid/));
    await screen.findByRole('heading', { name: 'Recordatorio 1 · Pruebas' });
    expect(fetchMock).toHaveBeenCalledWith(base + '/reminders', expect.objectContaining({ method: 'POST', body: JSON.stringify({ confirm: true, drawId: '2026-01-01T00:00:00Z', expectedRevision: 'edition-rev', revision: 'mail', retryUncertain: false }) }));
});
it('repeat proposes a new edition and the previous participants instead of resending', async () => {
    const user = await open(); await user.click(button('Repetir sorteo')); await user.selectOptions(screen.getByLabelText('Sorteo confirmado'), 'e'); await user.click(button('Preparar nuevo sorteo'));
    await screen.findByRole('heading', { name: 'Grupo' }); expect(screen.getByLabelText('Grupo del sorteo')).toBeDisabled();
    await user.click(button('Continuar')); expect(screen.getByText('2 participantes seleccionados · máximo 15')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('/reminders') && init?.method === 'POST')).toBe(false);
});
async function wizardReview() {
    const user = userEvent.setup();
    render(<DrawWizard groups={[group.group]} initialGroup={group} onBusy={() => {}} onGroupsChanged={async () => {}} onDone={() => {}} />);
    await user.click(button('Continuar')); await user.click(button('Continuar'));
    await user.selectOptions(screen.getByLabelText('Ana regaló a'), 'bea');
    await user.click(button('Comprobar antecedentes')); await screen.findByLabelText('Título del sorteo');
    await user.type(screen.getByLabelText('Título del sorteo'), 'Cena');
    fireEvent.change(screen.getByLabelText('Fecha del evento'), { target: { value: '2026-12-24' } });
    expect(screen.getByLabelText('Zona horaria')).toHaveValue('Europe/Madrid');
    await user.click(button('Revisar sorteo')); await screen.findByRole('heading', { name: 'Revisión' }); return user;
}
it('guides group, participants, partial manual history, date and review; confirms atomically without sending', async () => {
    const user = await wizardReview(); expect(screen.getByText('Cena')).toBeInTheDocument(); expect(document.body).not.toHaveTextContent(/receiver|assignments|giver/);
    await user.click(button('Confirmar sorteo')); await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/groups/g/editions')).toBe(true));
    const payload = JSON.parse(fetchMock.mock.calls.find(([url]) => url === '/api/groups/g/editions')![1]!.body as string);
    expect(payload).toEqual(expect.objectContaining({ name: 'Cena', confirmDraw: true, personIds: ['ana', 'bea'], previousIds: { ana: 'bea' }, schedule: { localDateTime: '2026-12-24T20:00', timeZone: 'Europe/Madrid' }, expectedRevision: 'group-rev' }));
    expect(fetchMock.mock.calls.some(([url]) => /send|reminders/.test(String(url)))).toBe(false);
});
it('preserves wizard data after validation failure and supports returning to previous steps', async () => {
    const user = await wizardReview(); createStatus = 400; await user.click(button('Confirmar sorteo'));
    expect(await screen.findByRole('alert')).toHaveTextContent('La fecha es ambigua');
    await user.click(button('Anterior')); expect(screen.getByLabelText('Título del sorteo')).toHaveValue('Cena'); expect(screen.getByLabelText('Fecha del evento')).toHaveValue('2026-12-24');
});
it('disables navigation and duplicate submissions during a reminder request and surfaces HTTP rejection', async () => {
    const user = await open(); await user.click(button('Abrir Navidad')); await screen.findByRole('button', { name: 'Enviar recordatorio a todos' });
    let finish!: (value: Response) => void; fetchMock.mockReturnValueOnce(new Promise(r => { finish = r; }));
    fireEvent.click(button('Enviar recordatorio a todos')); fireEvent.click(button('Enviar recordatorio a todos'));
    expect(window.confirm).toHaveBeenCalledTimes(1); expect(button('Mis grupos')).toBeDisabled();
    finish(response({ error: 'Hay otra operación en curso.' }, 409)); expect(await screen.findByRole('alert')).toHaveTextContent('Hay otra operación en curso.');
    await waitFor(() => expect(button('Mis grupos')).toBeEnabled());
    expect(screen.queryByText(/Todos los mensajes de esta solicitud/)).not.toBeInTheDocument();
});
it('shows empty and loading error states with a retry control', async () => {
    fetchMock.mockResolvedValueOnce(response({ groups: [] })); render(<App />); await screen.findByText(/No hay grupos todavía/);
    fetchMock.mockRejectedValueOnce(new Error('network')); await userEvent.click(button('Actualizar grupos')); expect(await screen.findByRole('alert')).toHaveTextContent('network');
});
it('keeps participant controls labelled and keyboard accessible at a mobile viewport', async () => {
    vi.stubGlobal('innerWidth', 375);
    const user = await open(); await user.click(button('Nuevo sorteo')); await user.click(button('Continuar'));
    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toHaveAccessibleName();
    await user.tab(); expect(screen.getAllByRole('checkbox')[0]).toHaveFocus();
});

it('validates participant count before requesting a preview and never offers self-relations', async () => {
    const user = userEvent.setup(); render(<DrawWizard groups={[group.group]} initialGroup={group} onBusy={() => {}} onGroupsChanged={async () => {}} onDone={() => {}} />);
    await user.click(button('Continuar')); await user.click(screen.getByRole('checkbox', { name: /Bea/ })); await user.click(button('Continuar'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Selecciona entre 2 y 15'); expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('checkbox', { name: /Bea/ })); await user.click(button('Continuar'));
    expect(within(screen.getByLabelText('Ana regaló a')).queryByRole('option', { name: 'Ana' })).not.toBeInTheDocument();
});
it('does not confirm or duplicate a wizard submission while the first is in progress', async () => {
    await wizardReview(); let finish!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    fireEvent.click(button('Confirmar sorteo')); fireEvent.click(button('Confirmar sorteo'));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/groups/g/editions')).toHaveLength(1);
    finish(response({ error: 'El grupo ha cambiado. Actualiza antes de continuar.' }, 409));
    expect(await screen.findByRole('alert')).toHaveTextContent('El grupo ha cambiado');
    await userEvent.click(button('Actualizar grupo y revisar'));
    await screen.findByRole('heading', { name: 'Participantes' });
});
it('shows an HTTP 503 rejection and never reports global success for partial deliveries', async () => {
    const user = await open(); await user.click(button('Abrir Navidad')); await screen.findByRole('button', { name: 'Enviar 2 notificaciones' });
    fetchMock.mockResolvedValueOnce(response({ error: 'No se pudo acceder al almacenamiento local.' }, 503));
    await user.click(button('Enviar 2 notificaciones')); expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo acceder al almacenamiento local.');
    expect(screen.queryByText(/Todos los mensajes de esta solicitud/)).not.toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(response({ ...state, delivery: { ...delivery, pending: 0, accepted: 1, failed: 1 } }));
    await user.click(button('Enviar 2 notificaciones')); expect(await screen.findByText(/Solicitud procesada con entregas pendientes/)).toBeInTheDocument();
    expect(screen.queryByText(/Todos los mensajes de esta solicitud/)).not.toBeInTheDocument();
});
it('makes production recipients explicit and blocks configuration errors without confirmation', async () => {
    state.delivery = { ...delivery, mode: 'production', testEmail: undefined }; const user = await open();
    await user.click(button('Abrir Navidad')); await screen.findByRole('button', { name: 'Enviar 2 notificaciones' });
    vi.mocked(window.confirm).mockReturnValueOnce(false); await user.click(button('Enviar 2 notificaciones'));
    expect(window.confirm).toHaveBeenLastCalledWith(expect.stringMatching(/2 mensajes.*PRODUCCIÓN: a los participantes/));
    state.delivery = { ...delivery, configured: false, configurationError: 'Configura APP_MODE explícitamente.' };
    await user.click(button('Actualizar estado')); expect(await screen.findByRole('alert')).toHaveTextContent('Configura APP_MODE');
    expect(button('Enviar 2 notificaciones')).toBeDisabled(); expect(button('Enviar recordatorio a todos')).toBeDisabled();
});

it('keeps the wizard selection when leaving is cancelled and leaves only after confirmation', async () => {
    const user = await open();
    await user.click(button('Nuevo sorteo'));
    await user.click(button('Continuar'));
    await user.click(screen.getByRole('checkbox', { name: /Bea/ }));
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await user.click(button('Mis grupos'));
    expect(screen.getByRole('checkbox', { name: /Bea/ })).not.toBeChecked();
    expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining('Los datos de este asistente no se guardarán'));
    await user.click(button('Mis grupos'));
    await screen.findByRole('button', { name: /Familia.*Abrir grupo/ });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
});

it('moves focus to the contact form when editing a person', async () => {
    const user = await open();
    await user.click(button('Participantes'));
    await user.click(button('Editar contacto de Ana'));
    expect(screen.getByLabelText('Nombre de persona')).toHaveFocus();
    expect(screen.getByLabelText('Nombre de persona')).toHaveValue('Ana');
});
