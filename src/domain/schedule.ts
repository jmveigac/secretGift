export interface Schedule { localDateTime: string; timeZone: string; eventAt: string; revealAt: string }

/** Resolve wall time explicitly. Zero or multiple instants are never silently corrected. */
export function resolveSchedule(input: unknown): Schedule {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Indica fecha, hora y zona horaria.');
    const { localDateTime, timeZone } = input as Record<string, unknown>;
    if (typeof localDateTime !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localDateTime) || typeof timeZone !== 'string' || timeZone.length > 100) throw new Error('Fecha, hora o zona horaria no válidas.');
    const [year, month, day, hour, minute] = localDateTime.split(/[-T:]/).map(Number);
    const wall = new Date(0); wall.setUTCFullYear(year, month - 1, day); wall.setUTCHours(hour, minute, 0, 0);
    if (year < 1 || wall.toISOString().slice(0, 16) !== localDateTime) throw new Error('La fecha y hora locales no son válidas.');
    let formatter: Intl.DateTimeFormat;
    try { formatter = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); }
    catch { throw new Error('Zona horaria no válida. Usa un identificador como Europe/Madrid.'); }
    const parts = (instant: number) => {
        const p = Object.fromEntries(formatter.formatToParts(instant).map(v => [v.type, v.value]));
        const d = new Date(0); d.setUTCFullYear(Number(p.year), Number(p.month) - 1, Number(p.day)); d.setUTCHours(Number(p.hour), Number(p.minute), Number(p.second), 0); return d.getTime();
    };
    const offsets = new Set<number>();
    for (let hours = -48; hours <= 48; hours += 6) { const instant = wall.getTime() + hours * 3600000; offsets.add(parts(instant) - instant); }
    const matches = [...offsets].map(offset => wall.getTime() - offset).filter(instant => parts(instant) === wall.getTime());
    if (matches.length === 0) throw new Error('Esa hora no existe por el cambio de horario. Elige otra hora.');
    if (matches.length !== 1) throw new Error('Esa hora es ambigua por el cambio de horario. Elige otra hora.');
    const eventAt = new Date(matches[0]).toISOString();
    return { localDateTime, timeZone: formatter.resolvedOptions().timeZone, eventAt, revealAt: eventAt };
}
export function validateSchedule(schedule: Schedule) {
    const resolved = resolveSchedule(schedule);
    if (resolved.eventAt !== schedule.eventAt || !Number.isFinite(Date.parse(schedule.revealAt)) || new Date(schedule.revealAt).toISOString() !== schedule.revealAt) throw new Error('Invalid stored schedule');
}
