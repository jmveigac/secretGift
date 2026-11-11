/** Public API contracts: current draw assignments must never be included here. */
import type { Participant } from '../domain/editions';
import type { Group, Person, Edition } from '../domain/editions';
export type { Group, Person, Edition } from '../domain/editions';
export type { Participant } from '../domain/editions';
export type ParticipantInput = Omit<Participant, 'id'>;
export interface StateResponse {
    scope?: EditionScope;
    revision?: string;
    delivery?: {
        revision: string;
        configured: boolean;
        active: boolean;
        pending: number;
        uncertain: number;
        accepted: number;
        failed: number;
    };
    participants: Participant[];
    maxParticipants: number;
    draw: { completed: false; participantCount: number } | {
        completed: true;
        participantCount: number;
        completedAt: string;
    };
}
export interface EditionScope { groupId: string; editionId: string }
export interface EditionSummary { edition: Edition; draw: StateResponse['draw']; delivery: StateResponse['delivery'] }
export interface GroupResponse {
    group: Group;
    people: Person[];
    editions: EditionSummary[];
    revision: string;
    maxParticipants: number;
    busy: boolean;
}
