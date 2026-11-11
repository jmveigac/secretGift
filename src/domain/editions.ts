export interface Participant {
    id: string;
    name: string;
    email: string;
    previousId: string | null;
}

export type Delivery = 'pending' | 'uncertain' | 'accepted' | 'failed';
export interface Group { id: string; name: string }
export interface Person { id: string; name: string; email: string; active: boolean }
export interface Edition { id: string; groupId: string; name: string; year: number }
export interface State { version: 1; participants: Participant[]; draw: null | { completedAt: string; assignments: { giver: string; receiver: string }[]; deliveryRevision?: string; deliveries?: Record<string, Delivery> } }

export function validateState(state: State, max = 100) {
    if (!state || state.version !== 1 || !Array.isArray(state.participants) || state.participants.length > max) throw new Error('Invalid edition state');
    const ids = new Set<string>(), names = new Set<string>(), emails = new Set<string>();
    for (const p of state.participants) {
        if (!p || typeof p.id !== 'string' || !/^[\da-f-]{36}$/.test(p.id) || ids.has(p.id) || typeof p.name !== 'string' || !p.name || p.name !== p.name.trim().replace(/\s+/g, ' ') || p.name.length > 100 || /[\x00-\x1f\x7f]/.test(p.name) || typeof p.email !== 'string' || p.email.length > 254 || /[\x00-\x1f\x7f]/.test(p.email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email) || names.has(p.name.toLowerCase()) || emails.has(p.email.toLowerCase())) throw new Error('Invalid edition state');
        ids.add(p.id); names.add(p.name.toLowerCase()); emails.add(p.email.toLowerCase());
    }
    for (const p of state.participants) if (p.previousId !== null && (!ids.has(p.previousId) || p.previousId === p.id)) throw new Error('Invalid edition state');
    if (state.draw !== null) {
        const d = state.draw;
        if (!d || typeof d.completedAt !== 'string' || !Number.isFinite(Date.parse(d.completedAt)) || !Array.isArray(d.assignments) || d.assignments.length !== ids.size || ids.size < 2) throw new Error('Invalid edition state');
        if (d.deliveryRevision !== undefined && (typeof d.deliveryRevision !== 'string' || !/^[\da-f-]{36}$/.test(d.deliveryRevision))) throw new Error('Invalid edition state');
        if (d.deliveries !== undefined && (!d.deliveries || typeof d.deliveries !== 'object' || Array.isArray(d.deliveries) || Object.keys(d.deliveries).length !== ids.size || Object.entries(d.deliveries).some(([id, status]) => !ids.has(id) || !['pending', 'uncertain', 'accepted', 'failed'].includes(status)))) throw new Error('Invalid edition state');
        const g = new Set(), r = new Set();
        for (const a of d.assignments) {
            if (!a || !ids.has(a.giver) || !ids.has(a.receiver) || a.giver === a.receiver || state.participants.find(p => p.id === a.giver)?.previousId === a.receiver || g.has(a.giver) || r.has(a.receiver)) throw new Error('Invalid edition state');
            g.add(a.giver); r.add(a.receiver);
        }
    }
}
