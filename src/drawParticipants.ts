import crypto from 'crypto';
import Mail from './models/mail';
import Participants from './models/participants';
import { readJson, writeJson } from './utils/commonUtils';
import envUtils from './utils/envUtils';
import { createHtmlMessage } from './utils/messageUtils';
import { confirmUser, readUserData } from './utils/userInterfaceUtils';

const MAX_DRAW_ATTEMPTS = 1000;

export const newDrawParticipants = async (): Promise<Participants[]> => {
    let participants: Participants[] = [];
    const loadJsonFile = await confirmUser('Would you like to load a JSON file?');

    if (loadJsonFile === 'y') {
        const pathJson = `${__dirname}/../participants.json`;// await readUserData('Introduce the path to the JSON file');
        participants = readJson(pathJson);
    }
    else {
        const participantsNumber = parseInt(await readUserData('How many participants'));

        for (let index = 0; index < participantsNumber; index++) {
            const participant: Participants = {
                name: await readUserData(`Participant ${index + 1} name`),
                email: await readUserData(`Participant ${index + 1} email`),
                lastGift: await readUserData(`Participant ${index + 1} last gifted`)
            };

            participants.push(participant);
        }
    }

    const newList = createNewSecretGiftList(participants);
    writeJson(newList);

    return newList;
};

export const createNewSecretGiftList = (participants: Participants[]): Participants[] => {
    validateParticipants(participants);

    for (let attempt = 0; attempt < MAX_DRAW_ATTEMPTS; attempt++) {
        const shuffledReceivers = shuffleParticipants(participants);
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

export const createMailList = (participants: Participants[]): Mail[] => {
    return participants.map(participant => ({
        destinyMail: participant.email,
        subject: `${envUtils.SUBJECT} ${new Date().getFullYear()}`,
        messageText: `Este año tu amigo invisible es: ${participant.lastGift} No olvides los regalos :D`,
        messageHtml: createHtmlMessage(participant, participant.lastGift)
    }));
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

const shuffleParticipants = (participants: Participants[]): Participants[] => {
    const shuffled = [...participants];

    for (let index = shuffled.length - 1; index > 0; index--) {
        const randomIndex = crypto.randomInt(index + 1);
        [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
    }

    return shuffled;
};

const isValidReceiver = (selector: Participants, selected: Participants): boolean => {
    return selector.name !== selected.name && selector.lastGift !== selected.name;
};
