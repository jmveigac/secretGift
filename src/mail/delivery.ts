import nodemailer = require('nodemailer');
import { randomUUID } from 'node:crypto';

export type AppMode = 'test' | 'production';
export interface OutgoingMessage { to: string; subject: string; text: string; html: string; participant: string }
const mailbox = (value: string | undefined): value is string => !!value && value.length <= 254
    && !value.startsWith('.') && !value.includes('..') && !value.includes('.@')
    && value.split('@')[0].length <= 64 && value.split('@')[1]?.split('.').every(label => label.length <= 63)
    && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(value);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function testHtml(html: string, notice: string): string {
    const banner = `<p>${escapeHtml(notice)}</p>`;
    // Web mail is a complete document; the legacy CLI supplies an HTML fragment.
    if (/<body\b[^>]*>/i.test(html)) return html.replace(/<body\b[^>]*>/i, opening => opening + banner);
    return `<!doctype html><html><head><meta charset="utf-8"></head><body>${banner}${html}</body></html>`;
}

/** All SMTP paths (web and CLI) must use this recipient boundary. */
export function smtpDelivery(environment = process.env) {
    const env = { ...environment };
    const mode: AppMode | undefined = env.APP_MODE === 'test' || env.APP_MODE === 'production' ? env.APP_MODE : undefined;
    const port = Number(env.PORT);
    const clean = (value: string | undefined) => !!value && !/[\r\n\x00]/.test(value);
    const smtpConfigured = clean(env.HOST) && !/\s/.test(env.HOST!) && clean(env.FROM)
        && /^[^\r\n]*[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(env.FROM!)
        && Number.isInteger(port) && port > 0 && port <= 65535 && !!env.MAILUSER === !!env.MAILPWD;
    const configurationError = !mode ? 'Configura APP_MODE explícitamente como test o production; los envíos están bloqueados.'
        : mode === 'test' && !mailbox(env.TEST_EMAIL) ? 'El modo pruebas requiere TEST_EMAIL con una única dirección válida.'
        : !smtpConfigured ? 'SMTP no está configurado. Configura las variables privadas y reinicia la aplicación.' : undefined;
    return {
        mode, configured: !configurationError, configurationError,
        testEmail: mode === 'test' && mailbox(env.TEST_EMAIL) ? env.TEST_EMAIL : undefined,
        // A confirmation from a previous process/configuration can never authorize a new send.
        session: randomUUID(),
        async send(message: OutgoingMessage) {
            if (configurationError) throw new Error(configurationError);
            const to = mode === 'test' ? env.TEST_EMAIL! : message.to;
            const from = env.FROM!;
            const envelopeFrom = /<([^<>]+)>$/.exec(from)?.[1] ?? from;
            const transport = nodemailer.createTransport({
                host: env.HOST, port, secure: port === 465,
                auth: env.MAILUSER ? { user: env.MAILUSER, pass: env.MAILPWD } : undefined,
                connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
            });
            try {
                const notice = `PRUEBA — Participante original: ${message.participant}`;
                return await transport.sendMail({
                    from, to, envelope: { from: envelopeFrom, to: [to] },
                    subject: mode === 'test' ? `[PRUEBA] ${message.subject}` : message.subject,
                    text: mode === 'test' ? `${notice}\n\n${message.text}` : message.text,
                    html: mode === 'test' ? testHtml(message.html, notice) : message.html,
                    disableFileAccess: true, disableUrlAccess: true,
                });
            } finally { transport.close(); }
        },
    };
}
