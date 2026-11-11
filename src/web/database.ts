import { DatabaseSync } from 'node:sqlite';
import { promises as fs } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { randomBytes, randomUUID, createCipheriv, createDecipheriv, createHmac } from 'node:crypto';
import { storageLock } from './lock';
import { validateState, type State, type Group, type Person, type Edition } from '../domain/editions';
import { isDeepStrictEqual } from 'node:util';

export class MissingDatabaseError extends Error {
    constructor() { super('Storage database missing: restore the database with its original key'); }
}

// Only encrypted envelopes cross the SQLite boundary, including its journal/WAL.
export class EncryptedDatabase {
    private constructor(private db: DatabaseSync, private key: Buffer) {}
    private seal(value: unknown, context: string): Buffer {
        const nonce = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
        cipher.setAAD(Buffer.from(`secretGift:1:${context}`));
        const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
        return Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), encrypted]);
    }
    private unseal(value: unknown, context: string): any {
        const bytes = Buffer.from(value as Uint8Array);
        if (bytes.length < 30 || bytes[0] !== 1) throw new Error('Unsupported encrypted format');
        const cipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(1, 13));
        cipher.setAAD(Buffer.from(`secretGift:1:${context}`));
        cipher.setAuthTag(bytes.subarray(13, 29));
        return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(29)), cipher.final()]).toString('utf8'));
    }
    static async open(path: string, keyPath: string, legacy: string, validate: (state: State) => void): Promise<EncryptedDatabase> {
        if (resolve(dirname(path)) === resolve(dirname(keyPath))) throw new Error('Key directory must be separate');
        await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await fs.chmod(dirname(path), 0o700);
        // Initialization is serialized independently from the long-lived SMTP lock.
        const release = await storageLock(`${path}.init`);
        let db: DatabaseSync | undefined;
        try {
            const exists = await fs.stat(path).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; });
            let key: Buffer;
            let newKey = false;
            try { key = await fs.readFile(keyPath); }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                const interrupted = (await fs.readdir(dirname(path))).some(name => name.startsWith(`${basename(path)}.`) && name.endsWith('.initializing'));
                if (exists || interrupted) throw new Error('Storage key missing: restore the original key');
                await fs.mkdir(dirname(keyPath), { recursive: true, mode: 0o700 });
                const file = await fs.open(keyPath, 'wx', 0o600);
                key = randomBytes(32);
                try { await file.writeFile(key); await file.sync(); } finally { await file.close(); }
                const directory = await fs.open(dirname(keyPath), 'r');
                try { await directory.sync(); } finally { await directory.close(); }
                newKey = true;
            }
            if (key.length !== 32) throw new Error('Invalid storage key');
            await fs.chmod(dirname(keyPath), 0o700);
            await fs.chmod(keyPath, 0o600);
            // Validate the entire legacy document before creating any database.
            let initial: State = { version: 1, participants: [], draw: null };
            const workingPath = exists ? path : `${path}.${randomUUID()}.initializing`;
            if (!exists) {
                try { initial = JSON.parse(await fs.readFile(legacy, 'utf8')); }
                catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Invalid legacy storage');
                    // A persistent key is evidence of prior initialization. Only a
                    // validated legacy document can safely restart migration here.
                    if (!newKey) throw new MissingDatabaseError();
                }
                validate(initial);
                const file = await fs.open(workingPath, 'wx', 0o600); await file.close();
            }
            await fs.chmod(workingPath, 0o600);
            db = new DatabaseSync(workingPath);
            db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; PRAGMA temp_store=MEMORY;');
            const store = new EncryptedDatabase(db, key);
            const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
            if (version === 0 && !exists) {
                // Publish only a fully committed and authenticated database.
                if (db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all().length) throw new Error('Incompatible database');
                store.transaction(() => {
                    db!.exec('CREATE TABLE metadata (id INTEGER PRIMARY KEY CHECK(id=1), verifier BLOB NOT NULL)');
                    db!.prepare('INSERT INTO metadata VALUES (1, ?)').run(store.seal('secretGift', 'key-verifier'));
                    store.createSchema();
                    store.initialize(initial);
                    store.validateAll();
                    validate(store.readCurrent());
                    db!.exec('PRAGMA user_version=2');
                });
            } else if (version === 1) {
                store.transaction(() => {
                    store.checkIntegrity();
                    store.authenticate();
                    const source = store.readV1();
                    validateState(source); validate(source);
                    // DDL, re-encryption, validation and version change roll back together.
                    db!.exec('DROP TABLE assignments; DROP TABLE draw; DROP TABLE participants;');
                    store.createSchema();
                    store.initialize(source);
                    store.validateAll();
                    if (!isDeepStrictEqual(source, store.readCurrent())) throw new Error('Migration verification failed');
                    db!.exec('PRAGMA user_version=2');
                });
            } else if (version !== 2) throw new Error('Incompatible database');
            store.transaction(() => {
                store.checkIntegrity();
                store.authenticate();
                store.validateAll();
                validate(store.readCurrent());
            }, false);
            if (!exists) {
                db.close();
                await fs.rename(workingPath, path);
                db = new DatabaseSync(path);
                db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; PRAGMA temp_store=MEMORY;');
            }
            await fs.chmod(path, 0o600);
            const directory = await fs.open(dirname(path), 'r');
            try { await directory.sync(); } finally { await directory.close(); }
            return new EncryptedDatabase(db, key);
        } catch (error) { db?.close(); throw error; }
        finally { await release(); }
    }
    private transaction<T>(operation: () => T, write = true): T {
        this.db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
        try { const result = operation(); this.db.exec('COMMIT'); return result; }
        catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
    private checkIntegrity() {
        if ((this.db.prepare('PRAGMA quick_check').get() as { quick_check: string }).quick_check !== 'ok') throw new Error('Corrupt database');
        if (this.db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Corrupt database relations');
    }
    private authenticate() {
        if (this.unseal(this.db.prepare('SELECT verifier FROM metadata WHERE id=1').get()?.verifier, 'key-verifier') !== 'secretGift') throw new Error('Invalid storage key');
    }
    private createSchema() {
        this.db.exec(`CREATE TABLE groups (id TEXT PRIMARY KEY, private BLOB NOT NULL);
            CREATE TABLE people (group_id TEXT NOT NULL REFERENCES groups(id), id TEXT NOT NULL, private BLOB NOT NULL,
                active INTEGER NOT NULL CHECK(active IN (0,1)), PRIMARY KEY(group_id,id));
            CREATE TABLE editions (id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id), private BLOB NOT NULL,
                year INTEGER NOT NULL CHECK(year BETWEEN 1 AND 9999), UNIQUE(group_id,id));
            CREATE TABLE participants (group_id TEXT NOT NULL, edition_id TEXT NOT NULL, id TEXT NOT NULL,
                position INTEGER NOT NULL CHECK(position>=0), private BLOB NOT NULL,
                PRIMARY KEY(group_id,edition_id,id), UNIQUE(group_id,edition_id,position),
                FOREIGN KEY(group_id,edition_id) REFERENCES editions(group_id,id),
                FOREIGN KEY(group_id,id) REFERENCES people(group_id,id));
            CREATE TABLE draw (group_id TEXT NOT NULL, edition_id TEXT NOT NULL, completed_at TEXT NOT NULL, revision TEXT,
                PRIMARY KEY(group_id,edition_id), FOREIGN KEY(group_id,edition_id) REFERENCES editions(group_id,id));
            CREATE TABLE assignments (group_id TEXT NOT NULL, edition_id TEXT NOT NULL, giver TEXT NOT NULL, private BLOB NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('pending','uncertain','accepted','failed')),
                PRIMARY KEY(group_id,edition_id,giver),
                FOREIGN KEY(group_id,edition_id,giver) REFERENCES participants(group_id,edition_id,id),
                FOREIGN KEY(group_id,edition_id) REFERENCES draw(group_id,edition_id));
            CREATE TABLE compatibility (id INTEGER PRIMARY KEY CHECK(id=1), group_id TEXT NOT NULL, edition_id TEXT NOT NULL,
                FOREIGN KEY(group_id,edition_id) REFERENCES editions(group_id,id));`);
    }
    private initialize(state: State) {
        const group = this.insertGroup('Grupo principal');
        const edition = this.insertEdition(group.id, 'Edición inicial', state.draw ? new Date(state.draw.completedAt).getUTCFullYear() : new Date().getUTCFullYear());
        this.syncPeople(group.id, state);
        this.replace(group.id, edition.id, state);
        this.db.prepare('INSERT INTO compatibility VALUES (1, ?, ?)').run(group.id, edition.id);
    }
    private scope(groupId: string, editionId: string, kind: string, id = '') {
        return `group:${groupId}:edition:${editionId}:${kind}:${id}`;
    }
    private validateName(name: string) {
        if (typeof name !== 'string' || !name || name.length > 100 || name !== name.trim().replace(/\s+/g, ' ') || /[\x00-\x1f\x7f]/.test(name)) throw new Error('Invalid name');
    }
    private validateId(id: string) {
        if (typeof id !== 'string' || !/^[\da-f-]{36}$/.test(id)) throw new Error('Invalid identifier');
    }
    private insertGroup(name: string): Group {
        this.validateName(name);
        const id = randomUUID();
        this.db.prepare('INSERT INTO groups VALUES (?, ?)').run(id, this.seal(name, `group:${id}`));
        return { id, name };
    }
    createGroup(name: string): Group { return this.transaction(() => this.insertGroup(name)); }
    renameGroup(groupId: string, name: string) {
        this.transaction(() => {
            this.requireGroup(groupId); this.validateName(name);
            this.db.prepare('UPDATE groups SET private=? WHERE id=?').run(this.seal(name, `group:${groupId}`), groupId);
        });
    }
    // Keyed revisions avoid exposing a guessable digest of private assignments.
    fingerprint(context: string, value: unknown): string {
        return createHmac('sha256', this.key).update('secretGift:revision:1:').update(context).update('\0').update(JSON.stringify(value)).digest('hex');
    }
    listGroups(): Group[] {
        return this.db.prepare('SELECT * FROM groups ORDER BY rowid').all().map(row => {
            const id = row.id as string, name = this.unseal(row.private, `group:${id}`);
            this.validateId(id); this.validateName(name);
            return { id, name };
        });
    }
    private requireGroup(groupId: string) {
        this.validateId(groupId);
        if (!this.db.prepare('SELECT 1 FROM groups WHERE id=?').get(groupId)) throw new Error('Group not found');
    }
    private insertEdition(groupId: string, name: string, year: number): Edition {
        this.requireGroup(groupId); this.validateName(name);
        if (!Number.isInteger(year) || year < 1 || year > 9999) throw new Error('Invalid edition year');
        const id = randomUUID();
        this.db.prepare('INSERT INTO editions VALUES (?, ?, ?, ?)').run(id, groupId, this.seal(name, this.scope(groupId, id, 'name')), year);
        return { id, groupId, name, year };
    }
    listEditions(groupId: string): Edition[] {
        this.requireGroup(groupId);
        return this.db.prepare('SELECT * FROM editions WHERE group_id=? ORDER BY rowid').all(groupId).map(row => {
            const id = row.id as string, name = this.unseal(row.private, this.scope(groupId, id, 'name')), year = row.year as number;
            this.validateId(id); this.validateName(name);
            if (!Number.isInteger(year) || year < 1 || year > 9999) throw new Error('Invalid edition year');
            return { id, groupId, name, year };
        });
    }
    private requireEdition(groupId: string, editionId: string) {
        this.validateId(groupId); this.validateId(editionId);
        if (!this.db.prepare('SELECT 1 FROM editions WHERE group_id=? AND id=?').get(groupId, editionId)) throw new Error('Edition not found');
    }
    listPeople(groupId: string): Person[] {
        this.requireGroup(groupId);
        return this.db.prepare('SELECT * FROM people WHERE group_id=? ORDER BY rowid').all(groupId).map(row => {
            const id = row.id as string, data = this.unseal(row.private, `group:${groupId}:person:${id}`);
            const person = { id, name: data.name as string, email: data.email as string, active: row.active === 1 };
            validateState({ version: 1, participants: [{ id, name: person.name, email: person.email, previousId: null }], draw: null });
            if (row.active !== 0 && row.active !== 1) throw new Error('Invalid membership');
            return person;
        });
    }
    private savePerson(groupId: string, person: Person) {
        this.requireGroup(groupId);
        validateState({ version: 1, participants: [{ id: person.id, name: person.name, email: person.email, previousId: null }], draw: null });
        if (typeof person.active !== 'boolean') throw new Error('Invalid membership');
        this.db.prepare(`INSERT INTO people VALUES (?, ?, ?, ?) ON CONFLICT(group_id,id)
            DO UPDATE SET private=excluded.private, active=excluded.active`).run(groupId, person.id,
            this.seal({ name: person.name, email: person.email }, `group:${groupId}:person:${person.id}`), Number(person.active));
    }
    // Directory changes never mutate participation snapshots in existing editions.
    putPerson(groupId: string, person: Person) { this.transaction(() => this.savePerson(groupId, person)); }
    createEdition(groupId: string, name: string, year: number, personIds: string[]): Edition {
        return this.transaction(() => {
            const people = this.listPeople(groupId);
            const participants = personIds.map(id => {
                const person = people.find(p => p.id === id && p.active);
                if (!person) throw new Error('Active group member not found');
                return { id, name: person.name, email: person.email, previousId: null };
            });
            const state: State = { version: 1, participants, draw: null };
            validateState(state);
            const edition = this.insertEdition(groupId, name, year);
            this.replace(groupId, edition.id, state);
            return edition;
        });
    }
    private current(): { groupId: string; editionId: string } {
        const row = this.db.prepare('SELECT * FROM compatibility WHERE id=1').get();
        if (!row) throw new Error('Missing compatibility edition');
        return { groupId: row.group_id as string, editionId: row.edition_id as string };
    }
    private readCurrent(): State {
        const { groupId, editionId } = this.current();
        return this.readState(groupId, editionId);
    }
    read(): State { return this.transaction(() => this.readCurrent(), false); }
    readEdition(groupId: string, editionId: string): State {
        return this.transaction(() => this.readState(groupId, editionId), false);
    }
    private readState(groupId: string, editionId: string): State {
        this.requireEdition(groupId, editionId);
        const participants = this.db.prepare('SELECT * FROM participants WHERE group_id=? AND edition_id=? ORDER BY position').all(groupId, editionId).map(row => {
            const data = this.unseal(row.private, this.scope(groupId, editionId, 'participant', row.id as string));
            return { ...data, id: row.id as string };
        });
        const draw = this.db.prepare('SELECT * FROM draw WHERE group_id=? AND edition_id=?').get(groupId, editionId);
        const assignments = this.db.prepare('SELECT * FROM assignments WHERE group_id=? AND edition_id=? ORDER BY rowid').all(groupId, editionId);
        if (!draw && assignments.length) throw new Error('Assignments without draw');
        const state: State = { version: 1, participants, draw: draw ? {
            completedAt: draw.completed_at as string,
            ...(draw.revision === null ? {} : { deliveryRevision: draw.revision as string }),
            assignments: assignments.map(row => ({ giver: row.giver as string, receiver: this.unseal(row.private, this.scope(groupId, editionId, 'assignment', row.giver as string)) })),
            deliveries: Object.fromEntries(assignments.map(row => [row.giver, row.status]))
        } : null };
        validateState(state);
        return state;
    }
    private readV1(): State {
        const participants = this.db.prepare('SELECT * FROM participants ORDER BY position').all().map(row => {
            const data = this.unseal(row.private, `participant:${row.id}`);
            return { ...data, id: row.id as string };
        });
        const draw = this.db.prepare('SELECT * FROM draw').get();
        const assignments = this.db.prepare('SELECT * FROM assignments ORDER BY rowid').all();
        if (!draw && assignments.length) throw new Error('Assignments without draw');
        if ((this.db.prepare('SELECT count(*) AS n FROM draw').get()!.n as number) > 1) throw new Error('Corrupt database');
        return { version: 1, participants, draw: draw ? {
            completedAt: draw.completed_at as string,
            ...(draw.revision === null ? {} : { deliveryRevision: draw.revision as string }),
            assignments: assignments.map(row => ({ giver: row.giver as string, receiver: this.unseal(row.private, `assignment:${row.giver}`) })),
            deliveries: Object.fromEntries(assignments.map(row => [row.giver, row.status]))
        } : null };
    }
    private validateAll() {
        this.checkIntegrity();
        for (const group of this.listGroups()) {
            this.listPeople(group.id);
            for (const edition of this.listEditions(group.id)) this.readState(group.id, edition.id);
        }
        this.readCurrent();
    }
    private syncPeople(groupId: string, state: State, before?: State) {
        for (const person of before?.participants ?? []) {
            if (!state.participants.some(p => p.id === person.id)) this.db.prepare('UPDATE people SET active=0 WHERE group_id=? AND id=?').run(groupId, person.id);
        }
        for (const participant of state.participants) {
            const old = before?.participants.find(p => p.id === participant.id);
            if (!old || old.name !== participant.name || old.email !== participant.email) this.savePerson(groupId, { ...participant, active: true });
        }
    }
    private replace(groupId: string, editionId: string, state: State) {
        this.requireEdition(groupId, editionId); validateState(state);
        this.db.prepare('DELETE FROM assignments WHERE group_id=? AND edition_id=?').run(groupId, editionId);
        this.db.prepare('DELETE FROM draw WHERE group_id=? AND edition_id=?').run(groupId, editionId);
        this.db.prepare('DELETE FROM participants WHERE group_id=? AND edition_id=?').run(groupId, editionId);
        const participant = this.db.prepare('INSERT INTO participants VALUES (?, ?, ?, ?, ?)');
        state.participants.forEach(({ id, ...data }, position) => participant.run(groupId, editionId, id, position, this.seal(data, this.scope(groupId, editionId, 'participant', id))));
        if (state.draw) {
            this.db.prepare('INSERT INTO draw VALUES (?, ?, ?, ?)').run(groupId, editionId, state.draw.completedAt, state.draw.deliveryRevision ?? null);
            const assignment = this.db.prepare('INSERT INTO assignments VALUES (?, ?, ?, ?, ?)');
            for (const { giver, receiver } of state.draw.assignments) assignment.run(groupId, editionId, giver, this.seal(receiver, this.scope(groupId, editionId, 'assignment', giver)), state.draw.deliveries?.[giver] ?? 'pending');
        }
    }
    private checkDrawUnchanged(before: State, after: State) {
        if (before.draw && (!after.draw || !isDeepStrictEqual(before.participants, after.participants)
            || before.draw.completedAt !== after.draw.completedAt || !isDeepStrictEqual(before.draw.assignments, after.draw.assignments))) throw new Error('Drawn editions retain their participants and assignments');
    }
    writeEdition(groupId: string, editionId: string, state: State, newPerson?: Person) {
        this.transaction(() => {
            const before = this.readState(groupId, editionId);
            this.checkDrawUnchanged(before, state);
            if (newPerson) {
                if (this.listPeople(groupId).some(p => p.id === newPerson.id)) throw new Error('Person already exists');
                this.savePerson(groupId, newPerson);
            }
            this.replace(groupId, editionId, state);
        });
    }
    forkEdition(groupId: string, editionId: string): Edition {
        return this.transaction(() => {
            const state = this.readState(groupId, editionId);
            if (!state.draw) throw new Error('Edition has no draw');
            const editions = this.listEditions(groupId), source = editions.find(e => e.id === editionId)!;
            let n = 1, name: string;
            do { name = `${source.name.slice(0, 70)} (continuación ${n++})`; }
            while (editions.some(e => e.year === source.year && e.name.toLowerCase() === name.toLowerCase()));
            const next = this.insertEdition(groupId, name, source.year);
            this.replace(groupId, next.id, { ...state, draw: null });
            const current = this.current();
            if (current.groupId === groupId && current.editionId === editionId) this.db.prepare('UPDATE compatibility SET edition_id=? WHERE id=1').run(next.id);
            return next;
        });
    }
    // Legacy UI always targets the initial group and its current working edition.
    write(state: State) {
        this.transaction(() => {
            validateState(state);
            const { groupId, editionId } = this.current();
            const before = this.readState(groupId, editionId);
            this.syncPeople(groupId, state, before);
            if (before.draw && !state.draw) {
                const edition = this.insertEdition(groupId, 'Edición de trabajo', new Date().getUTCFullYear());
                this.replace(groupId, edition.id, state);
                this.db.prepare('UPDATE compatibility SET edition_id=? WHERE id=1').run(edition.id);
            } else {
                this.checkDrawUnchanged(before, state);
                this.replace(groupId, editionId, state);
            }
        });
    }
    close() { this.db.close(); this.key.fill(0); }
}
