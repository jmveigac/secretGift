import { resolveSchedule, type Schedule } from '../domain/schedule';
import { dirname, resolve, join } from 'node:path';
import { randomUUID, randomInt } from 'node:crypto';
import { drawParticipants } from '../domain/draw';
import { validateState, type State, type Delivery } from '../domain/editions';
import type { Participant, StateResponse, EditionScope, GroupResponse, Person, ResultsResponse, RestrictionPreview } from './contracts';
import { smtpSender, type MailSender } from './mail';
import { storageLock } from './lock';
import { EncryptedDatabase, MissingDatabaseError, type Campaign } from './database';
export type { Participant } from './contracts';

export class AppError extends Error {
    constructor(public status: number, message: string) { super(message); }
}
const activePaths = new Set<string>();
export type { State } from '../domain/editions';
const invalid = () => new AppError(400, 'Datos de participantes no válidos.');
export class LocalStore {
    private queue: Promise<unknown> = Promise.resolve();
    readonly path: string;
    constructor(path = process.env.DATA_FILE ?? './data/state.sqlite', readonly max = Number(process.env.MAX_PARTICIPANTS ?? 15), private readonly mail: MailSender = smtpSender(), private readonly keyPath = process.env.DATA_KEY_FILE ?? join(dirname(resolve(path)), '../keys/storage.key'), private readonly now: () => number = Date.now) {
        this.path = resolve(path.endsWith('.json') ? path.slice(0, -5) + '.sqlite' : path);
        this.legacyPath = resolve(path.endsWith('.json') ? path : join(dirname(path), 'state.json'));
        if (!Number.isInteger(max) || max < 2 || max > 100) throw new Error('Invalid participant limit');
    }
    private readonly legacyPath: string;
    private validate(state: State) {
        try { validateState(state, this.max); } catch { throw invalid(); }
    }
    private async database<T>(operation: (db: EncryptedDatabase) => T): Promise<T> {
        const db = await EncryptedDatabase.open(this.path, this.keyPath, this.legacyPath, state => this.validate(state));
        try { return operation(db); } finally { db.close(); }
    }
    private async read(scope?: EditionScope): Promise<State> {
        return this.database(db => { if (scope) this.requireScope(db, scope);
            const state = scope ? db.readEdition(scope.groupId, scope.editionId) : db.read(); this.validate(state); return state; });
    }
    private async write(state: State, scope?: EditionScope, newPerson?: Person) {
        this.validate(state);
        await this.database(db => scope ? db.writeEdition(scope.groupId, scope.editionId, state, newPerson) : db.write(state));
    }
    private run<T>(operation: (state: State) => Promise<T>, lock = false, scope?: EditionScope): Promise<T> {
        const task = this.queue.then(async () => {
            let release: (() => Promise<void>) | undefined;
            if (lock) {
                if (activePaths.has(this.path)) throw new AppError(409, 'Hay un envío en curso. Espera antes de modificar el sorteo.');
                try { release = await storageLock(this.path); } catch { throw new AppError(409, 'El almacenamiento está ocupado por otra operación.'); }
            }
            try {
                let state: State;
                try { state = await this.read(scope); } catch (error) {
                    if (error instanceof MissingDatabaseError || error instanceof AppError) throw error;
                    throw new Error('Storage unavailable');
                }
                return await operation(state);
            } finally { await release?.(); }
        });
        this.queue = task.catch(() => undefined);
        return task;
    }
    private publicView(state: State): StateResponse {
        const count = (deliveries?: Record<string, Delivery>) => {
            const result = { pending: 0, uncertain: 0, accepted: 0, failed: 0 };
            if (state.draw) for (const p of state.participants) result[deliveries?.[p.id] ?? 'pending']++;
            return result;
        };
        const production = count(state.draw?.deliveries), test = count(state.draw?.testDeliveries);
        const mode = this.mail.mode ?? 'production';
        const revision = (state.draw?.deliveryRevision ?? state.draw?.completedAt ?? '') + (this.mail.session ? `:${this.mail.session}` : '');
        return { delivery: { revision, mode: this.mail.mode, testEmail: this.mail.testEmail, configurationError: this.mail.configurationError,
            production, test, configured: this.mail.configured, active: activePaths.has(this.path), ...(mode === 'test' ? test : production) }, participants: state.participants.map(({ id, name, email, previousId }) => ({ id, name, email, previousId })), maxParticipants: this.max, draw: state.draw ? { completed: true, participantCount: state.participants.length, completedAt: state.draw.completedAt } : { completed: false, participantCount: state.participants.length } };
    }

    private requireScope(db: EncryptedDatabase, scope: EditionScope) {
        if (!db.listGroups().some(g => g.id === scope.groupId)
            || !db.listEditions(scope.groupId).some(e => e.id === scope.editionId)) throw new AppError(404, 'Edición no encontrada en este grupo.');
    }
    private async checkRevision(state: State, input: unknown, scope?: EditionScope) {
        if (!scope) return;
        const revision = (input as { expectedRevision?: unknown })?.expectedRevision;
        const current = await this.database(db => db.fingerprint(`edition:${scope.groupId}:${scope.editionId}`, { state, edition: db.editionInfo(scope), history: db.historyRevision(scope) }));
        if (typeof revision !== 'string' || revision !== current) throw new AppError(409, 'La edición ha cambiado. Actualiza su estado antes de continuar.');
    }
    private groupView(db: EncryptedDatabase, groupId: string): GroupResponse {
        const group = db.listGroups().find(g => g.id === groupId);
        if (!group) throw new AppError(404, 'Grupo no encontrado.');
        const data = {
            group, people: db.listPeople(groupId),
            editions: db.listEditions(groupId).map(edition => {
                const state = db.readEdition(groupId, edition.id), view = this.publicView(state);
                return { edition, draw: view.draw, delivery: view.delivery, results: this.resultAvailability(!!state.draw, edition.schedule) };
            }),
            maxParticipants: this.max, busy: activePaths.has(this.path)
        };
        return { ...data, revision: db.fingerprint(`group:${groupId}`, data) };
    }
    groups() { return this.database(db => ({ groups: db.listGroups() })); }
    group(groupId: string) { return this.database(db => this.groupView(db, groupId)); }
    private cleanName(value: unknown): string {
        if (typeof value !== 'string' || value.length > 100 || /[\x00-\x1f\x7f]/.test(value)) throw invalid();
        const name = value.trim().replace(/\s+/g, ' ');
        if (!name) throw invalid();
        return name;
    }
    private uniquePerson(db: EncryptedDatabase, groupId: string, person: Person) {
        if (person.active && db.listPeople(groupId).some(p => p.id !== person.id && p.active && (p.name.toLowerCase() === person.name.toLowerCase() || p.email.toLowerCase() === person.email.toLowerCase()))) throw new AppError(409, 'Ya hay una persona activa con ese nombre o correo en el grupo.');
    }
    async manage(action: 'createGroup' | 'renameGroup' | 'addPerson' | 'editPerson' | 'createEdition', input: unknown, groupId?: string, personId?: string): Promise<GroupResponse> {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
        const body = input as Record<string, unknown>;
        const allowed = action === 'createGroup' ? ['name'] : action === 'renameGroup' ? ['name', 'expectedRevision']
            : action === 'createEdition' ? ['name', 'year', 'personIds', 'expectedRevision', 'previousIds', 'schedule', 'confirmDraw', 'referenceEditionId'] : ['name', 'email', 'active', 'expectedRevision'];
        if (Object.keys(body).some(k => !allowed.includes(k))) throw invalid();
        if (activePaths.has(this.path)) throw new AppError(409, 'Hay un envío en curso. Espera antes de modificar los datos.');
        let release: () => Promise<void>;
        try { release = await storageLock(this.path); } catch { throw new AppError(409, 'El almacenamiento está ocupado por otra operación.'); }
        try {
            return await this.database(db => {
                const current = groupId ? this.groupView(db, groupId) : undefined;
                if (current && body.expectedRevision !== current.revision) throw new AppError(409, 'El grupo ha cambiado. Actualiza sus datos antes de continuar.');
                if (action === 'createGroup' || action === 'renameGroup') {
                    const name = this.cleanName(body.name);
                    if (db.listGroups().some(g => g.id !== (action === 'renameGroup' ? groupId : undefined) && g.name.toLowerCase() === name.toLowerCase())) throw new AppError(409, 'Ya existe un grupo con ese nombre.');
                    if (action === 'createGroup') return this.groupView(db, db.createGroup(name).id);
                    db.renameGroup(groupId!, name);
                } else if (action === 'createEdition') {
                    const name = this.cleanName(body.name);
                    if (!Number.isInteger(body.year) || (body.year as number) < 1 || (body.year as number) > 9999 || !Array.isArray(body.personIds)
                        || body.personIds.length > this.max || new Set(body.personIds).size !== body.personIds.length
                        || body.personIds.some(id => typeof id !== 'string' || !current!.people.some(p => p.id === id && p.active))) throw invalid();
                    const schedule = body.schedule === undefined ? undefined : this.schedule(body.schedule);
                    if (body.confirmDraw !== undefined && body.confirmDraw !== true) throw invalid();
                    if (body.confirmDraw && !schedule) throw new AppError(400, 'La confirmación guiada requiere fecha y hora de revelación.');
                    if (current!.editions.some(e => e.edition.year === body.year && e.edition.name.toLowerCase() === name.toLowerCase() && e.edition.schedule?.eventAt === schedule?.eventAt)) throw new AppError(409, 'Ya existe una edición con ese nombre y año.');
                    const previousIds = this.previousIds(body.previousIds);
                    const ids = body.personIds as string[];
                    if (previousIds && Object.keys(previousIds).some(id => !ids.includes(id))) throw invalid();
                    this.validate({ version: 1, draw: null, participants: ids.map(id => { const person = current!.people.find(p => p.id === id)!; return { id, name: person.name, email: person.email, previousId: previousIds?.[id] ?? null }; }) });
                    if (schedule && body.year !== Number(schedule.localDateTime.slice(0, 4))) throw invalid();
                    const options = { name, year: body.year as number, personIds: body.personIds as string[], schedule, previousIds,
                        prepare: body.confirmDraw ? (state: State, restrictions: Record<string, string | null>) => this.confirmDraw(state, restrictions) : undefined };
                    if (body.referenceEditionId !== undefined) {
                        if (typeof body.referenceEditionId !== 'string' || !current!.editions.some(e => e.edition.id === body.referenceEditionId && e.draw.completed)) throw new AppError(404, 'Sorteo de referencia no encontrado.');
                        db.forkEdition(groupId!, body.referenceEditionId, options);
                    } else db.createEdition(groupId!, name, options.year, options.personIds, options);
                } else {
                    const old = action === 'editPerson' ? current!.people.find(p => p.id === personId) : undefined;
                    if (action === 'editPerson' && !old) throw new AppError(404, 'Persona no encontrada en este grupo.');
                    if (typeof body.email !== 'string' || body.email.length > 254 || /[\x00-\x1f\x7f]/.test(body.email)
                        || (action === 'editPerson' && typeof body.active !== 'boolean') || (body.active !== undefined && typeof body.active !== 'boolean')) throw invalid();
                    const person = { id: old?.id ?? randomUUID(), name: this.cleanName(body.name), email: body.email.trim().toLowerCase(), active: body.active === undefined ? true : body.active as boolean };
                    this.validate({ version: 1, participants: [{ ...person, previousId: null }], draw: null });
                    this.uniquePerson(db, groupId!, person);
                    db.putPerson(groupId!, person);
                }
                return this.groupView(db, groupId!);
            });
        } finally { await release(); }
    }
    private schedule(input: unknown): Schedule {
        try { return resolveSchedule(input); } catch (e) { throw new AppError(400, (e as Error).message); }
    }
    private previousIds(input: unknown): Record<string, string | null> | undefined {
        if (input === undefined) return undefined;
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.values(input).some(v => v !== null && typeof v !== 'string')) throw invalid();
        return input as Record<string, string | null>;
    }
    private confirmDraw(state: State, restrictions: Record<string, string | null>): State {
        const source = state.participants.map(p => ({ name: p.id, email: p.email, lastGift: restrictions[p.id] ?? '' }));
        let result;
        try { result = drawParticipants(source, randomInt); } catch { throw new AppError(422, 'No existe un sorteo válido con estos participantes y restricciones. Revisa la selección y los antecedentes.'); }
        return { ...state, draw: { restrictions, completedAt: new Date(this.now()).toISOString(), deliveryRevision: randomUUID(), assignments: result.map(p => ({ giver: p.name, receiver: p.lastGift })) } };
    }
    private resultAvailability(confirmed: boolean, schedule?: Schedule): NonNullable<StateResponse['results']> {
        return { available: confirmed && !!schedule && this.now() >= Date.parse(schedule.revealAt), reason: !confirmed ? 'unconfirmed' : !schedule ? 'missing-date' : 'scheduled' };
    }
    private campaignRevision(campaign: Campaign) { return campaign.revision + (this.mail.session ? `:${this.mail.session}` : ''); }
    private async view(state: State, scope?: EditionScope): Promise<StateResponse> {
        const view = this.publicView(state);
        return this.database(db => {
            const edition = db.editionInfo(scope);
            const campaigns = db.listCampaigns(edition.groupId, edition.id).map(c => {
                const counts = { pending: 0, accepted: 0, uncertain: 0, failed: 0 };
                for (const status of Object.values(c.deliveries)) counts[status]++;
                return { id: c.id, createdAt: c.createdAt, mode: c.mode, revision: this.campaignRevision(c), ...counts };
            });
            return { ...view, schedule: edition.schedule, results: this.resultAvailability(!!state.draw, edition.schedule), campaigns,
                ...(scope ? { scope, revision: db.fingerprint(`edition:${scope.groupId}:${scope.editionId}`, { state, edition: db.editionInfo(scope), history: db.historyRevision(scope) }) } : {}) };
        });
    }
    status(scope?: EditionScope) { return this.run(async state => this.view(state, scope), false, scope); }
    results(scope: EditionScope): Promise<ResultsResponse> {
        return this.run(async state => {
            if (!state.draw) throw new AppError(409, 'Confirma el sorteo antes de consultar resultados.');
            const edition = await this.database(db => db.editionInfo(scope));
            if (!this.resultAvailability(true, edition.schedule).available) throw new AppError(403, edition.schedule ? 'Asignaciones ocultas hasta la fecha de revelación.' : 'Asignaciones ocultas: este sorteo histórico no tiene fecha de revelación.');
            return { assignments: state.draw.assignments.map(a => {
                const giver = state.participants.find(p => p.id === a.giver)!, receiver = state.participants.find(p => p.id === a.receiver)!;
                return { giver: { id: giver.id, name: giver.name }, receiver: { id: receiver.id, name: receiver.name } };
            }) };
        }, false, scope);
    }
    preview(groupId: string, input: unknown): Promise<RestrictionPreview> {
        const body = input as { expectedRevision?: unknown; personIds?: unknown; previousIds?: unknown; schedule?: unknown };
        if (!body || !Array.isArray(body.personIds) || body.personIds.some(id => typeof id !== 'string')) throw invalid();
        const ids = body.personIds as string[], previous = this.previousIds(body.previousIds);
        return this.database(db => {
            const group = this.groupView(db, groupId);
            if (body.expectedRevision !== group.revision) throw new AppError(409, 'El grupo ha cambiado. Actualiza antes de continuar.');
            if (previous && Object.keys(previous).some(id => !ids.includes(id))) throw invalid();
            const participants = ids.map(id => { const p = group.people.find(p => p.id === id && p.active); if (!p) throw invalid(); return { id, name: p.name, email: p.email, previousId: previous?.[id] ?? null }; });
            const state: State = { version: 1, participants, draw: null }; this.validate(state);
            const history = db.previousRecipients(undefined, groupId), effective = db.effectiveRestrictions(state, undefined, groupId);
            let viable = true;
            try { drawParticipants(participants.map(p => ({ name: p.id, email: p.email, lastGift: effective[p.id] ?? '' })), () => 0); } catch { viable = false; }
            return { schedule: body.schedule === undefined ? undefined : this.schedule(body.schedule), viable, restrictions: participants.map(p => history[p.id]
                ? { personId: p.id, source: 'verified' as const }
                : p.previousId ? { personId: p.id, source: 'manual' as const, previousId: p.previousId } : { personId: p.id, source: 'none' as const }) };
        });
    }
    configure(scope: EditionScope, input: unknown) {
        return this.run(async state => {
            if (!input || typeof input !== 'object') throw invalid();
            await this.checkRevision(state, input, scope);
            if (state.draw) throw new AppError(409, 'La fecha y los datos de un sorteo confirmado no se pueden cambiar.');
            const body = input as { name?: unknown; schedule?: unknown };
            const schedule = this.schedule(body.schedule), name = this.cleanName(body.name);
            await this.database(db => db.configureEdition(scope.groupId, scope.editionId, name, Number(schedule.localDateTime.slice(0, 4)), schedule));
            return this.view(state, scope);
        }, true, scope);
    }
    async send(input: unknown, scope?: EditionScope, campaignId?: string) {
        if (!input || typeof input !== 'object' || (input as { confirm?: unknown }).confirm !== true) throw new AppError(400, 'Confirma el envío de correos reales.');
        const body = input as { drawId?: unknown; revision?: unknown; retryUncertain?: unknown };
        if (activePaths.has(this.path)) throw new AppError(409, 'Hay un envío en curso.');
        let release: () => Promise<void>;
        try { release = await storageLock(this.path); } catch { throw new AppError(409, 'Hay otra operación en curso.'); }
        activePaths.add(this.path);
        try {
            const state = await this.read(scope);
            await this.checkRevision(state, input, scope);
            const draw = state.draw;
            if (!draw) throw new AppError(409, 'Confirma el sorteo antes de enviar.');
            if (body.drawId !== draw.completedAt) throw new AppError(409, 'El sorteo ha cambiado. Recarga antes de enviar.');
            if (!this.mail.configured) throw new AppError(409, this.mail.configurationError ?? 'SMTP no está configurado. Configura las variables privadas y reinicia la aplicación.');
            let campaign: Campaign | undefined;
            if (campaignId && !scope) throw invalid();
            if (campaignId && campaignId !== 'new') {
                const exists = await this.database(db => db.listCampaigns(scope!.groupId, scope!.editionId).some(c => c.id === campaignId));
                if (!exists) throw new AppError(404, 'Campaña no encontrada.');
                campaign = await this.database(db => db.readCampaign(scope!.groupId, scope!.editionId, campaignId));
                if (campaign.mode !== (this.mail.mode ?? 'production')) throw new AppError(409, 'Esta campaña pertenece a otro modo. Cambia la configuración antes de reintentar.');
            }
            const revision = campaign ? this.campaignRevision(campaign) : this.publicView(state).delivery!.revision;
            if (body.revision !== revision) throw new AppError(409, 'El estado de envío ha cambiado. Recarga antes de reintentar.');
            if (campaignId === 'new') {
                draw.deliveryRevision = randomUUID();
                campaign = await this.database(db => db.createCampaign(scope!.groupId, scope!.editionId, this.mail.mode ?? 'production', new Date(this.now()).toISOString(), draw.deliveryRevision!));
            }
            const lane = this.mail.mode === 'test' ? 'testDeliveries' : 'deliveries';
            const deliveries = campaign ? campaign.deliveries : draw[lane] ??= Object.fromEntries(state.participants.map(p => [p.id, 'pending' as Delivery]));
            const persist = async () => {
                if (campaign) { campaign.revision = randomUUID(); await this.database(db => db.updateCampaign(campaign!)); }
                else await this.write(state, scope);
            };
            if (!campaign) draw.deliveryRevision = randomUUID();
            await persist();
            for (const assignment of draw.assignments) {
                const previous = deliveries[assignment.giver];
                if (previous === 'accepted' || previous === 'uncertain' && body.retryUncertain !== true) continue;
                deliveries[assignment.giver] = 'uncertain';
                await persist();
                const giver = state.participants.find(p => p.id === assignment.giver)!;
                const receiver = state.participants.find(p => p.id === assignment.receiver)!;
                let outcome: Delivery = 'uncertain';
                try { outcome = await this.mail.send({ to: giver.email, name: giver.name, receiver: receiver.name }); } catch { /* Never expose transport errors. */ }
                deliveries[assignment.giver] = outcome;
                await persist();
            }
            const result = await this.view(state, scope);
            result.delivery!.active = false;
            return result;
        } finally { activePaths.delete(this.path); await release(); }
    }
    mutate(action: 'add' | 'edit' | 'delete' | 'draw' | 'reset', input: unknown, id?: string, scope?: EditionScope) {
        return this.run(async state => {
            if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
            await this.checkRevision(state, input, scope);
            const body = { ...input } as Record<string, unknown>;
            if (scope) delete body.expectedRevision;
            if (action === 'reset') {
                if (body.confirm !== true) throw new AppError(400, 'Confirma el reinicio del sorteo.');
                if (scope) {
                    if (!state.draw) throw new AppError(409, 'La edición no está sorteada.');
                    const edition = await this.database(db => db.forkEdition(scope.groupId, scope.editionId));
                    const next = { groupId: scope.groupId, editionId: edition.id };
                    return this.view(await this.read(next), next);
                }
                state.draw = null;
            } else {
                if (state.draw) throw new AppError(409, 'Reinicia el sorteo antes de modificar los datos.');
                if (action === 'draw') {
                    if (body.confirm !== true) throw new AppError(400, 'Confirma la ejecución del sorteo.');
                    const restrictions = await this.database(db => db.effectiveRestrictions(state, scope));
                    state = this.confirmDraw(state, restrictions);
                } else {
                    const index = state.participants.findIndex(p => p.id === id);
                    if (action !== 'add' && index < 0) throw new AppError(404, 'Participante no encontrado.');
                    if (action === 'delete') {
                        state.participants.splice(index, 1);
                        state.participants.forEach(p => { if (p.previousId === id) p.previousId = null; });
                    } else if (action === 'add' && scope && typeof body.personId === 'string') {
                        if (Object.keys(body).some(k => !['personId', 'expectedGroupRevision'].includes(k))) throw invalid();
                        const group = await this.group(scope.groupId);
                        if (body.expectedGroupRevision !== group.revision) throw new AppError(409, 'El grupo ha cambiado. Actualiza sus datos antes de continuar.');
                        const person = group.people.find(p => p.id === body.personId && p.active);
                        if (!person) throw new AppError(404, 'Persona activa no encontrada en este grupo.');
                        state.participants.push({ id: person.id, name: person.name, email: person.email, previousId: null });
                    } else {
                        if (Object.keys(body).some(k => !['name', 'email', 'previousId'].includes(k)) || typeof body.name !== 'string' || typeof body.email !== 'string' || body.name.length > 100 || body.email.length > 254 || /[\x00-\x1f\x7f]/.test(body.name + body.email) || !(body.previousId === null || typeof body.previousId === 'string')) throw invalid();
                        const p = { id: action === 'add' ? randomUUID() : id!, name: body.name.trim().replace(/\s+/g, ' '), email: body.email.trim().toLowerCase(), previousId: body.previousId };
                        if (action === 'add') state.participants.push(p); else state.participants[index] = p;
                    }
                }
            }
            this.validate(state);
            const added = scope && action === 'add' ? state.participants[state.participants.length - 1] : undefined;
            const newPerson = added && !('personId' in body) ? { ...added, active: true } : undefined;
            if (newPerson) await this.database(db => this.uniquePerson(db, scope!.groupId, newPerson));
            await this.write(state, scope, newPerson);
            return this.view(scope ? await this.read(scope) : state, scope);
        }, true, scope);
    }
}
