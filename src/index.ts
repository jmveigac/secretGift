import { createMailList, newDrawParticipants } from './drawParticipants';
import Participants from './models/participants';
import { sendMail } from './sendMail';
import { readJson } from './utils/commonUtils';
import { readUserData } from './utils/userInterfaceUtils';

init();

async function init() {
    const option = await readUserData('Que quiere hacer: 1 Nuevo Sorteo 2 Reenviar');
    if (option === '1')
        await process(await newDrawParticipants());
    else {
        const pathJson = `${__dirname}/../newParticipants.json`;// await readUserData('Introduce the path to the JSON file');
        await process(readJson(pathJson));
    }
};

async function process(participants: Participants[]) {
    const mailList = createMailList(participants);

    mailList.forEach(async mail => {
        const result = await sendMail(mail);
        // console.log('result: ', result);
    });
}
