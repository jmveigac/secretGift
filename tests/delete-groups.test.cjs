const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createApp } = require('../build/web/app');
const { waitForMail } = require('./helpers/mail-progress.cjs');
const { LocalStore } = require('../build/web/store');

const scopedTables = ['groups', 'people', 'editions', 'participants', 'draw', 'assignments', 'mail_campaigns', 'mail_operations', 'campaign_deliveries', 'compatibility'];
const sender = mode => ({ mode, configured: true, send: async () => 'accepted' });

async function fixture(t, mail = sender('test')) {
    await fs.mkdir('.task/tests', { recursive: true });
    const dir = await fs.mkdtemp(path.resolve('.task/tests/delete-group-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'data/state.sqlite'), key = path.join(dir, 'keys/storage.key');
    const createStore = (transport = mail) => new LocalStore(file, 15, transport, key);
    const store = createStore(), app = createApp(store);
    async function call(route, method = 'GET', body) {
        const response = await app.fetch(new Request('http://localhost/api' + route, {
            method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
        }));
        return { status: response.status, data: await response.json() };
    }
    async function write(route, method, body, status) {
        const response = await call(route, method, body);
        assert.equal(response.status, status, JSON.stringify(response.data));
        return response.data;
    }
    const group = id => '/groups/' + id;
    const summary = id => write(group(id) + '/deletion', 'GET', undefined, 200);
    const remove = (id, confirmation) => call(group(id), 'DELETE', confirmation);
    const confirmation = (s, name = s.name) => ({ expectedRevision: s.revision, confirmationName: name });
    const first = (await store.groups()).groups[0].id;
    async function addPeople(id, names) {
        let current = await store.group(id);
        for (const [index, name] of names.entries()) current = await write(group(id) + '/people', 'POST', {
            name, email: 'synthetic-' + index + '@example.invalid', expectedRevision: current.revision,
        }, 201);
        return current;
    }
    async function edition(id, name, confirmed) {
        const current = await store.group(id);
        const result = await write(group(id) + '/editions', 'POST', {
            name, year: 2030, personIds: current.people.filter(p => p.active).map(p => p.id), expectedRevision: current.revision,
            ...(confirmed ? { confirmDraw: true, schedule: { localDateTime: '2030-12-25T18:00', timeZone: 'Europe/Madrid' } } : {}),
        }, 201);
        return { groupId: id, editionId: result.editions.find(e => e.edition.name === name).edition.id };
    }
    function sql(read) {
        const db = new DatabaseSync(file);
        try { return read(db); } finally { db.close(); }
    }
    return { store, createStore, file, key, first, call, write, summary, remove, confirmation, addPeople, edition, sql };
}

const sendBody = state => ({ confirm: true, drawId: state.draw.completedAt, revision: state.delivery.revision, expectedRevision: state.revision });
const snapshot = db => Object.fromEntries([...scopedTables, 'metadata'].map(table => [
    table, db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all(),
]));
function integrity(db) {
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 6);
}

test('deletes an empty group and the last compatibility group, then reopens without an implicit target', async t => {
    const f = await fixture(t);
    const empty = (await f.store.manage('createGroup', { name: 'Vacío' })).group.id;
    const summary = await f.summary(empty);
    assert.deepEqual([summary.people, summary.editions, summary.campaigns], [0, 0, 0]);
    assert.equal((await f.remove(empty, f.confirmation(summary))).status, 200);
    f.sql(db => assert.equal(db.prepare('SELECT group_id FROM compatibility').get().group_id, f.first));
    assert.deepEqual((await f.remove(f.first, f.confirmation(await f.summary(f.first)))).data, { groups: [] });
    f.sql(db => {
        integrity(db);
        for (const [table, rows] of Object.entries(snapshot(db))) assert.equal(rows.length, table === 'metadata' ? 1 : 0, table);
    });
    const reopened = f.createStore();
    assert.deepEqual(await reopened.groups(), { groups: [] });
    for (const [route, method, body] of [['/state', 'GET'], ['/participants', 'POST', {}], ['/draw/send', 'POST', { confirm: true }]]) {
        assert.equal((await f.call(route, method, body)).status, 409);
    }
    const group = (await reopened.manage('createGroup', { name: 'Nuevo' })).group.id;
    await f.addPeople(group, ['Ana', 'Bea']);
    const scope = await f.edition(group, 'Vigente', true);
    const state = await reopened.status(scope);
    await reopened.mutate('reset', { confirm: true, expectedRevision: state.revision }, undefined, scope);
    assert.equal((await f.call('/state')).status, 409);
    f.sql(db => { integrity(db); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM compatibility').get().n, 0); });
});

test('physically removes history, directory, editions, campaigns and both delivery modes without changing another group', async t => {
    const f = await fixture(t);
    let selected = await f.addPeople(f.first, ['Ana', 'Bea', 'Cora', 'Dani']);
    const inactive = selected.people.at(-1);
    await f.store.manage('editPerson', { name: inactive.name, email: inactive.email, active: false, expectedRevision: selected.revision }, f.first, inactive.id);
    const history = await f.edition(f.first, 'Histórico', true);
    const recent = await f.edition(f.first, 'Reciente', true);
    await f.edition(f.first, 'Borrador', false);
    for (const mode of ['test', 'production']) {
        const store = f.createStore(sender(mode));
        await store.send(sendBody(await store.status(history)), history);
        await store.send(sendBody(await store.status(recent)), recent, 'new');
    }
    const other = (await f.store.manage('createGroup', { name: 'Otro' })).group.id;
    await f.addPeople(other, ['Eva', 'Fina']);
    await f.edition(other, 'Su edición', true);
    // An interrupted reservation can retain the running row after its process releases the lock.
    f.sql(db => db.prepare("UPDATE mail_operations SET status='running' WHERE edition_id=?").run(history.editionId));
    const before = f.sql(snapshot), key = await fs.readFile(f.key);
    const campaignIds = before.mail_campaigns.filter(r => r.group_id === f.first).map(r => r.id);
    assert.equal(campaignIds.length, 2);
    assert.ok(before.assignments.some(r => r.group_id === f.first && r.status === 'accepted' && r.test_status === 'accepted'));
    const s = await f.summary(f.first);
    assert.deepEqual([s.people, s.editions, s.campaigns], [4, 4, 2]);
    assert.equal((await f.remove(f.first, f.confirmation(s))).status, 200);
    f.sql(db => {
        integrity(db);
        for (const [table, rows] of Object.entries(snapshot(db))) {
            const expected = before[table].filter(row => table === 'groups' ? row.id !== f.first :
                table === 'campaign_deliveries' ? !campaignIds.includes(row.campaign_id) : row.group_id !== f.first);
            assert.deepEqual(rows, expected, table);
        }
    });
    assert.deepEqual(await fs.readFile(f.key), key);
    assert.equal((await f.call('/state')).status, 409);
    assert.equal((await f.call('/groups/' + other)).status, 200);
});

test('requires a current deletion revision and a case-sensitive normalized name, handles duplicate requests and rolls back failures', async t => {
    const f = await fixture(t);
    const original = await f.store.group(f.first);
    await f.store.manage('renameGroup', { name: '  Álbum  & Fiesta  ', expectedRevision: original.revision }, f.first);
    const stale = await f.summary(f.first);
    await f.addPeople(f.first, ['Ana']);
    const s = await f.summary(f.first);
    assert.equal((await f.remove(f.first, { confirmationName: s.name })).status, 400);
    assert.equal((await f.remove(f.first, f.confirmation(s, 'álbum & Fiesta'))).status, 400);
    assert.equal((await f.remove(f.first, f.confirmation(stale))).status, 409);
    const body = f.confirmation(s, ' Álbum   & Fiesta ');
    f.sql(db => db.exec("CREATE TRIGGER fail_removal BEFORE DELETE ON groups BEGIN SELECT RAISE(ABORT, 'private failure'); END"));
    const before = f.sql(snapshot);
    const failure = await f.remove(f.first, body);
    assert.equal(failure.status, 503);
    assert.doesNotMatch(JSON.stringify(failure.data), /private failure/);
    f.sql(db => { integrity(db); assert.deepEqual(snapshot(db), before); db.exec('DROP TRIGGER fail_removal'); });
    const outcomes = await Promise.all([f.remove(f.first, body), f.remove(f.first, body)]);
    assert.deepEqual(outcomes.map(r => r.status).sort(), [200, 404]);
    assert.equal((await f.call('/groups/' + f.first + '/deletion')).status, 404);
});

test('coordinates deletion with a simultaneous SMTP reservation and expires the deletion revision when delivery changes', async t => {
    let began, resume;
    const entered = new Promise(resolve => { began = resolve; });
    const waiting = new Promise(resolve => { resume = resolve; });
    let attempts = 0;
    const f = await fixture(t, { mode: 'test', configured: true, async send() { attempts++; began(); await waiting; return 'uncertain'; } });
    await f.addPeople(f.first, ['Ana', 'Bea']);
    const scope = await f.edition(f.first, 'Envío', true);
    const payload = sendBody(await f.store.status(scope));
    const before = await f.summary(f.first);
    const sending = f.store.send(payload, scope);
    try {
        await entered;
        const concurrent = await f.remove(f.first, f.confirmation(await f.summary(f.first)));
        assert.equal(concurrent.status, 409);
        assert.match(concurrent.data.error, /envío activo/);
        const other = (await f.store.manage('createGroup', { name: 'Independiente' })).group.id;
        assert.equal((await f.remove(other, f.confirmation(await f.summary(other)))).status, 200);
    } finally { resume(); await sending; }
    assert.equal((await f.remove(f.first, f.confirmation(before))).status, 409);
    const fresh = await f.summary(f.first);
    const retry = { ...sendBody(await f.store.status(scope)), retryUncertain: true };
    const [deletion, reservation] = await Promise.all([
        f.remove(f.first, f.confirmation(fresh)),
        f.call('/groups/' + f.first + '/editions/' + scope.editionId + '/draw/send', 'POST', retry),
    ]);
    if (deletion.status === 200) {
        assert.equal(reservation.status, 404);
        assert.equal(attempts, 2);
    } else {
        assert.equal(deletion.status, 409);
        assert.equal(reservation.status, 202);
        await waitForMail(() => f.store.status(scope));
        assert.equal(attempts, 4);
        assert.equal((await f.remove(f.first, f.confirmation(await f.summary(f.first)))).status, 200);
    }
    f.sql(integrity);
});
