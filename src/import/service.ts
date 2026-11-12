import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { EncryptedDatabase } from '../web/database';
import { storageLock } from '../web/lock';
import { ImportError, parseLegacy, parseImportPlan } from '../domain/legacy-import';

const limit = 1024 * 1024;
async function document(path: string, base64: boolean): Promise<unknown> {
    let file;
    try {
        file = await fs.open(path, 'r');
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > limit) throw new ImportError('El archivo debe ser regular y no superar 1 MiB.');
        const bytes = Buffer.alloc(limit + 1); let length = 0;
        while (length < bytes.length) {
            const result = await file.read(bytes, length, bytes.length - length, length);
            if (!result.bytesRead) break;
            length += result.bytesRead;
        }
        if (length > limit) throw new ImportError('El archivo supera 1 MiB.');
        let text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)).trim();
        if (base64 && !text.startsWith('[')) {
            const encoded = text.replace(/\s/g, '');
            if (!encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new ImportError('El origen debe ser JSON o Base64 válido.');
            const decoded = Buffer.from(encoded, 'base64');
            if (decoded.toString('base64') !== encoded) throw new ImportError('Base64 incorrecto.');
            text = new TextDecoder('utf-8', { fatal: true }).decode(decoded);
        }
        return JSON.parse(text);
    } catch (error) {
        if (error instanceof ImportError) throw error;
        throw new ImportError('No se pudo leer un JSON válido; revisa el archivo y sus permisos.');
    } finally { await file?.close(); }
}
export interface ImportOptions { source: string; plan: string; data?: string; key?: string; confirm?: string; max?: number }
export async function importCli(options: ImportOptions) {
    // Invalid files never initialize or touch storage.
    const records = parseLegacy(await document(options.source, true));
    const plan = parseImportPlan(await document(options.plan, false), records.length);
    const path = resolve(options.data ?? process.env.DATA_FILE ?? './data/state.sqlite');
    const key = resolve(options.key ?? process.env.DATA_KEY_FILE ?? join(dirname(path), '../keys/storage.key'));
    if (options.confirm !== undefined && !/^[a-f0-9]{64}$/.test(options.confirm)) throw new ImportError('Confirma con el código de una vista previa válida.');
    let release;
    try { release = await storageLock(path); }
    catch { throw new ImportError('Almacenamiento ocupado; espera a que terminen las escrituras o los envíos.'); }
    try {
        // Importing requires an existing installation: preview must not initialize or migrate it.
        const probe = new DatabaseSync(path, { readOnly: true });
        try { if (probe.prepare('PRAGMA user_version').get()!.user_version !== 5) throw new ImportError('Arranca y actualiza primero la web: se requiere SQLite v5 existente.'); }
        finally { probe.close(); }
        const db = await EncryptedDatabase.open(path, key, join(dirname(path), 'state.json'), () => {});
        try { return db.importLegacy(records, plan, options.max ?? Number(process.env.MAX_PARTICIPANTS ?? 15), options.confirm); }
        finally { db.close(); }
    } catch (error) {
        if (error instanceof ImportError) throw error;
        throw new ImportError('No se pudo completar la importación. Comprueba la base y su clave originales; no se importaron datos.');
    } finally { await release(); }
}
