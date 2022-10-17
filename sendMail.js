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
                user: process.env.USER,
                pass: process.env.PWD
            },
        });

        let info = await transporter.sendMail({
            from: process.env.FROM, // sender address
            to: mailDestiny, // list of receivers
            subject: subject, // Subject line
            text: text, // plain text body
            html: html, // html body
        });

        console.log("Message sent: %s", info.messageId);

        console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));

        const result = await transport.sendMail(mailOptions);
        res.send(result);
    } catch (error) {
        console.log(error);
    }
}