import type Participants from '../models/participants';

const normalize = (name: string) => name.trim().replace(/\s+/g, ' ');

/** Randomized augmenting-path matching: O(n³), with no probabilistic failure. */
export const drawParticipants = (participants: Participants[], randomInt: (max: number) => number): Participants[] => {
    if (!Array.isArray(participants) || participants.length < 2) throw new Error('At least two participants are required');
    if (participants.some(p => !p || typeof p.name !== 'string' || !normalize(p.name) || p.name.length > 100 || /[\x00-\x1f\x7f]/.test(p.name) || typeof p.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email) || p.email.length > 254 || /[\x00-\x1f\x7f]/.test(p.email) || typeof p.lastGift !== 'string')) throw new Error('Invalid participant');
    const names = participants.map(p => normalize(p.name));
    if (new Set(names.map(n => n.toLowerCase())).size !== names.length) throw new Error('Participant names must be unique');
    if (new Set(participants.map(p => p.email.toLowerCase())).size !== names.length) throw new Error('Participant emails must be unique');
    if (participants.some((p, i) => p.lastGift && (!names.includes(normalize(p.lastGift)) || normalize(p.lastGift) === names[i]))) throw new Error('Invalid previous recipient');
    const edges = participants.map((p, i) => {
        const candidates = names.map((_, j) => j).filter(j => j !== i && names[j] !== normalize(p.lastGift));
        for (let k = candidates.length - 1; k > 0; k--) {
            const j = randomInt(k + 1);
            if (!Number.isInteger(j) || j < 0 || j > k) throw new Error('Invalid random source');
            [candidates[k], candidates[j]] = [candidates[j], candidates[k]];
        }
        return candidates;
    });
    const owners = new Array<number>(participants.length).fill(-1);
    const assign = (giver: number, seen: Set<number>): boolean => {
        for (const receiver of edges[giver]) {
            if (seen.has(receiver)) continue;
            seen.add(receiver);
            if (owners[receiver] === -1 || assign(owners[receiver], seen)) { owners[receiver] = giver; return true; }
        }
        return false;
    };
    for (let i = 0; i < participants.length; i++) if (!assign(i, new Set())) throw new Error('Unable to create a valid Secret Santa draw with the current restrictions');
    const result = participants.map(p => ({ ...p }));
    owners.forEach((giver, receiver) => { result[giver].lastGift = participants[receiver].name; });
    return result;
};
