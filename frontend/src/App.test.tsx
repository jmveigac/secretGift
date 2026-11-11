import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import type { StateResponse } from './api';

const initial: StateResponse = {
    participants: [
        { id: 'a', name: 'Ana', email: 'ana@example.invalid', previousId: 'b' },
        { id: 'b', name: 'Bea', email: 'bea@example.invalid', previousId: null },
        { id: 'c', name: 'Cora', email: 'cora@example.invalid', previousId: null },
    ],
    maxParticipants: 15,
    draw: { completed: false, participantCount: 3 },
};
const completed: StateResponse = {
    ...initial, draw: { completed: true, participantCount: 3, completedAt: '2026-01-01T00:00:00Z' },
};
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const fetchMock = vi.fn<typeof fetch>();
const button = (name: string) => screen.getByRole('button', { name });
const recipient = () => screen.getByLabelText('Destinatario del año anterior (opcional)');
const nameInput = () => screen.getByLabelText('Nombre');
const emailInput = () => screen.getByLabelText('Correo');
async function load(state = initial) {
    fetchMock.mockResolvedValueOnce(response(state));
    render(<App />);
    await screen.findByText('ana@example.invalid');
}

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('offers a static local preview independently of SMTP and describes encrypted storage accurately', async () => {
    await load();
    const preview = screen.getByRole('link', { name: 'Vista previa del correo' });
    expect(preview).toHaveAttribute('href', '/mail-preview');
    expect(preview).toHaveAttribute('target', '_blank');
    expect(preview).toHaveAttribute('rel', 'noopener noreferrer');
    expect(preview).not.toHaveAttribute('aria-disabled');
    expect(screen.getByText(/Solo datos ficticios/)).toHaveTextContent('no envía correos ni utiliza tu sorteo');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(window.confirm).not.toHaveBeenCalled();
    expect(screen.getByText(/Uso local sin autenticación/)).toHaveTextContent('Los campos personales y las asignaciones privadas se guardan cifrados; SQLite no está cifrado íntegramente');
    expect(document.body).not.toHaveTextContent('Se guardan sin cifrar');
});

describe('Fase 2 React interface', () => {
    it('loads participants from the API and presents only public state', async () => {
        await load();
        expect(screen.getByText('3 / 15 participantes')).toBeInTheDocument();
        expect(screen.getByText('Año anterior: Bea')).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledWith('/api/state', expect.objectContaining({ cache: 'no-store' }));
        expect(document.body).not.toHaveTextContent(/"assignments"|"giver"|"receiver"/);
        expect(button('Reiniciar sorteo')).toBeDisabled();
    });

    it('adds a participant and replaces local state with the server response', async () => {
        const user = userEvent.setup(); await load();
        await user.type(nameInput(), 'Dani'); await user.type(emailInput(), 'dani@example.invalid');
        await user.selectOptions(recipient(), 'a');
        const added = { ...initial, participants: [...initial.participants, { id: 'd', name: 'Dani', email: 'dani@example.invalid', previousId: 'a' }] };
        fetchMock.mockResolvedValueOnce(response(added, 201));
        await user.click(button('Guardar participante'));
        await screen.findByText('dani@example.invalid');
        expect(fetchMock).toHaveBeenLastCalledWith('/api/participants', expect.objectContaining({
            method: 'POST', body: JSON.stringify({ name: 'Dani', email: 'dani@example.invalid', previousId: 'a' }),
        }));
        expect(nameInput()).toHaveValue(''); expect(recipient()).toHaveValue('');
    });

    it('restores the previous recipient, excludes self and preserves selection across edits and errors', async () => {
        const user = userEvent.setup(); await load();
        await user.click(button('Editar a Ana'));
        expect(nameInput()).toHaveValue('Ana'); expect(recipient()).toHaveValue('b');
        expect(within(recipient()).queryByRole('option', { name: 'Ana' })).not.toBeInTheDocument();
        await user.selectOptions(recipient(), 'c'); await user.clear(nameInput()); await user.type(nameInput(), 'Ana nueva');
        await user.clear(emailInput()); await user.type(emailInput(), 'nueva@example.invalid');
        expect(recipient()).toHaveValue('c');
        fetchMock.mockResolvedValueOnce(response({ error: 'Nombre duplicado.' }, 400));
        await user.click(button('Guardar participante'));
        expect(await screen.findByRole('alert')).toHaveTextContent('Nombre duplicado.');
        expect(nameInput()).toHaveValue('Ana nueva'); expect(emailInput()).toHaveValue('nueva@example.invalid'); expect(recipient()).toHaveValue('c');
        const updated = { ...initial, participants: initial.participants.map(p => p.id === 'a' ? { ...p, name: 'Ana nueva', email: 'nueva@example.invalid', previousId: 'c' } : p) };
        fetchMock.mockResolvedValueOnce(response(updated));
        await user.click(button('Guardar participante'));
        await screen.findByText('nueva@example.invalid');
        expect(fetchMock).toHaveBeenLastCalledWith('/api/participants/a', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ name: 'Ana nueva', email: 'nueva@example.invalid', previousId: 'c' }) }));
        await user.click(button('Editar a Ana nueva')); expect(recipient()).toHaveValue('c');
    });

    it('cancels an edit and clears all controlled fields without a request', async () => {
        const user = userEvent.setup(); await load(); await user.click(button('Editar a Ana'));
        await user.selectOptions(recipient(), 'c'); await user.click(button('Cancelar edición'));
        expect(nameInput()).toHaveValue(''); expect(emailInput()).toHaveValue(''); expect(recipient()).toHaveValue('');
        expect(screen.getByRole('heading', { name: 'Añadir participante' })).toBeInTheDocument();
        expect(within(recipient()).getByRole('option', { name: 'Ana' })).toBeInTheDocument(); expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('deletes only after confirmation and uses the returned participants', async () => {
        const user = userEvent.setup(); await load();
        vi.mocked(window.confirm).mockReturnValueOnce(false);
        await user.click(button('Eliminar a Bea')); expect(fetchMock).toHaveBeenCalledTimes(1);
        fetchMock.mockResolvedValueOnce(response({ ...initial, participants: initial.participants.filter(p => p.id !== 'b').map(p => ({ ...p, previousId: null })) }));
        await user.click(button('Eliminar a Bea'));
        await waitFor(() => expect(screen.queryByText('bea@example.invalid')).not.toBeInTheDocument());
        expect(screen.queryByText('Año anterior: Bea')).not.toBeInTheDocument();
        expect(fetchMock).toHaveBeenLastCalledWith('/api/participants/b', expect.objectContaining({ method: 'DELETE' }));
    });

    it('confirms a draw, prevents duplicate requests while pending and locks modifications', async () => {
        const user = userEvent.setup(); await load();
        vi.mocked(window.confirm).mockReturnValueOnce(false);
        await user.click(button('Realizar sorteo')); expect(fetchMock).toHaveBeenCalledTimes(1);
        let finish!: (response: Response) => void;
        fetchMock.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        await user.dblClick(button('Realizar sorteo'));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(button('Guardar participante')).toBeDisabled(); expect(button('Realizar sorteo')).toBeDisabled();
        finish(response(completed));
        await screen.findByText(/Sorteo completado · 3 participantes/);
        expect(button('Editar a Ana')).toBeDisabled(); expect(button('Eliminar a Bea')).toBeDisabled();
        expect(button('Guardar participante')).toBeDisabled(); expect(button('Realizar sorteo')).toBeDisabled();
        expect(button('Reiniciar sorteo')).toBeEnabled();
        expect(fetchMock).toHaveBeenLastCalledWith('/api/draw', expect.objectContaining({ body: '{"confirm":true}' }));
        expect(document.body).not.toHaveTextContent(/"assignments"|"giver"|"receiver"/);
    });

    it('resets only with confirmation and keeps participants', async () => {
        const user = userEvent.setup(); await load(completed);
        vi.mocked(window.confirm).mockReturnValueOnce(false);
        await user.click(button('Reiniciar sorteo')); expect(fetchMock).toHaveBeenCalledTimes(1);
        fetchMock.mockResolvedValueOnce(response(initial)); await user.click(button('Reiniciar sorteo'));
        await waitFor(() => expect(button('Editar a Ana')).toBeEnabled());
        expect(screen.getByText('3 / 15 participantes')).toBeInTheDocument(); expect(button('Reiniciar sorteo')).toBeDisabled();
        expect(fetchMock).toHaveBeenLastCalledWith('/api/draw/reset', expect.objectContaining({ body: '{"confirm":true}' }));
    });

    it('respects participant limits while allowing edits and enforces the minimum draw size', async () => {
        const user = userEvent.setup(); await load({ ...initial, maxParticipants: 3 });
        expect(button('Guardar participante')).toBeDisabled(); await user.click(button('Editar a Ana'));
        expect(button('Guardar participante')).toBeEnabled();
        // A separate server state with one participant cannot trigger the draw.
        const single = { ...initial, participants: [initial.participants[0]], draw: { completed: false as const, participantCount: 1 } };
        fetchMock.mockResolvedValueOnce(response(single));
        await user.click(button('Guardar participante'));
        await waitFor(() => expect(button('Realizar sorteo')).toBeDisabled());
    });

    it('handles loading and network errors without losing an unsaved form', async () => {
        fetchMock.mockRejectedValueOnce(new Error('network')); render(<App />);
        expect(screen.getByRole('status')).toHaveTextContent('Cargando datos');
        expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar los datos');
        expect(screen.queryByRole('button', { name: 'Realizar sorteo' })).not.toBeInTheDocument();
    });

    it('does not duplicate a submitted form while a response is pending', async () => {
        const user = userEvent.setup(); await load(); await user.type(nameInput(), 'Dani'); await user.type(emailInput(), 'dani@example.invalid');
        let reject!: (reason: Error) => void;
        fetchMock.mockReturnValueOnce(new Promise((_, failure) => { reject = failure; }));
        const form = nameInput().closest('form')!; fireEvent.submit(form); fireEvent.submit(form);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        reject(new Error('Sin conexión.'));
        expect(await screen.findByRole('alert')).toHaveTextContent('Sin conexión.');
        expect(nameInput()).toHaveValue('Dani'); expect(emailInput()).toHaveValue('dani@example.invalid');
    });
});

const mailState = (overrides = {}): StateResponse => ({ ...completed, delivery: {
    configured: true, active: false, revision: 'revision', pending: 3, accepted: 0, failed: 0, uncertain: 0, ...overrides,
} });
it('confirms real mail with participant count and prevents duplicate send requests', async () => {
    const user = userEvent.setup(); await load(mailState());
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await user.click(button('Enviar pendientes y fallidos')); expect(fetchMock).toHaveBeenCalledTimes(1);
    let finish!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await user.dblClick(button('Enviar pendientes y fallidos'));
    expect(window.confirm).toHaveBeenLastCalledWith(expect.stringMatching(/correos reales.*3 participantes/));
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(button('Reiniciar sorteo')).toBeDisabled();
    expect(screen.getByText('Envíos en curso.')).toBeInTheDocument();
    finish(response(mailState({ pending: 0, accepted: 3 })));
    await screen.findByText('Envíos completados: aceptados por SMTP.');
    expect(button('Enviar pendientes y fallidos')).toBeDisabled();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/draw/send', expect.objectContaining({ body: JSON.stringify({ confirm: true, drawId: completed.draw.completed ? completed.draw.completedAt : '', revision: 'revision', retryUncertain: false }) }));
    expect(document.body).not.toHaveTextContent(/"assignments"|"giver"|"receiver"/);
});
it('requires a separate explicit decision for uncertain retries and explains SMTP acceptance', async () => {
    const user = userEvent.setup(); await load(mailState({ pending: 0, uncertain: 1, accepted: 1, failed: 1 }));
    expect(screen.getByText(/no confirma la llegada/)).toBeInTheDocument();
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await user.click(button('Reenviar también inciertos')); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(window.confirm).toHaveBeenLastCalledWith(expect.stringMatching(/duplicarlos/));
    fetchMock.mockResolvedValueOnce(response(mailState({pending:0, accepted:3})));
    await user.click(button('Reenviar también inciertos'));
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string).retryUncertain).toBe(true);
});
it('disables sending without SMTP and while another send is active', async () => {
    await load(mailState({ configured: false, active: true, uncertain: 1 }));
    expect(screen.getByRole('alert')).toHaveTextContent('SMTP no está configurado');
    expect(button('Enviar pendientes y fallidos')).toBeDisabled();
    expect(button('Reenviar también inciertos')).toBeDisabled();
    expect(button('Reiniciar sorteo')).toBeDisabled();
    expect(screen.getByText('Envíos en curso.')).toBeInTheDocument();
});
