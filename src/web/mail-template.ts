// Dynamic values are inserted only as escaped text, never as HTML or styles.
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]!);

export function assignmentContent(name: string, receiver: string): { text: string; html: string } {
    return {
        text: `secretGift\n\nHola ${name}:\n\nEn el sorteo de amigo invisible te ha tocado regalar a ${receiver}.\nMantén tu asignación en secreto. ¡Disfruta preparando el regalo!\n\nFelices fiestas · secretGift`,
        html: `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Amigo invisible · secretGift</title></head>
<body style="margin:0;padding:0;background-color:#f1f0eb;color:#243e33;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f1f0eb;">
<tr><td align="center" style="padding:32px 12px;">
<!--[if mso]><table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background-color:#fffdf7;border:1px solid #deded2;border-radius:12px;">
<tr><td style="padding:30px 24px;background-color:#193f32;border-radius:12px 12px 0 0;border-bottom:3px solid #b79a55;">
<p style="margin:0 0 10px;color:#e1cd94;font-size:11px;letter-spacing:3px;line-height:1.5;">UN REGALO. UN SECRETO.</p>
<h1 style="margin:0;color:#fffdf7;font-family:Georgia,'Times New Roman',serif;font-size:36px;font-weight:normal;line-height:1.2;">secretGift</h1>
</td></tr>
<tr><td style="padding:32px 24px;">
<p style="margin:0 0 20px;font-size:18px;line-height:1.6;overflow-wrap:anywhere;word-break:break-word;">Hola ${escapeHtml(name)}:</p>
<p style="margin:0 0 24px;color:#4e6057;font-size:16px;line-height:1.7;">En el sorteo de amigo invisible te ha tocado regalar a</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#edf2ec;border:1px solid #d9e2d6;border-radius:8px;">
<tr><td align="center" style="padding:24px 16px;">
<p style="margin:0;color:#193f32;font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:bold;line-height:1.4;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(receiver)}</p>
</td></tr></table>
<p style="margin:24px 0 0;color:#4e6057;font-size:16px;line-height:1.7;">Mantén tu asignación en secreto. ¡Disfruta preparando el regalo!</p>
</td></tr>
<tr><td align="center" style="padding:20px 24px;border-top:1px solid #e5e2d7;">
<p style="margin:0;color:#58675e;font-size:13px;line-height:1.6;">Felices fiestas &middot; secretGift</p>
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`
    };
}
