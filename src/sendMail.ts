import 'dotenv/config';
import Mail from './models/mail';
import { smtpDelivery } from './mail/delivery';

export const sendMail = async (mail: Mail) => smtpDelivery().send({
    to: mail.destinyMail, participant: mail.participantName ?? 'Participante de la CLI',
    subject: mail.subject, text: mail.messageText, html: mail.messageHtml,
});
