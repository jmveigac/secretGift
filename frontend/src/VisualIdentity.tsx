import { useEffect, useState } from 'react';
import type { EditionSummary } from './api';

type Theme = 'system' | 'dark' | 'light';
export function ThemeChoice() {
    const [theme, setTheme] = useState<Theme>(() => {
        const initial = document.documentElement.dataset.theme;
        return initial === 'dark' || initial === 'light' ? initial : 'system';
    });
    function choose(next: Theme) {
        setTheme(next);
        if (next === 'system') delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = next;
        try { localStorage.setItem('secretgift-theme', next); } catch { /* Session preference remains available. */ }
    }
    return <label className="theme-choice">Tema<select id="theme-choice" value={theme} onChange={event => choose(event.target.value as Theme)}>
        <option value="system">Sistema</option><option value="light">Claro</option><option value="dark">Oscuro</option>
    </select></label>;
}

export function GiftMark({ className }: { className?: string }) {
    return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 10h16v4H4z M5 14v7h14v-7 M12 10v11 M12 10C5 10 6 4 9 5c2 0 3 5 3 5Zm0 0c7 0 6-6 3-5-2 0-3 5-3 5Z"/>
    </svg>;
}
export function Avatar({ name }: { name: string }) {
    const words = name.trim().split(/\s+/u).slice(0, 2);
    const initials = words.map(word => Array.from(word)[0] ?? '').join('').toLocaleUpperCase('es');
    const tone = Array.from(name).reduce((sum, letter) => sum + (letter.codePointAt(0) ?? 0), 0) % 3;
    return <span className="avatar" data-tone={tone} aria-hidden="true">{initials}</span>;
}

export function countdown(eventAt: string | undefined, zone: string | undefined, now: number) {
    if (!eventAt || !zone) return;
    const target = Date.parse(eventAt);
    if (!Number.isFinite(target) || target <= now) return;
    let calendar: Intl.DateTimeFormat;
    try {
        calendar = new Intl.DateTimeFormat('es-ES', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric' });
    } catch {
        return;
    }
    const day = (date: number) => {
        const fields = Object.fromEntries(calendar.formatToParts(date).map(part => [part.type, part.value]));
        return Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day));
    };
    return (day(target) - day(now)) / 86_400_000;
}

export function EventCountdown({ schedule, now }: { schedule: EditionSummary['edition']['schedule']; now: number }) {
    const days = countdown(schedule?.eventAt, schedule?.timeZone, now);
    if (days === undefined) return null;
    return <span className="countdown">{days === 0 ? <strong>Hoy</strong> : <><strong>{days}</strong><span>{days === 1 ? 'día para el evento' : 'días para el evento'}</span></>}</span>;
}

export function EventDateTile({ schedule }: { schedule: EditionSummary['edition']['schedule'] }) {
    if (!schedule) return <span className="event-date-tile"><GiftMark /></span>;
    const date = new Date(schedule.eventAt);
    const fields = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: schedule.timeZone }).formatToParts(date);
    return <span className="event-date-tile" aria-hidden="true"><strong>{fields.find(part => part.type === 'day')?.value}</strong><span>{fields.find(part => part.type === 'month')?.value}</span></span>;
}

export function useCurrentMinute() {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 30_000);
        return () => window.clearInterval(timer);
    }, []);
    return now;
}

export function DeliveryMeter({ delivery }: { delivery: EditionSummary['delivery'] }) {
    if (!delivery?.mode) return <span className="delivery-label">Correo sin configurar</span>;
    const { accepted, pending, failed, uncertain, mode } = delivery;
    const total = accepted + pending + failed + uncertain;
    const prefix = mode === 'test' ? 'Pruebas' : 'Producción';
    const status = delivery.active ? 'Envío en curso' : failed || uncertain ? 'Necesita revisión' : pending ? `${pending} pendientes` : total ? 'Correo aceptado por el servidor' : 'Sin notificaciones pendientes';
    return <div className="delivery-meter">
        <span className="delivery-label" data-state={failed || uncertain ? 'warning' : undefined}>{prefix} · {status}</span>
        {total > 0 && <progress max={total} value={accepted} aria-label={`${prefix}: ${accepted} de ${total} aceptados por el servidor`} />}
    </div>;
}
