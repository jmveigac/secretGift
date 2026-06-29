import nodemailer, { TransportOptions } from 'nodemailer';
import envUtils from './utils/envUtils';
import Mail from './models/mail';

export const sendMail = async (mail: Mail) => {
    const transporter = nodemailer.createTransport({
        host: envUtils.HOST,
        port: Number(envUtils.PORT),
        secure: Number(envUtils.PORT) === 465,
        auth: {
            user: envUtils.MAILUSER,
            pass: envUtils.MAILPWD
        }
    } as TransportOptions);

    return transporter.sendMail({
        from: envUtils.FROM,
        to: mail.destinyMail,
        subject: mail.subject,
        text: mail.messageText,
        html: mail.messageHtml
    });
};
