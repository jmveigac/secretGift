import { DatabaseSync } from 'node:sqlite';
import { promises as fs } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto';
import { storageLock } from './lock';
import type { State } from './store';

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
            }
            if (key.length !== 32) throw new Error('Invalid storage key');
            await fs.chmod(dirname(keyPath), 0o700);
            await fs.chmod(keyPath, 0o600);
            // Validate the entire legacy document before creating any database.
            let initial: State = { version: 1, participants: [], draw: null };
            const workingPath = exists ? path : `${path}.${randomUUID()}.initializing`;
            if (!exists) {
                try { initial = JSON.parse(await fs.readFile(legacy, 'utf8')); }
                catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Invalid legacy storage'); }
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
                const tables = db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
                if (tables.length) throw new Error('Incompatible database');
                db.exec('BEGIN IMMEDIATE');
                try {
                    db.exec(`CREATE TABLE metadata (id INTEGER PRIMARY KEY CHECK(id=1), verifier BLOB NOT NULL);
                        CREATE TABLE participants (id TEXT PRIMARY KEY, position INTEGER NOT NULL UNIQUE, private BLOB NOT NULL);
                        CREATE TABLE draw (id INTEGER PRIMARY KEY CHECK(id=1), completed_at TEXT NOT NULL, revision TEXT);
                        CREATE TABLE assignments (giver TEXT PRIMARY KEY REFERENCES participants(id), private BLOB NOT NULL,
                            draw_id INTEGER NOT NULL REFERENCES draw(id), status TEXT NOT NULL CHECK(status IN ('pending','uncertain','accepted','failed')));
                        CREATE INDEX assignments_draw ON assignments(draw_id);
                        PRAGMA user_version=1;`);
                    db.prepare('INSERT INTO metadata VALUES (1, ?)').run(store.seal('secretGift', 'key-verifier'));
                    store.replace(initial);
                    db.exec('COMMIT');
                } catch (error) { db.exec('ROLLBACK'); throw error; }
            } else if (version !== 1) throw new Error('Incompatible database');
            if ((db.prepare('PRAGMA quick_check').get() as { quick_check: string }).quick_check !== 'ok') throw new Error('Corrupt database');
            if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Corrupt database relations');
            if (store.unseal(db.prepare('SELECT verifier FROM metadata WHERE id=1').get()!.verifier, 'key-verifier') !== 'secretGift') throw new Error('Invalid storage key');
            validate(store.read());
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
    read(): State {
        this.db.exec('BEGIN');
        try {
            const participants = this.db.prepare('SELECT * FROM participants ORDER BY position').all().map(row => ({ id: row.id as string, ...this.unseal(row.private, `participant:${row.id}`) }));
            const draw = this.db.prepare('SELECT * FROM draw').get();
            const assignments = this.db.prepare('SELECT * FROM assignments').all();
            const state: State = { version: 1, participants, draw: draw ? {
                completedAt: draw.completed_at as string,
                ...(draw.revision === null ? {} : { deliveryRevision: draw.revision as string }),
                assignments: assignments.map(row => ({ giver: row.giver as string, receiver: this.unseal(row.private, `assignment:${row.giver}`) })),
                deliveries: Object.fromEntries(assignments.map(row => [row.giver, row.status]))
            } : null };
            this.db.exec('COMMIT'); return state;
        } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
    private replace(state: State) {
        this.db.exec('DELETE FROM assignments; DELETE FROM draw; DELETE FROM participants;');
        const participant = this.db.prepare('INSERT INTO participants VALUES (?, ?, ?)');
        state.participants.forEach(({ id, ...privateData }, position) => participant.run(id, position, this.seal(privateData, `participant:${id}`)));
        if (state.draw) {
            this.db.prepare('INSERT INTO draw VALUES (1, ?, ?)').run(state.draw.completedAt, state.draw.deliveryRevision ?? null);
            const assignment = this.db.prepare('INSERT INTO assignments VALUES (?, ?, 1, ?)');
            for (const { giver, receiver } of state.draw.assignments) assignment.run(giver, this.seal(receiver, `assignment:${giver}`), state.draw.deliveries?.[giver] ?? 'pending');
        }
    }
    write(state: State) {
        this.db.exec('BEGIN IMMEDIATE');
        try { this.replace(state); this.db.exec('COMMIT'); }
        catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
    close() { this.db.close(); this.key.fill(0); }
}
