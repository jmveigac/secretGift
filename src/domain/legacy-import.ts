import { randomUUID } from 'node:crypto';
import { validateState, type State, type Person, type Edition } from './editions';

export class ImportError extends Error {}
function fail(message: string): never { throw new ImportError(message); }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function keys(value: Record<string, unknown>, allowed: string[]) {
    if (Object.keys(value).some(k => !allowed.includes(k))) fail('El archivo contiene campos no admitidos.');
}
export interface LegacyRecord { name: string; email: string; lastGift: string }
type Identity = { record: number; personId: string } | { record: number; new: true } | { record: number; skip: true };
export interface ImportPlan {
    mode: 'manual' | 'assignments';
    target: { groupId: string } | { newGroup: string };
    edition: { name: string; year: number };
    identities: Identity[];
    history?: { completedAt: string; sequence: number };
}
export interface ImportEdition { edition: Edition; state: State; sequence: number | null }
export interface ImportContext { people: Person[]; editions: ImportEdition[] }
const uuid = (s: unknown): s is string => typeof s === 'string' && /^[\da-f-]{36}$/.test(s);
const name = (s: unknown): s is string => typeof s === 'string' && !!s && s.length <= 100 && s === s.trim().replace(/\s+/g, ' ') && !/[\x00-\x1f\x7f]/.test(s);

export function parseLegacy(value: unknown): LegacyRecord[] {
    if (!Array.isArray(value) || !value.length || value.length > 100) fail('Se requiere una lista de entre 1 y 100 registros.');
    const records: LegacyRecord[] = [];
    const names = new Set(), emails = new Set();
    for (const row of value as unknown[]) {
        if (!object(row)) fail('Registro incompleto o incorrecto.');
        keys(row, ['name', 'email', 'lastGift']);
        if (!name(row.name) || typeof row.email !== 'string' || row.email.length > 254 || /[\s\x00-\x1f\x7f]/.test(row.email)
            || !/^[^@]+@[^@]+\.[^@]+$/.test(row.email) || typeof row.lastGift !== 'string' || (row.lastGift !== '' && !name(row.lastGift))) fail('Registro incompleto o incorrecto.');
        if (names.has(row.name.toLowerCase()) || emails.has(row.email.toLowerCase())) fail('Hay nombres o correos duplicados en el origen.');
        names.add(row.name.toLowerCase()); emails.add(row.email.toLowerCase());
        records.push({ name: row.name, email: row.email, lastGift: row.lastGift });
    }
    for (const row of records) if (row.lastGift && (row.lastGift === row.name || !records.some(r => r.name === row.lastGift))) fail('Una referencia de destinatario es incorrecta o ambigua.');
    return records;
}

export function parseImportPlan(value: unknown, count: number): ImportPlan {
    if (!object(value)) fail('Plan de importación incorrecto.');
    keys(value, ['mode', 'target', 'edition', 'identities', 'history']);
    if (value.mode !== 'manual' && value.mode !== 'assignments') fail('Declara el tipo: manual o assignments; no se deduce del nombre del archivo.');
    if (!object(value.target)) fail('Declara un grupo de destino.');
    keys(value.target, ['groupId', 'newGroup']);
    if (!(uuid(value.target.groupId) && Object.keys(value.target).length === 1)
        && !(name(value.target.newGroup) && Object.keys(value.target).length === 1)) fail('Selecciona un grupo existente o un nombre para uno nuevo.');
    if (!object(value.edition)) fail('Declara nombre y año de la edición.');
    keys(value.edition, ['name', 'year']);
    if (!name(value.edition.name) || !Number.isInteger(value.edition.year) || Number(value.edition.year) < 1 || Number(value.edition.year) > 9999) fail('Nombre o año de edición incorrectos.');
    if (!Array.isArray(value.identities) || value.identities.length !== count) fail('Cada registro necesita una asociación explícita, new o skip.');
    const seen = new Set(), ids = new Set();
    for (const item of value.identities as unknown[]) {
        if (!object(item)) fail('Asociación de identidad incorrecta.');
        keys(item, ['record', 'personId', 'new', 'skip']);
        if (!Number.isInteger(item.record) || Number(item.record) < 0 || Number(item.record) >= count || seen.has(item.record) || Object.keys(item).length !== 2
            || !(uuid(item.personId) || item.new === true || item.skip === true)) fail('Asociación de identidad incorrecta.');
        seen.add(item.record);
        if (item.personId) { if (ids.has(item.personId)) fail('Dos registros no pueden representar la misma identidad.'); ids.add(item.personId); }
    }
    if (value.mode === 'assignments') {
        if (!object(value.history)) fail('Las asignaciones requieren fecha y hora reales conocidas y posición histórica verificable; el año no basta.');
        keys(value.history, ['completedAt', 'sequence']);
        const date = value.history.completedAt;
        if (typeof date !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(date) || !Number.isFinite(Date.parse(date))
            || new Date(date).toISOString() !== date || Date.parse(date) > Date.now()) fail('Se requiere fecha y hora históricas reales en UTC; no se admite solo el año o el día.');
        if (!Number.isSafeInteger(value.history.sequence) || Number(value.history.sequence) < 1) fail('Se requiere una posición histórica positiva explícita.');
    } else if (value.history !== undefined) fail('Las restricciones manuales no representan un sorteo ni tienen posición histórica.');
    return value as unknown as ImportPlan;
}

function signature(records: LegacyRecord[]) {
    return JSON.stringify(records.map(r => [r.name, r.email.toLowerCase(), r.lastGift]).sort((a, b) => a[0].localeCompare(b[0])));
}

/** No storage writes: identities are explicit; contact matches only detect conflicts. */
export function prepareLegacyImport(records: LegacyRecord[], plan: ImportPlan, context: ImportContext, max: number) {
    if (plan.mode === 'assignments' && (records.some(r => !r.lastGift) || new Set(records.map(r => r.lastGift)).size !== records.length)) fail('El origen completo debe contener una permutación de asignaciones, incluso si se omiten registros.');
    const selected = plan.identities.filter(i => !('skip' in i)).sort((a, b) => a.record - b.record);
    if (!selected.length || selected.length > max) fail('La selección está vacía o supera el límite de participantes.');
    const newPeople: Person[] = [];
    const participants = selected.map(mapping => {
        const row = records[mapping.record];
        let id: string;
        if ('personId' in mapping) {
            if (!context.people.some(p => p.id === mapping.personId)) fail(`Registro ${mapping.record}: una identidad no pertenece al grupo de destino.`);
            id = mapping.personId;
        } else {
            if (context.people.some(p => p.name.toLowerCase() === row.name.toLowerCase() || p.email.toLowerCase() === row.email.toLowerCase())) fail(`Registro ${mapping.record}: existe un contacto coincidente; asócialo explícitamente u omítelo.`);
            id = randomUUID(); newPeople.push({ id, name: row.name, email: row.email, active: true });
        }
        return { id, name: row.name, email: row.email, previousId: null as string | null };
    });
    const state: State = { version: 1, participants, draw: null };
    const assignments: { giver: string; receiver: string }[] = [];
    selected.forEach((mapping, index) => {
        const row = records[mapping.record], receiver = participants.find(p => p.name === row.lastGift);
        if (row.lastGift && !receiver) fail('No se puede omitir un destinatario referenciado; omite también sus referencias o revisa la selección.');
        if (plan.mode === 'manual') participants[index].previousId = receiver?.id ?? null;
        else {
            if (!receiver) fail('Las asignaciones necesitan un destinatario para cada participante.');
            assignments.push({ giver: participants[index].id, receiver: receiver.id });
        }
    });
    if (plan.mode === 'assignments') state.draw = {
        completedAt: plan.history!.completedAt, deliveryRevision: randomUUID(), assignments,
        // Unknown is operational uncertainty, never evidence of delivery or failure.
        deliveries: Object.fromEntries(participants.map(p => [p.id, 'uncertain' as const]))
    };
    try { validateState(state, max); } catch { fail('El origen no representa un estado válido o una permutación completa sin autoasignaciones.'); }
    if (context.editions.some(e => e.edition.year === plan.edition.year && e.edition.name.toLowerCase() === plan.edition.name.toLowerCase())) fail('Ya existe una edición con ese nombre y año; no se sobrescribe.');
    const source = signature(selected.map(m => records[m.record]));
    for (const existing of context.editions) {
        if (!!existing.state.draw !== (plan.mode === 'assignments')) continue;
        if (existing.state.draw && Date.parse(existing.state.draw.completedAt) !== Date.parse(plan.history!.completedAt)) continue;
        const rows = existing.state.participants.map(p => {
            const receiverId = existing.state.draw ? existing.state.draw.assignments.find(a => a.giver === p.id)?.receiver : p.previousId;
            return { name: p.name, email: p.email, lastGift: existing.state.participants.find(r => r.id === receiverId)?.name ?? '' };
        });
        if (signature(rows) === source) fail('Estos datos ya están representados en una edición del grupo.');
    }
    if (state.draw) {
        const seq = plan.history!.sequence, instant = Date.parse(state.draw.completedAt);
        for (const existing of context.editions.filter(e => e.state.draw)) {
            if (existing.sequence === null) fail('El grupo contiene sorteos de orden desconocido; no puede verificarse la posición importada.');
            if (existing.sequence === seq) fail('La posición histórica ya está ocupada; no se reordena el historial.');
            const time = Date.parse(existing.state.draw!.completedAt);
            if ((existing.sequence < seq && time > instant) || (existing.sequence > seq && time < instant)) fail('La fecha declarada no es compatible con la posición histórica.');
        }
        // Check the imported draw and successors without rewriting existing frozen snapshots.
        const timeline = [...context.editions.filter(e => e.state.draw && e.sequence !== null).map(e => ({ sequence: e.sequence!, state: e.state })), { sequence: seq, state }].sort((a, b) => a.sequence - b.sequence);
        const history = new Map<string, string>();
        for (const entry of timeline) {
            const ids = new Set(entry.state.participants.map(p => p.id));
            for (const a of entry.state.draw!.assignments) {
                if (entry.sequence >= seq && history.get(a.giver) === a.receiver && ids.has(a.receiver)) fail('Las asignaciones importadas son incompatibles con las restricciones del historial.');
            }
            if (entry.state === state) state.draw.restrictions = Object.fromEntries(participants.map(p => [p.id, ids.has(history.get(p.id) ?? '') ? history.get(p.id)! : null]));
            for (const a of entry.state.draw!.assignments) history.set(a.giver, a.receiver);
        }
        try { validateState(state, max); } catch { fail('Las asignaciones incumplen las restricciones históricas.'); }
    }
    return { state, newPeople, skipped: records.length - selected.length };
}
