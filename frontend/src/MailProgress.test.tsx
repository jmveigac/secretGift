import { act, cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { StateResponse } from './api';
import MailProgress, { useMailProgress } from './MailProgress';

const scope = { groupId: 'g', editionId: 'e' };
const current: StateResponse = {
    scope, participants: [], maxParticipants: 15,
    draw: { completed: true, completedAt: '2026-01-01T00:00:00Z', participantCount: 2 },
    delivery: { configured: true, mode: 'test', testEmail: 'test@example.invalid', active: true,
        revision: 'delivery', pending: 1, accepted: 1, uncertain: 0, failed: 0 },
    mailOperation: { id: 'op', mode: 'test', kind: 'initial', status: 'running', total: 2, processed: 1 },
};
const finished: StateResponse = {
    ...current, delivery: { ...current.delivery!, active: false, pending: 0, failed: 1 },
    mailOperation: { ...current.mailOperation!, status: 'finished', processed: 2 },
};
const response = (state: StateResponse) => new Response(JSON.stringify(state));
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

function View() {
    const [state, update] = useState(current);
    const [error, setError] = useState('');
    useMailProgress(scope, state, update, setError);
    return <>{error && <p role="alert">{error}</p>}<MailProgress state={state} /></>;
}

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

it('recovers active progress, retries failed reads and stops polling after a partial result', async () => {
    vi.useFakeTimers();
    let resolve!: (value: Response) => void;
    const get = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline'))
        .mockReturnValueOnce(new Promise(done => { resolve = done; }));
    vi.stubGlobal('fetch', get);
    render(<View />);
    expect(screen.getByRole('progressbar', { name: '1 de 2 mensajes procesados' })).toHaveValue(1);
    await tick(1500);
    expect(screen.getByRole('alert')).toHaveTextContent('Volveremos a intentarlo');
    await tick(1500);
    await tick(6000);
    expect(get).toHaveBeenCalledTimes(2);
    await act(async () => resolve(response(finished)));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Operación finalizada');
    expect(screen.getByText(/Aceptados por SMTP: 1.*Rechazados: 1/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveValue(2);
    await tick(6000);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true);
});

it('aborts the progress query on navigation and only reads after reopening', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const get = vi.fn<typeof fetch>().mockImplementationOnce(async (_url, options) => {
        signal = options?.signal ?? undefined;
        return new Promise(() => {});
    }).mockResolvedValueOnce(response(finished));
    vi.stubGlobal('fetch', get);
    const view = render(<View />);
    await tick(1500);
    expect(signal?.aborted).toBe(false);
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await tick(6000);
    expect(get).toHaveBeenCalledTimes(1);
    render(<View />);
    await tick(1500);
    expect(screen.getByRole('progressbar')).toHaveValue(2);
    expect(get).toHaveBeenCalledTimes(2);
});
