import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID, randomInt } from 'node:crypto';
import { drawParticipants } from '../domain/draw';
import type { Participant, StateResponse } from './contracts';
export type { Participant } from './contracts';

export class AppError extends Error {
    constructor(public status: number, message: string) { super(message); }
}
interface State { version: 1; participants: Participant[]; draw: null | { completedAt: string; assignments: { giver: string; receiver: string }[] } }
const empty = (): State => ({ version: 1, participants: [], draw: null });
const invalid = () => new AppError(400, 'Datos de participantes no válidos.');
export class LocalStore {
    private queue: Promise<unknown> = Promise.resolve();
    readonly path: string;
    constructor(path = process.env.DATA_FILE ?? './data/state.json', readonly max = Number(process.env.MAX_PARTICIPANTS ?? 15)) {
        this.path = resolve(path);
        if (!Number.isInteger(max) || max < 2 || max > 100) throw new Error('Invalid participant limit');
    }
    private validate(state: State) {
        if (!state || state.version !== 1 || !Array.isArray(state.participants) || state.participants.length > this.max) throw invalid();
        const ids = new Set<string>(), names = new Set<string>(), emails = new Set<string>();
        for (const p of state.participants) {
            if (!p || typeof p.id !== 'string' || !/^[\da-f-]{36}$/.test(p.id) || ids.has(p.id) || typeof p.name !== 'string' || !p.name || p.name !== p.name.trim().replace(/\s+/g, ' ') || p.name.length > 100 || /[\x00-\x1f\x7f]/.test(p.name) || typeof p.email !== 'string' || p.email.length > 254 || /[\x00-\x1f\x7f]/.test(p.email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email) || names.has(p.name.toLowerCase()) || emails.has(p.email.toLowerCase())) throw invalid();
            ids.add(p.id); names.add(p.name.toLowerCase()); emails.add(p.email.toLowerCase());
        }
        for (const p of state.participants) if (p.previousId !== null && (!ids.has(p.previousId) || p.previousId === p.id)) throw invalid();
        if (state.draw !== null) {
            const d = state.draw;
            if (!d || typeof d.completedAt !== 'string' || !Number.isFinite(Date.parse(d.completedAt)) || !Array.isArray(d.assignments) || d.assignments.length !== ids.size || ids.size < 2) throw invalid();
            const g = new Set(), r = new Set();
            for (const a of d.assignments) {
                if (!a || !ids.has(a.giver) || !ids.has(a.receiver) || a.giver === a.receiver || state.participants.find(p => p.id === a.giver)?.previousId === a.receiver || g.has(a.giver) || r.has(a.receiver)) throw invalid();
                g.add(a.giver); r.add(a.receiver);
            }
        }
    }
    private async read(): Promise<State> {
        let raw: string;
        try { raw = await fs.readFile(this.path, 'utf8'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty(); throw error; }
        const state = JSON.parse(raw) as State;
        this.validate(state);
        await fs.chmod(dirname(this.path), 0o700);
        await fs.chmod(this.path, 0o600);
        return state;
    }
    private async write(state: State) {
        await fs.mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        await fs.chmod(dirname(this.path), 0o700);
        const temp = `${this.path}.${randomUUID()}.tmp`;
        const directory = await fs.open(dirname(this.path), 'r');
        let renamed = false;
        try {
            try {
                const file = await fs.open(temp, 'wx', 0o600);
                try { await file.writeFile(JSON.stringify(state)); await file.sync(); }
                finally { await file.close(); }
                await fs.rename(temp, this.path);
                renamed = true;
                // On Linux, fsync(file) does not persist the directory entry.
                await directory.sync();
            } finally { await directory.close(); }
        } catch (error) {
            if (renamed) {
                throw new AppError(503, 'Los cambios ya están aplicados, pero no se pudo confirmar su durabilidad. Recarga el estado antes de reintentar.');
            }
            throw error;
        } finally { await fs.unlink(temp).catch(() => undefined); }
    }
    private run<T>(operation: (state: State) => Promise<T>): Promise<T> {
        const task = this.queue.then(async () => {
            let state: State;
            try { state = await this.read(); } catch { throw new Error('Storage unavailable'); }
            return operation(state);
        });
        this.queue = task.catch(() => undefined);
        return task;
    }
    private view(state: State): StateResponse {
        return { participants: state.participants.map(({ id, name, email, previousId }) => ({ id, name, email, previousId })), maxParticipants: this.max, draw: state.draw ? { completed: true, participantCount: state.participants.length, completedAt: state.draw.completedAt } : { completed: false, participantCount: state.participants.length } };
    }
    status() { return this.run(async state => this.view(state)); }
    mutate(action: 'add' | 'edit' | 'delete' | 'draw' | 'reset', input: unknown, id?: string) {
        return this.run(async state => {
            if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
            const body = input as Record<string, unknown>;
            if (action === 'reset') {
                if (body.confirm !== true) throw new AppError(400, 'Confirma el reinicio del sorteo.');
                state.draw = null;
            } else {
                if (state.draw) throw new AppError(409, 'Reinicia el sorteo antes de modificar los datos.');
                if (action === 'draw') {
                    if (body.confirm !== true) throw new AppError(400, 'Confirma la ejecución del sorteo.');
                    const source = state.participants.map(p => ({ name: p.id, email: p.email, lastGift: p.previousId ?? '' }));
                    let result;
                    try { result = drawParticipants(source, randomInt); } catch { throw new AppError(422, 'No existe un sorteo válido con estos participantes y restricciones.'); }
                    state.draw = { completedAt: new Date().toISOString(), assignments: result.map(p => ({ giver: p.name, receiver: p.lastGift })) };
                } else {
                    const index = state.participants.findIndex(p => p.id === id);
                    if (action !== 'add' && index < 0) throw new AppError(404, 'Participante no encontrado.');
                    if (action === 'delete') {
                        state.participants.splice(index, 1);
                        state.participants.forEach(p => { if (p.previousId === id) p.previousId = null; });
                    } else {
                        if (Object.keys(body).some(k => !['name', 'email', 'previousId'].includes(k)) || typeof body.name !== 'string' || typeof body.email !== 'string' || body.name.length > 100 || body.email.length > 254 || /[\x00-\x1f\x7f]/.test(body.name + body.email) || !(body.previousId === null || typeof body.previousId === 'string')) throw invalid();
                        const p = { id: action === 'add' ? randomUUID() : id!, name: body.name.trim().replace(/\s+/g, ' '), email: body.email.trim().toLowerCase(), previousId: body.previousId };
                        if (action === 'add') state.participants.push(p); else state.participants[index] = p;
                    }
                }
            }
            this.validate(state);
            await this.write(state);
            return this.view(state);
        });
    }
}
