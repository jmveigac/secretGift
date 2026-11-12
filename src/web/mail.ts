import 'dotenv/config';
import { assignmentContent } from './mail-template';
import { smtpDelivery, type AppMode } from '../mail/delivery';

export interface AssignmentMessage { to: string; name: string; receiver: string }
export interface MailSender {
    configured: boolean;
    mode?: AppMode;
    testEmail?: string;
    configurationError?: string;
    session?: string;
    send(message: AssignmentMessage): Promise<'accepted' | 'failed' | 'uncertain'>;
}

export function smtpSender(env = process.env): MailSender {
    const delivery = smtpDelivery(env);
    return {
        ...delivery,
        async send(message) {
            try {
                const result = await delivery.send({ to: message.to, participant: message.name,
                    subject: 'Amigo invisible', ...assignmentContent(message.name, message.receiver) });
                return result.accepted?.length === 1 ? 'accepted' : 'failed';
            } catch (error) {
                const code = (error as { responseCode?: number }).responseCode;
                return code && code >= 400 && code <= 599 ? 'failed' : 'uncertain';
            }
        },
    };
}
