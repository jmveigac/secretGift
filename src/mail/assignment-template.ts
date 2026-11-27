import type { Schedule } from '../domain/schedule';

// Dynamic values are inserted only as escaped text, never as markup or styles.
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]!);

export function assignmentContent(name: string, receiver: string, options: { schedule?: Schedule; reminder?: boolean } = {}) {
    const schedule = options.schedule;
    const event = schedule && `${new Intl.DateTimeFormat('es-ES', {
        dateStyle: 'long', timeStyle: 'short', timeZone: schedule.timeZone,
    }).format(new Date(schedule.eventAt))} (${schedule.timeZone})`;
    const title = options.reminder ? 'Tu secreto sigue en marcha' : '¡Ya tienes un secreto!';
    const intro = options.reminder ? 'Te recordamos a quién te toca regalar.' : 'El sorteo de amigo invisible ya está hecho. Te toca regalar a:';

    return {
        text: `secretGift\n${title}\nLa magia está en la sorpresa.\n\nHola ${name}:\n\n${intro}\n\n${receiver}${event ? `\n\nEl encuentro: ${event}` : ''}\n\nGuarda el secreto hasta el encuentro.\n\nLo mejor de un regalo empieza con una sorpresa. · secretGift`,
        html: `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Amigo invisible · secretGift</title></head>
<body style="margin:0;padding:0;background-color:#f5f2e9;color:#20352a;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f5f2e9;">
<tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background-color:#fffdf5;border:1px solid #d6dccb;border-radius:16px;">
<tr><td bgcolor="#20382b" style="padding:24px 24px 28px;background-color:#20382b;border-radius:15px 15px 0 0;border-bottom:4px solid #efb38b;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0">
<tr><td width="38" height="38" align="center" bgcolor="#c6eba7" style="background-color:#c6eba7;border-radius:10px;font-size:20px;line-height:38px;"><span aria-hidden="true">&#127873;</span></td>
<td style="padding-left:10px;color:#f5f2e9;font-size:16px;font-weight:bold;">secretGift</td></tr>
</table>
<h1 style="margin:22px 0 6px;color:#fffdf5;font-size:31px;line-height:1.14;font-weight:bold;">${title}</h1>
<p style="margin:0;color:#c6eba7;font-size:16px;line-height:1.5;">La magia está en la sorpresa.</p>
</td></tr>
<tr><td style="padding:24px;">
<p style="margin:0 0 8px;font-weight:bold;font-size:17px;line-height:1.5;overflow-wrap:anywhere;word-break:break-word;">Hola ${escapeHtml(name)}:</p>
<p style="margin:0 0 18px;color:#4f6354;font-size:16px;line-height:1.5;">${intro}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;table-layout:fixed;background-color:#e5efd8;border-radius:12px;">
<tr><td align="left" style="padding:17px 16px;border-left:4px solid #648454;border-radius:12px;">
<p style="margin:0 0 5px;color:#30553a;font-size:12px;font-weight:bold;letter-spacing:1px;line-height:1.5;">TU REGALO ES PARA</p>
<p style="margin:0;color:#20382b;font-family:Georgia,'Times New Roman',serif;font-size:29px;font-weight:bold;line-height:1.25;overflow-wrap:anywhere;word-break:break-all;word-break:break-word;">${escapeHtml(receiver)}</p>
</td></tr></table>
${event ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin-top:14px;background-color:#fae9db;border-radius:10px;"><tr><td style="padding:12px 15px;color:#753a23;font-size:14px;line-height:1.55;"><strong>El encuentro</strong><br>${escapeHtml(event)}</td></tr></table>` : ''}
<p style="margin:17px 0 0;color:#4f6354;font-size:15px;line-height:1.55;">Guarda el secreto hasta el encuentro.</p>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #d6dccb;color:#4f6354;font-size:13px;line-height:1.55;">
<strong style="color:#30553a;">secretGift</strong><br>Lo mejor de un regalo empieza con una sorpresa.
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`
    };
}
