const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate } = require('node:timers/promises');
const nodemailer = require('nodemailer');

const env = { APP_MODE: 'test', TEST_EMAIL: 'test@example.invalid', HOST: 'smtp.example.invalid', PORT: '465', FROM: 'sender@example.invalid' };
const message = { to: 'fictitious@example.invalid', subject: 'Synthetic', text: 'Synthetic', html: '<p>Synthetic</p>', participant: 'Synthetic' };

test('SMTP policy uses a shared monotonic interval from transport close, including failure', async t => {
    let clock = 1000;
    const timers = [];
    t.mock.method(require('node:timers/promises'), 'setTimeout', ms => new Promise(resolve => {
        timers.push({ at: clock + ms, resolve });
    }));
    t.mock.method(performance, 'now', () => clock);
    const { smtpDelivery } = require('../build/mail/delivery');
    const events = [];
    let release, active = 0, maximum = 0, transports = 0;
    t.mock.method(nodemailer, 'createTransport', () => {
        const index = ++transports;
        maximum = Math.max(maximum, ++active);
        events.push(['start', index, clock]);
        return {
            async sendMail(mail) {
                assert.deepEqual(mail.envelope.to, [env.TEST_EMAIL]);
                if (index === 1) await new Promise(resolve => { release = resolve; });
                if (index === 2) throw new Error('synthetic rejection');
                return { accepted: [mail.to] };
            },
            close() {
                clock += 25;
                active--;
                events.push(['close', index, clock]);
            },
        };
    });
    const advance = async ms => {
        clock += ms;
        while (timers[0]?.at <= clock) timers.shift().resolve();
        await setImmediate();
    };
    const one = smtpDelivery(env).send(message);
    const two = assert.rejects(smtpDelivery(env).send(message), /synthetic rejection/);
    let prepared = false;
    const three = smtpDelivery({ ...env, SMTP_SEND_INTERVAL_MS: '250' }).send(message, async () => { prepared = true; });
    const four = smtpDelivery({ ...env, SMTP_SEND_INTERVAL_MS: '0' }).send(message);
    await setImmediate();
    assert.deepEqual(events, [['start', 1, 1000]]);
    await advance(500);
    assert.equal(transports, 1);
    release();
    await one;
    await setImmediate();
    assert.deepEqual(events[1], ['close', 1, 1525]);
    await advance(9999);
    assert.equal(transports, 1);
    await advance(1);
    await two;
    assert.deepEqual(events[2], ['start', 2, 11525]);
    assert.deepEqual(events[3], ['close', 2, 11550]);
    await advance(249);
    assert.equal(prepared, false);
    await advance(1);
    await Promise.all([three, four]);
    assert.equal(prepared, true);
    assert.deepEqual(events.slice(4), [['start', 3, 11800], ['close', 3, 11825], ['start', 4, 11825], ['close', 4, 11850]]);
    assert.equal(maximum, 1);
    assert.equal(active, 0);
});

test('SMTP interval rejects malformed and out-of-range configuration in both modes', () => {
    const { smtpDelivery } = require('../build/mail/delivery');
    for (const mode of ['test', 'production']) {
        for (const value of ['', '-1', '1.1', 'Infinity', 'NaN', '1e2', ' 12', '60001']) {
            assert.match(smtpDelivery({ ...env, APP_MODE: mode, SMTP_SEND_INTERVAL_MS: value }).configurationError, /SMTP_SEND_INTERVAL_MS/);
        }
        for (const value of [undefined, '0', '10000', '60000']) {
            assert.equal(smtpDelivery({ ...env, APP_MODE: mode, SMTP_SEND_INTERVAL_MS: value }).configured, true);
        }
    }
});
