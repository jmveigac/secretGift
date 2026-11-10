import type Participants from '../models/participants';

const MAX_DRAW_ATTEMPTS = 1000;

export const drawParticipants = (participants: Participants[], randomInt: (max: number) => number): Participants[] => {
    validateParticipants(participants);

    for (let attempt = 0; attempt < MAX_DRAW_ATTEMPTS; attempt++) {
        const shuffledReceivers = shuffleParticipants(participants, randomInt);
        const isValidDraw = participants.every((participant, index) => isValidReceiver(participant, shuffledReceivers[index]));

        if (isValidDraw) {
            return participants.map((participant, index) => ({
                name: participant.name,
                email: participant.email,
                lastGift: shuffledReceivers[index].name,
            }));
        }
    }

    throw new Error('Unable to create a valid Secret Santa draw with the current restrictions');
};

const validateParticipants = (participants: Participants[]) => {
    if (participants.length < 2) {
        throw new Error('At least two participants are required');
    }

    const names = participants.map(participant => participant.name.trim());
    const uniqueNames = new Set(names);

    if (uniqueNames.size !== participants.length) {
        throw new Error('Participant names must be unique');
    }
};

const shuffleParticipants = (participants: Participants[], randomInt: (max: number) => number): Participants[] => {
    const shuffled = [...participants];

    for (let index = shuffled.length - 1; index > 0; index--) {
        const randomIndex = randomInt(index + 1);
        [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
    }

    return shuffled;
};

const isValidReceiver = (selector: Participants, selected: Participants): boolean => {
    return selector.name !== selected.name && selector.lastGift !== selected.name;
};
