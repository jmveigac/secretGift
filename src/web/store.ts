import { dirname, resolve, join } from 'node:path';
import { randomUUID, randomInt } from 'node:crypto';
import { drawParticipants } from '../domain/draw';
import type { Participant, StateResponse } from './contracts';
import { smtpSender, type MailSender } from './mail';
import { storageLock } from './lock';
import { EncryptedDatabase } from './database';
export type { Participant } from './contracts';

export class AppError extends Error {
    constructor(public status: number, message: string) { super(message); }
}
type Delivery = 'pending' | 'uncertain' | 'accepted' | 'failed';
const activePaths = new Set<string>();
export interface State { version: 1; participants: Participant[]; draw: null | { completedAt: string; assignments: { giver: string; receiver: string }[]; deliveryRevision?: string; deliveries?: Record<string, Delivery> } }
const invalid = () => new AppError(400, 'Datos de participantes no válidos.');
export class LocalStore {
    private queue: Promise<unknown> = Promise.resolve();
    readonly path: string;
    constructor(path = process.env.DATA_FILE ?? './data/state.sqlite', readonly max = Number(process.env.MAX_PARTICIPANTS ?? 15), private readonly mail: MailSender = smtpSender(), private readonly keyPath = process.env.DATA_KEY_FILE ?? join(dirname(resolve(path)), '../keys/storage.key')) {
        this.path = resolve(path.endsWith('.json') ? path.slice(0, -5) + '.sqlite' : path);
        this.legacyPath = resolve(path.endsWith('.json') ? path : join(dirname(path), 'state.json'));
        if (!Number.isInteger(max) || max < 2 || max > 100) throw new Error('Invalid participant limit');
    }
    private readonly legacyPath: string;
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
            if (d.deliveryRevision !== undefined && (typeof d.deliveryRevision !== 'string' || !/^[\da-f-]{36}$/.test(d.deliveryRevision))) throw invalid();
            if (d.deliveries !== undefined && (!d.deliveries || typeof d.deliveries !== 'object' || Array.isArray(d.deliveries) || Object.keys(d.deliveries).length !== ids.size || Object.entries(d.deliveries).some(([id, status]) => !ids.has(id) || !['pending', 'uncertain', 'accepted', 'failed'].includes(status)))) throw invalid();
            const g = new Set(), r = new Set();
            for (const a of d.assignments) {
                if (!a || !ids.has(a.giver) || !ids.has(a.receiver) || a.giver === a.receiver || state.participants.find(p => p.id === a.giver)?.previousId === a.receiver || g.has(a.giver) || r.has(a.receiver)) throw invalid();
                g.add(a.giver); r.add(a.receiver);
            }
        }
    }
    private async database<T>(operation: (db: EncryptedDatabase) => T): Promise<T> {
        const db = await EncryptedDatabase.open(this.path, this.keyPath, this.legacyPath, state => this.validate(state));
        try { return operation(db); } finally { db.close(); }
    }
    private async read(): Promise<State> {
        return this.database(db => { const state = db.read(); this.validate(state); return state; });
    }
    private async write(state: State) {
        this.validate(state);
        await this.database(db => db.write(state));
    }
    private run<T>(operation: (state: State) => Promise<T>, lock = false): Promise<T> {
        const task = this.queue.then(async () => {
            let release: (() => Promise<void>) | undefined;
            if (lock) {
                if (activePaths.has(this.path)) throw new AppError(409, 'Hay un envío en curso. Espera antes de modificar el sorteo.');
                try { release = await storageLock(this.path); } catch { throw new AppError(409, 'El almacenamiento está ocupado por otra operación.'); }
            }
            try {
                let state: State;
                try { state = await this.read(); } catch { throw new Error('Storage unavailable'); }
                return await operation(state);
            } finally { await release?.(); }
        });
        this.queue = task.catch(() => undefined);
        return task;
    }
    private view(state: State): StateResponse {
        const counts = { pending: 0, uncertain: 0, accepted: 0, failed: 0 };
        if (state.draw) for (const p of state.participants) counts[state.draw.deliveries?.[p.id] ?? 'pending']++;
        return { delivery: { revision: state.draw?.deliveryRevision ?? state.draw?.completedAt ?? '', configured: this.mail.configured, active: activePaths.has(this.path), ...counts }, participants: state.participants.map(({ id, name, email, previousId }) => ({ id, name, email, previousId })), maxParticipants: this.max, draw: state.draw ? { completed: true, participantCount: state.participants.length, completedAt: state.draw.completedAt } : { completed: false, participantCount: state.participants.length } };
    }
    status() { return this.run(async state => this.view(state)); }
    async send(input: unknown) {
        if (!input || typeof input !== 'object' || (input as { confirm?: unknown }).confirm !== true) throw new AppError(400, 'Confirma el envío de correos reales.');
        const body = input as { drawId?: unknown; revision?: unknown; retryUncertain?: unknown };
        if (activePaths.has(this.path)) throw new AppError(409, 'Hay un envío en curso.');
        let release: () => Promise<void>;
        try { release = await storageLock(this.path); } catch { throw new AppError(409, 'Hay otra operación en curso.'); }
        activePaths.add(this.path);
        try {
            const state = await this.read();
            const draw = state.draw;
            if (!draw) throw new AppError(409, 'Confirma el sorteo antes de enviar.');
            if (body.drawId !== draw.completedAt) throw new AppError(409, 'El sorteo ha cambiado. Recarga antes de enviar.');
            if (!this.mail.configured) throw new AppError(409, 'SMTP no está configurado. Configura las variables privadas y reinicia la aplicación.');
            if (body.revision !== (draw.deliveryRevision ?? draw.completedAt)) throw new AppError(409, 'El estado de envío ha cambiado. Recarga antes de reintentar.');
            draw.deliveryRevision = randomUUID();
            draw.deliveries ??= Object.fromEntries(state.participants.map(p => [p.id, 'pending' as Delivery]));
            await this.write(state);
            for (const assignment of draw.assignments) {
                const previous = draw.deliveries[assignment.giver];
                if (previous === 'accepted' || previous === 'uncertain' && body.retryUncertain !== true) continue;
                // Persist before SMTP. Any interruption leaves an explicit uncertain result.
                draw.deliveries[assignment.giver] = 'uncertain';
                await this.write(state);
                const giver = state.participants.find(p => p.id === assignment.giver)!;
                const receiver = state.participants.find(p => p.id === assignment.receiver)!;
                let outcome: Delivery = 'uncertain';
                try { outcome = await this.mail.send({ to: giver.email, name: giver.name, receiver: receiver.name }); } catch { /* never expose SMTP errors */ }
                draw.deliveries[assignment.giver] = outcome;
                await this.write(state);
            }
            const result = this.view(state);
            result.delivery!.active = false;
            return result;
        } finally { activePaths.delete(this.path); await release(); }
    }
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
                    state.draw = { completedAt: new Date().toISOString(), deliveryRevision: randomUUID(), assignments: result.map(p => ({ giver: p.name, receiver: p.lastGift })) };
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
        }, true);
    }
}
