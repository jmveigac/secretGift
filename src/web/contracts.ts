import type { Schedule } from '../domain/schedule';
/** General responses never include assignments. Results are a separate, time-gated response. */
import type { Participant } from '../domain/editions';
import type { Group, Person, Edition } from '../domain/editions';
export type { Group, Person, Edition } from '../domain/editions';
export type { Participant } from '../domain/editions';
export type ParticipantInput = Omit<Participant, 'id'>;
export interface StateResponse {
    schedule?: Schedule;
    results?: { available: boolean; reason: 'scheduled' | 'missing-date' | 'unconfirmed' };
    campaigns?: CampaignSummary[];
    scope?: EditionScope;
    revision?: string;
    delivery?: {
        revision: string;
        configured: boolean;
        mode?: 'test' | 'production';
        testEmail?: string;
        configurationError?: string;
        production?: { pending: number; uncertain: number; accepted: number; failed: number };
        test?: { pending: number; uncertain: number; accepted: number; failed: number };
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
export interface EditionSummary { edition: Edition; draw: StateResponse['draw']; delivery: StateResponse['delivery']; results?: StateResponse['results'] }
export interface GroupResponse {
    group: Group;
    people: Person[];
    editions: EditionSummary[];
    revision: string;
    maxParticipants: number;
    busy: boolean;
}

export interface DeliveryCounts { pending: number; accepted: number; failed: number; uncertain: number }
export interface CampaignSummary extends DeliveryCounts { id: string; createdAt: string; mode: 'test' | 'production'; revision: string }
export interface ResultsResponse { assignments: { giver: { id: string; name: string }; receiver: { id: string; name: string } }[] }
export interface RestrictionPreview { schedule?: Schedule; viable: boolean; restrictions: { personId: string; source: 'verified' | 'manual' | 'none'; previousId?: string }[] }
