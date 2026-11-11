import nodemailer = require('nodemailer');
import 'dotenv/config';
import { assignmentContent } from './mail-template';

export interface AssignmentMessage { to: string; name: string; receiver: string }
export interface MailSender { configured: boolean; send(message: AssignmentMessage): Promise<'accepted' | 'failed' | 'uncertain'> }

// Same private environment variables as the legacy CLI. Never return their values.
export function smtpSender(env = process.env): MailSender {
    const port = Number(env.PORT);
    const clean = (value: string | undefined) => !!value && !/[\r\n\x00]/.test(value);
    const configured = clean(env.HOST) && !/\s/.test(env.HOST!) && clean(env.FROM) && /^[^\r\n]*[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(env.FROM!) && Number.isInteger(port) && port > 0 && port <= 65535
        && !!env.MAILUSER === !!env.MAILPWD;
    return {
        configured,
        async send(message) {
            if (!configured) throw new Error('SMTP unavailable');
            const transport = nodemailer.createTransport({
                host: env.HOST, port, secure: port === 465,
                auth: env.MAILUSER ? { user: env.MAILUSER, pass: env.MAILPWD } : undefined,
                connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
            });
            try {
                const result = await transport.sendMail({
                    from: env.FROM, to: message.to, subject: 'Amigo invisible',
                    ...assignmentContent(message.name, message.receiver),
                });
                return result.accepted?.length === 1 ? 'accepted' : 'failed';
            } catch (error) {
                // Only a definite SMTP rejection is safe to retry automatically.
                const code = (error as { responseCode?: number }).responseCode;
                return code && code >= 400 && code <= 599 ? 'failed' : 'uncertain';
            } finally { transport.close(); }
        },
    };
}
