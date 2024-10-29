import Mail from './models/mail';
import Participants from './models/participants';
import { arrayCopy, readJson, writeJson } from './utils/commonUtils';
import envUtils from './utils/envUtils';
import { createHtmlMessage } from './utils/messageUtils';
import { confirmUser, readUserData } from './utils/userInterfaceUtils';

export const newDrawParticipants = async (): Promise<Participants[]> => {
    let participants: Participants[] = [];
    const loadJsonFile = await confirmUser('Would you like to load a JSON file?');

    if (loadJsonFile === 'y') {
        const pathJson = `${__dirname}/../participants.json`;// await readUserData('Introduce the path to the JSON file');
        participants = readJson(pathJson);
    }
    else {
        const participantsNumber = parseInt(await readUserData('How many participants'));
        let participants: Participants[] = [];

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
    let newSecretList: Participants[] = [];
    let auxList = arrayCopy(participants);
    let listSelected: string[] = [];

    participants.forEach(participant => {
        const result = selectGift(participant, auxList, listSelected);
        listSelected.push(result);
        newSecretList.push({
            name: participant.name,
            email: participant.email,
            lastGift: result
        });
    });

    return newSecretList;
};

export const createMailList = (participants: Participants[]): Mail[] => {
    let listMails: Mail[] = [];

    participants.forEach(participant => {
        listMails.push({
            destinyMail: participant.email,
            subject: `${envUtils.SUBJECT} ${new Date().getFullYear()}`,
            messageText: `Este año tu amigo invisible es: ${participant.lastGift} No olvides los regalos :D`,
            messageHtml: createHtmlMessage(participant, participant.lastGift)
        });
    });

    return listMails;
};

const selectGift = (selector: Participants, listToSelect: Participants[], listExclude: string[]): string => {
    const num = Math.floor(Math.random() * listToSelect.length);
    let selected = listToSelect[num > listToSelect.length ? listToSelect.length : num];

    if (selector.name == selected.name) return selectGift(selector, listToSelect, listExclude);
    if (selector.lastGift == selected.name) return selectGift(selector, listToSelect, listExclude);
    if (listExclude.length > 0 && listExclude.includes(selected.name)) return selectGift(selector, listToSelect, listExclude);

    return selected.name;
};