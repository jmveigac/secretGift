/** Public API contracts: current draw assignments must never be included here. */
export interface Participant {
    id: string;
    name: string;
    email: string;
    previousId: string | null;
}
export type ParticipantInput = Omit<Participant, 'id'>;
export interface StateResponse {
    participants: Participant[];
    maxParticipants: number;
    draw: { completed: false; participantCount: number } | {
        completed: true;
        participantCount: number;
        completedAt: string;
    };
}
