import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

// Linux advisory lock: released by the OS even after SIGKILL/container restart.
// The child holds it until stdin closes; its descriptor is never inherited by SMTP.
export async function storageLock(path: string): Promise<() => Promise<void>> {
    await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const child = spawn('flock', ['-n', `${path}.lock`, 'sh', '-c', 'echo locked; cat >/dev/null'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let exited = false;
    const done = new Promise<void>(resolve => child.once('exit', () => { exited = true; resolve(); }));
    await new Promise<void>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', () => reject(new Error('Storage busy')));
        child.stdout.once('data', () => resolve());
    });
    return async () => { if (!exited) child.stdin.end(); await done; };
}
