import nodemailer = require('nodemailer');
import { setTimeout as sleep } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';

export type AppMode = 'test' | 'production';
export interface OutgoingMessage { to: string; subject: string; text: string; html: string; participant: string }
const defaultInterval = 10_000;
const maxInterval = 60_000;
let tail = Promise.resolve();
let lastFinished: number | undefined;

async function serialized<T>(interval: number, attempt: () => Promise<T>, beforeAttempt?: () => Promise<void>, signal?: AbortSignal): Promise<T> {
    const operation = tail.then(async () => {
        signal?.throwIfAborted();
        if (lastFinished !== undefined) {
            const deadline = lastFinished + interval;
            while (performance.now() < deadline) await sleep(Math.ceil(deadline - performance.now()), undefined, { signal });
        }
        signal?.throwIfAborted();
        await beforeAttempt?.();
        try { return await attempt(); }
        finally { lastFinished = performance.now(); }
    });
    tail = operation.then(() => undefined, () => undefined);
    return operation;
}

export function isSmtpRateLimit(error: unknown): boolean {
    const response = (error as { response?: unknown } | null)?.response;
    return typeof response === 'string' && /\btransmit rate limit exceeded\b/i.test(response);
}

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
    const rawInterval = env.SMTP_SEND_INTERVAL_MS;
    const interval = rawInterval === undefined ? defaultInterval : /^\d+$/.test(rawInterval) ? Number(rawInterval) : NaN;
    const validInterval = Number.isInteger(interval) && interval >= 0 && interval <= maxInterval;
    const port = Number(env.PORT);
    const clean = (value: string | undefined) => !!value && !/[\r\n\x00]/.test(value);
    const smtpConfigured = clean(env.HOST) && !/\s/.test(env.HOST!) && clean(env.FROM)
        && /^[^\r\n]*[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(env.FROM!)
        && Number.isInteger(port) && port > 0 && port <= 65535 && !!env.MAILUSER === !!env.MAILPWD;
    const configurationError = !mode ? 'Configura APP_MODE explícitamente como test o production; los envíos están bloqueados.'
        : mode === 'test' && !mailbox(env.TEST_EMAIL) ? 'El modo pruebas requiere TEST_EMAIL con una única dirección válida.'
        : !validInterval ? 'SMTP_SEND_INTERVAL_MS debe ser un entero entre 0 y 60000.'
        : !smtpConfigured ? 'SMTP no está configurado. Configura las variables privadas y reinicia la aplicación.' : undefined;
    return {
        mode, configured: !configurationError, configurationError,
        testEmail: mode === 'test' && mailbox(env.TEST_EMAIL) ? env.TEST_EMAIL : undefined,
        // A confirmation from a previous process/configuration can never authorize a new send.
        session: randomUUID(),
        async send(message: OutgoingMessage, beforeAttempt?: () => Promise<void>, signal?: AbortSignal) {
            if (configurationError) throw new Error(configurationError);
            return serialized(interval, async () => {
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
            }, beforeAttempt, signal);
        },
    };
}
