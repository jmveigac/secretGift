import crypto from 'crypto';
import Mail from './models/mail';
import Participants from './models/participants';
import { readJson, writeJson } from './utils/commonUtils';
import envUtils from './utils/envUtils';
import { createHtmlMessage } from './utils/messageUtils';
import { confirmUser, readUserData } from './utils/userInterfaceUtils';

import { drawParticipants } from './domain/draw';

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

export const createNewSecretGiftList = (participants: Participants[]): Participants[] =>
    drawParticipants(participants, max => crypto.randomInt(max));

export const createMailList = (participants: Participants[]): Mail[] => {
    return participants.map(participant => ({
        participantName: participant.name,
        destinyMail: participant.email,
        subject: `${envUtils.SUBJECT} ${new Date().getFullYear()}`,
        messageText: `Este año tu amigo invisible es: ${participant.lastGift} No olvides los regalos :D`,
        messageHtml: createHtmlMessage(participant, participant.lastGift)
    }));
};
