import * as dotenv from 'dotenv';
import nodemailer from 'nodemailer';

dotenv.config();

export async function sendMail(mailDestiny, subject, text, html) {
    try {
        let transporter = nodemailer.createTransport({
            host: process.env.HOST,
            port: process.env.PORT,
            secure: true, // true for 465, false for other ports
            auth: {
                user: process.env.MAILUSER,
                pass: process.env.MAILPWD
            },
        });

        let info = await transporter.sendMail({
            from: process.env.FROM, // sender address
            to: mailDestiny, // list of receivers
            subject: subject, // Subject line
            text: text, // plain text body
            html: html, // html body
        });
    } catch (error) {
        console.log(error);
    }
}