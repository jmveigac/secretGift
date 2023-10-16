import nodemailer, { TransportOptions } from 'nodemailer';
import envUtils from './utils/envUtils';
import Mail from './models/mail';

export const sendMail = async (mail: Mail) => {
    try {
        const transporter = nodemailer.createTransport({
            host: envUtils.HOST,
            port: envUtils.PORT,
            secure: true,//true for 465, false for other ports
            auth: {
                user: envUtils.MAILUSER,
                pass: envUtils.MAILPWD
            }
        } as TransportOptions);

        const info = await transporter.sendMail({
            from: envUtils.FROM,
            to: envUtils.TESTMAIL,//mail.destinyMail,
            subject: mail.subject,
            text: mail.messageText,
            html: mail.messageHtml
        });

        return info;
    } catch (error) {
        console.log(error);
    }
};