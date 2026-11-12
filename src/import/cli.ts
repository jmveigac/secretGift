import { importCli } from './service';
import { ImportError } from '../domain/legacy-import';

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--help') {
        console.log('Uso: npm run import:cli -- --source ARCHIVO --plan PLAN [--data SQLITE] [--key CLAVE] [--confirm CODIGO]\nSin --confirm valida y muestra solo contadores y un código de confirmación. Haz una copia de la base y su clave antes de confirmar.');
        return;
    }
    const values: Record<string, string> = {};
    for (let i = 0; i < args.length; i += 2) {
        if (!['--source', '--plan', '--data', '--key', '--confirm'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || values[args[i]]) throw new ImportError('Argumentos incorrectos; consulta --help.');
        values[args[i]] = args[i + 1];
    }
    if (!values['--source'] || !values['--plan']) throw new ImportError('Se requieren --source y --plan; consulta --help.');
    const result = await importCli({ source: values['--source'], plan: values['--plan'], data: values['--data'], key: values['--key'], confirm: values['--confirm'] });
    console.log(JSON.stringify(result));
}
if (require.main === module) void main().catch(error => {
    // Never print raw parser, filesystem, SQLite or SMTP errors (including stack/paths).
    console.error(error instanceof ImportError ? error.message : 'No se pudo completar la importación.');
    process.exitCode = 1;
});
