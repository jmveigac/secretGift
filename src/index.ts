import { createMailList, newDrawParticipants } from './drawParticipants';
import Participants from './models/participants';
import { isSmtpRateLimit, smtpDelivery } from './mail/delivery';
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
    const delivery = smtpDelivery();
    if (delivery.configurationError) throw new Error(delivery.configurationError);
    let failed = 0;
    for (const [index, mail] of mailList.entries()) {
        try { await sendMail(mail, delivery); }
        catch (error) {
            failed++;
            if (isSmtpRateLimit(error)) {
                throw new Error(`SMTP limitó el envío. ${mailList.length - index - 1} mensajes quedaron sin intentar.`);
            }
        }
        console.log(`SMTP: ${index + 1} de ${mailList.length} intentos procesados.`);
    }
    if (failed > 0) throw new Error(`${failed} emails could not be sent`);
}
