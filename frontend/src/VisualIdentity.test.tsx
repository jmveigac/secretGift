import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { countdown, DeliveryMeter, EventCountdown, ThemeChoice } from './VisualIdentity';

afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
});
describe('visual identity', () => {
    it('persists explicit theme choices and restores system mode', async () => {
        const user = userEvent.setup();
        render(<ThemeChoice />);
        const choice = screen.getByRole('combobox', { name: 'Tema' });
        await user.selectOptions(choice, 'dark');
        expect(document.documentElement.dataset.theme).toBe('dark');
        expect(localStorage.getItem('secretgift-theme')).toBe('dark');
        await user.selectOptions(choice, 'light');
        expect(document.documentElement.dataset.theme).toBe('light');
        await user.selectOptions(choice, 'system');
        expect(document.documentElement.dataset.theme).toBeUndefined();
        expect(localStorage.getItem('secretgift-theme')).toBe('system');
    });
    it('restores the preference applied by the pre-paint script', () => {
        document.documentElement.dataset.theme = 'dark';
        render(<ThemeChoice />);
        expect(screen.getByRole('combobox', { name: 'Tema' })).toHaveValue('dark');
    });
    it('counts calendar days in the event zone across a DST transition', () => {
        expect(countdown('2027-03-29T18:00:00Z', 'Europe/Madrid', Date.parse('2027-03-27T23:30:00Z'))).toBe(1);
        expect(countdown('2027-03-28T18:00:00Z', 'Europe/Madrid', Date.parse('2027-03-27T23:30:00Z'))).toBe(0);
    });
    it('omits past, missing and invalid event dates', () => {
        const now = Date.parse('2027-03-28T18:00:00Z');
        for (const event of [undefined, 'invalid', '2027-03-28T17:00:00Z']) expect(countdown(event, 'Europe/Madrid', now)).toBeUndefined();
        const { container } = render(<EventCountdown schedule={undefined} now={now} />);
        expect(container).toBeEmptyDOMElement();
    });
    it('keeps failures and uncertain outcomes out of the acceptance meter', () => {
        render(<DeliveryMeter delivery={{ mode: 'test', configured: true, active: false, revision: 'fake', accepted: 1, pending: 1, failed: 1, uncertain: 1 }} />);
        expect(screen.getByText('Pruebas · Necesita revisión')).toBeInTheDocument();
        expect(screen.getByRole('progressbar')).toHaveAttribute('value', '1');
        expect(screen.getByRole('progressbar')).toHaveAttribute('max', '4');
    });
});
