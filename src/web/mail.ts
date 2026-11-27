import 'dotenv/config';
import type { Schedule } from '../domain/schedule';
import { assignmentContent } from '../mail/assignment-template';
import { smtpDelivery, isSmtpRateLimit, type AppMode } from '../mail/delivery';

export interface AssignmentMessage { to: string; name: string; receiver: string; schedule?: Schedule; reminder?: boolean }
export interface MailSender {
    configured: boolean;
    mode?: AppMode;
    testEmail?: string;
    configurationError?: string;
    session?: string;
    controlsAttemptStart?: true;
    send(message: AssignmentMessage, beforeAttempt?: () => Promise<void>, signal?: AbortSignal): Promise<'accepted' | 'failed' | 'uncertain' | 'rateLimited'>;
}

export function smtpSender(env = process.env): MailSender {
    const delivery = smtpDelivery(env);
    return {
        ...delivery,
        controlsAttemptStart: true,
        async send(message, beforeAttempt, signal) {
            try {
                const result = await delivery.send({ to: message.to, participant: message.name,
                    subject: 'Amigo invisible', ...assignmentContent(message.name, message.receiver, message) }, beforeAttempt, signal);
                return result.accepted?.length === 1 ? 'accepted' : 'failed';
            } catch (error) {
                if (isSmtpRateLimit(error)) return 'rateLimited';
                const code = (error as { responseCode?: number }).responseCode;
                return code && code >= 400 && code <= 599 ? 'failed' : 'uncertain';
            }
        },
    };
}
