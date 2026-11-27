import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    history.replaceState(null, '', '/');
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
async function load() { render(<App />); await screen.findByRole('button', { name: 'Sorteos del grupo' }); }
async function open() { const user = userEvent.setup(); await load(); await user.click(screen.getByRole('button', { name: 'Sorteos del grupo' })); await screen.findByRole('heading', { name: 'Familia' }); return user; }
const button = (name: string) => screen.getByRole('button', { name });
const link = (name: string) => screen.getByRole('link', { name });

it('keeps the header limited to the centered brand and navigates compact views without writes', async () => {
    const user = await open();
    expect(screen.getByRole('banner')).toHaveTextContent(/^secretGift$/);
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    for (const name of ['Grupos', 'Sorteos', 'Ayuda y herramientas']) expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
    expect(screen.queryByLabelText('Nombre de persona')).not.toBeInTheDocument();
    await user.click(button('Participantes')); await user.click(button('Añadir persona')); expect(screen.getByLabelText('Nombre de persona')).toBeInTheDocument();
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
    await user.click(screen.getByText('Acciones del grupo')); await user.click(button('Cambiar nombre')); await user.clear(screen.getByLabelText('Nombre del grupo')); await user.type(screen.getByLabelText('Nombre del grupo'), 'Amistad'); await user.click(button('Guardar nombre'));
    await screen.findByRole('heading', { name: 'Amistad' });
    await user.click(link('Grupos')); await user.click(button('Crear grupo')); await user.type(screen.getByLabelText('Nombre del grupo'), 'Trabajo'); await user.click(button('Guardar grupo'));
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
    const user = await open(); await user.click(button('Abrir Navidad')); await screen.findByRole('button', { name: 'Recordar sorteo' });
    await screen.findByRole('button', { name: 'Enviar recordatorio a todos' });
    await user.click(button('Enviar recordatorio a todos'));
    expect(window.confirm).toHaveBeenLastCalledWith(expect.stringMatching(/todos.*Navidad.*2 mensajes.*test@example.invalid/));
    await screen.findByRole('heading', { name: 'Recordatorio 1 · Pruebas' });
    expect(fetchMock).toHaveBeenCalledWith(base + '/reminders', expect.objectContaining({ method: 'POST', body: JSON.stringify({ confirm: true, drawId: '2026-01-01T00:00:00Z', expectedRevision: 'edition-rev', revision: 'mail', retryUncertain: false }) }));
});
it('repeat proposes a new edition and the previous participants instead of resending', async () => {
    const user = await open(); await user.click(button('Abrir Navidad')); await user.click(await screen.findByRole('button', { name: 'Repetir sorteo' }));
    await screen.findByRole('heading', { name: 'Participantes' }); expect(screen.queryByLabelText('Grupo del sorteo')).not.toBeInTheDocument(); expect(screen.getByText('2 participantes seleccionados · máximo 15')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('/reminders') && init?.method === 'POST')).toBe(false);
});
async function wizardReview() {
    const user = userEvent.setup();
    render(<DrawWizard groups={[group.group]} initialGroup={group} onBusy={() => {}} onGroupsChanged={async () => {}} onDone={() => {}} />);
    await user.click(button('Continuar')); await user.click(screen.getByText('Antecedentes manuales (opcional)'));
    await user.selectOptions(screen.getByLabelText('Ana regaló a'), 'bea');
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
    expect(window.confirm).toHaveBeenCalledTimes(1); await user.click(link('Grupos')); expect(screen.getByRole('heading', { name: 'Navidad' })).toBeInTheDocument();
    finish(response({ error: 'Hay otra operación en curso.' }, 409)); expect(await screen.findByRole('alert')).toHaveTextContent('Hay otra operación en curso.');
    await user.click(link('Grupos')); await screen.findByRole('heading', { name: 'Grupos' });
    expect(screen.queryByText(/Todos los mensajes de esta solicitud/)).not.toBeInTheDocument();
});
it('shows empty and loading error states with a retry control', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network')); render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar');
    fetchMock.mockResolvedValueOnce(response({ groups: [] })); await userEvent.click(button('Volver a intentar'));
    expect(await screen.findByText(/Crea tu primer grupo/)).toBeInTheDocument();
});
it('keeps participant controls labelled and keyboard accessible at a mobile viewport', async () => {
    vi.stubGlobal('innerWidth', 375);
    const user = await open(); await user.click(button('Nuevo sorteo'));
    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toHaveAccessibleName();
    await user.tab(); expect(screen.getAllByRole('checkbox')[0]).toHaveFocus();
});

it('validates participant count before requesting a preview and never offers self-relations', async () => {
    const user = userEvent.setup(); render(<DrawWizard groups={[group.group]} initialGroup={group} onBusy={() => {}} onGroupsChanged={async () => {}} onDone={() => {}} />);
    await user.click(screen.getByRole('checkbox', { name: /Bea/ })); await user.click(button('Continuar'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Selecciona entre 2 y 15'); expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('checkbox', { name: /Bea/ })); await user.click(button('Continuar'));
    await user.click(screen.getByText('Antecedentes manuales (opcional)'));
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
    fetchMock.mockResolvedValueOnce(response({ ...state, delivery: { ...delivery, pending: 0, accepted: 1, failed: 1 }, mailOperation: { id: 'test-operation', kind: 'initial', mode: 'test', status: 'finished', total: 2, processed: 2 } }));
    await user.click(button('Enviar 2 notificaciones')); expect(await screen.findByText(/Operación finalizada/)).toBeInTheDocument();
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
    await user.click(screen.getByRole('checkbox', { name: /Bea/ }));
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await user.click(link('Grupos'));
    expect(screen.getByRole('checkbox', { name: /Bea/ })).not.toBeChecked();
    expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining('Los datos sin guardar se perderán'));
    await user.click(link('Grupos'));
    await screen.findByRole('button', { name: 'Sorteos del grupo' });
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

describe('eliminación de grupos', () => {
    const deletion = { name: 'Álbum & Fiesta', people: 2, editions: 1, campaigns: 3, revision: 'delete-rev' };
    const deletionRequests = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE');

    beforeEach(() => {
        Object.defineProperties(HTMLDialogElement.prototype, {
            showModal: { configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', ''); } },
            close: { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute('open'); } },
        });
    });
    afterEach(() => {
        Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
        Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
    });

    async function start(user: ReturnType<typeof userEvent.setup>) {
        fetchMock.mockResolvedValueOnce(response(deletion));
        await user.click(button('Eliminar grupo'));
        return screen.findByRole('dialog');
    }

    it('muestra los contadores y permite cancelar ambas confirmaciones con foco accesible', async () => {
        const user = userEvent.setup(); await load();
        await user.click(screen.getByText('Acciones del grupo'));
        let dialog = await start(user);
        expect(dialog).toHaveTextContent('Álbum & Fiesta');
        expect(dialog).toHaveTextContent('Personas registradas: 2');
        expect(dialog).toHaveTextContent('Ediciones: 1');
        expect(dialog).toHaveTextContent('Campañas de recordatorios: 3');
        expect(dialog).toHaveTextContent('los correos ya enviados no se pueden retirar');
        expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(button('Eliminar grupo')).toHaveFocus();
        dialog = await start(user);
        await user.click(within(dialog).getByRole('button', { name: 'Continuar' }));
        expect(screen.getByLabelText('Escribe el nombre exacto del grupo')).toHaveFocus();
        expect(button('Eliminar definitivamente')).toBeDisabled();
        fireEvent(dialog, new Event('cancel', { cancelable: true }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(deletionRequests()).toHaveLength(0);
    });

    it('valida el nombre, envía una sola petición y actualiza la lista y los selectores', async () => {
        const user = userEvent.setup(); await load();
        await user.click(screen.getByText('Acciones del grupo'));
        await start(user);
        await user.click(button('Continuar'));
        const input = screen.getByLabelText('Escribe el nombre exacto del grupo');
        const remove = button('Eliminar definitivamente');
        await user.type(input, 'álbum & Fiesta');
        expect(remove).toBeDisabled();
        await user.clear(input);
        await user.type(input, ' Álbum   & Fiesta ');
        expect(remove).toBeEnabled();
        let complete!: (value: Response) => void;
        fetchMock.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
        fireEvent.click(remove); fireEvent.click(remove);
        expect(deletionRequests()).toHaveLength(1);
        expect(deletionRequests()[0][0]).toBe('/api/groups/g');
        expect(JSON.parse(deletionRequests()[0][1]!.body as string)).toEqual({
            expectedRevision: deletion.revision, confirmationName: ' Álbum   & Fiesta ',
        });
        complete(response({ groups: [{ id: 'h', name: 'Otro grupo' }] }));
        expect(await screen.findByText('Grupo eliminado definitivamente.')).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Familia' })).not.toBeInTheDocument();
        await user.click(link('Sorteos')); await user.click(button('Nuevo sorteo'));
        expect(await screen.findByRole('option', { name: 'Otro grupo' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'Familia' })).not.toBeInTheDocument();
    });

    it('mantiene el diálogo ante un error y vuelve al estado vacío tras eliminar el último grupo', async () => {
        const user = userEvent.setup(); await load();
        await user.click(screen.getByText('Acciones del grupo'));
        await start(user);
        await user.click(button('Continuar'));
        await user.type(screen.getByLabelText('Escribe el nombre exacto del grupo'), deletion.name);
        fetchMock.mockResolvedValueOnce(response({ error: 'El grupo ha cambiado. Vuelve a revisar la eliminación.' }, 409));
        await user.click(button('Eliminar definitivamente'));
        expect(await screen.findByRole('alert')).toHaveTextContent('El grupo ha cambiado');
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        await user.click(button('Cancelar'));
        await start(user);
        await user.click(button('Continuar'));
        await user.type(screen.getByLabelText('Escribe el nombre exacto del grupo'), deletion.name);
        fetchMock.mockResolvedValueOnce(response({ groups: [] }));
        await user.click(button('Eliminar definitivamente'));
        expect(await screen.findByText(/Crea tu primer grupo/)).toBeInTheDocument();
        expect(button('Crear grupo')).toBeVisible();
        expect(fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
    });
});

it('opens the global edition list, restores the detail after remounting and handles browser history', async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await screen.findByRole('button', { name: 'Sorteos del grupo' });
    await user.click(link('Sorteos'));
    await user.click(button('Abrir Navidad'));
    await screen.findByRole('heading', { name: 'Navidad' });
    expect(location.search).toBe('?view=draws&group=g&edition=e');
    first.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Navidad' });
    history.replaceState({ secretGiftIndex: 1 }, '', '?view=draws');
    fireEvent(window, new PopStateEvent('popstate', { state: history.state }));
    await screen.findByRole('heading', { name: 'Sorteos' });
    history.replaceState({ secretGiftIndex: 2 }, '', '?view=draws&group=g&edition=e');
    fireEvent(window, new PopStateEvent('popstate', { state: history.state }));
    expect(await screen.findByRole('heading', { name: 'Navidad' })).toBeInTheDocument();
});

it.each(['?group=ausente', '?view=draws&group=g&edition=ausente'])('offers safe navigation from %s', async query => {
    history.replaceState(null, '', query);
    render(<App />);
    await screen.findByRole('heading', { name: 'Este grupo o sorteo ya no está disponible' });
    await userEvent.click(screen.getByRole('button', { name: /Volver a/ }));
    expect(screen.queryByRole('heading', { name: 'Este grupo o sorteo ya no está disponible' })).not.toBeInTheDocument();
});

it('keeps focus in the form for consecutive adds and validates fields locally', async () => {
    const user = await open();
    await user.click(button('Participantes'));
    await user.click(button('Añadir persona'));
    const input = screen.getByLabelText('Nombre de persona');
    expect(input).toHaveFocus();
    await user.click(button('Guardar persona'));
    expect(input).toHaveAccessibleDescription('Escribe el nombre de la persona.');
    await user.type(input, 'Celia');
    await user.type(screen.getByLabelText('Correo de persona'), 'celia@example.invalid');
    await user.click(button('Guardar y añadir otra'));
    await screen.findByRole('button', { name: 'Editar contacto de Celia' });
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
});

it('leaves the skip link first in the keyboard order', async () => {
    const user = userEvent.setup();
    await load();
    await user.tab();
    expect(link('Saltar al contenido')).toHaveFocus();
});

it('celebrates a confirmed draw once and leaves email untouched', async () => {
    const user = await open();
    await user.click(button('Nuevo sorteo'));
    await user.click(button('Continuar'));
    await user.type(screen.getByLabelText('Título del sorteo'), 'Cena de prueba');
    fireEvent.change(screen.getByLabelText('Fecha del evento'), { target: { value: '2027-12-24' } });
    await user.click(button('Revisar sorteo'));
    await user.click(await screen.findByRole('button', { name: 'Confirmar sorteo' }));
    expect(await screen.findByText('Sorteo confirmado')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => /send|reminders/.test(String(url)))).toBe(false);
    await user.click(link('Grupos'));
    await user.click(button('Sorteos del grupo'));
    await user.click(button('Abrir Cena de prueba'));
    expect(screen.queryByText('Sorteo confirmado')).not.toBeInTheDocument();
});
