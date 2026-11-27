import ActionIcon from './ActionIcon';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { normalizeGroupName } from '../../src/domain/group-name';
import { groupsApi, type Group, type GroupDeletionSummary } from './api';

interface Props {
    groupId: string;
    compact?: boolean;
    disabled: boolean;
    onBusy: (busy: boolean) => void;
    onDeleted: (groups: Group[]) => void;
}

export default function DeleteGroup({ groupId, disabled, onBusy, onDeleted, compact = false }: Props) {
    const [summary, setSummary] = useState<GroupDeletionSummary>();
    const [confirming, setConfirming] = useState(false);
    const [name, setName] = useState('');
    const [error, setError] = useState('');
    const [pending, setPending] = useState(false);
    const dialog = useRef<HTMLDialogElement>(null);
    const opener = useRef<HTMLButtonElement>(null);
    const cancelButton = useRef<HTMLButtonElement>(null);
    const nameField = useRef<HTMLInputElement>(null);
    const request = useRef(false);

    useEffect(() => {
        const modal = dialog.current;
        if (!modal || !summary) return;
        modal.showModal();
        cancelButton.current?.focus();
        return () => { if (modal.open) modal.close(); };
    }, [summary]);

    useEffect(() => { if (confirming) nameField.current?.focus(); }, [confirming]);

    async function run(action: () => Promise<void>) {
        if (request.current) return;
        request.current = true;
        setPending(true); setError(''); onBusy(true);
        try {
            await action();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'No se pudo eliminar el grupo.');
        } finally {
            request.current = false;
            setPending(false); onBusy(false);
        }
    }

    function cancel() {
        if (request.current) return;
        dialog.current?.close();
        setSummary(undefined); setConfirming(false); setName(''); setError('');
        opener.current?.focus();
    }

    function submit(event: FormEvent) {
        event.preventDefault();
        if (!summary || normalizeGroupName(name) !== summary.name) return;
        void run(async () => {
            const result = await groupsApi.remove(groupId, summary.revision, name);
            dialog.current?.close();
            onDeleted(result.groups);
        });
    }

    return <section className={compact ? "group-danger compact-danger" : "group-danger"}>
        {!compact && <h3>Eliminar grupo</h3>}
        <button className="danger" type="button" ref={opener} disabled={disabled || pending}
            onClick={() => { void run(async () => setSummary(await groupsApi.deletion(groupId))); }}>
            <ActionIcon icon="trash" />Eliminar grupo
        </button>
        {!summary && error && <p role="alert">{error}</p>}
        {summary && <dialog ref={dialog} className="delete-group-dialog" aria-labelledby="delete-group-title"
            onCancel={event => { event.preventDefault(); cancel(); }}>
            <h3 id="delete-group-title">{confirming ? 'Confirma el nombre del grupo' : '¿Eliminar este grupo?'}</h3>
            <p className="delete-group-name"><strong>{summary.name}</strong></p>
            {confirming ? <form onSubmit={submit}>
                <label htmlFor="delete-group-name">Escribe el nombre exacto del grupo</label>
                <input ref={nameField} id="delete-group-name" value={name} onChange={event => setName(event.target.value)}
                    maxLength={100} autoComplete="off" spellCheck={false} disabled={pending} />
                {error && <p role="alert">{error}</p>}
                <div className="actions">
                    <button type="button" className="secondary" disabled={pending} onClick={cancel}>Cancelar</button>
                    <button type="submit" className="danger" disabled={pending || normalizeGroupName(name) !== summary.name}>Eliminar definitivamente</button>
                </div>
            </form> : <>
                <ul>
                    <li>Personas registradas: {summary.people}</li>
                    <li>Ediciones: {summary.editions}</li>
                    {summary.campaigns > 0 && <li>Campañas de recordatorios: {summary.campaigns}</li>}
                </ul>
                <p>Se eliminarán permanentemente todos los datos del grupo. Esta acción no se puede deshacer y los correos ya enviados no se pueden retirar.</p>
                <div className="actions">
                    <button type="button" ref={cancelButton} className="secondary" onClick={cancel}>Cancelar</button>
                    <button type="button" onClick={() => setConfirming(true)}>Continuar</button>
                </div>
            </>}
        </dialog>}
    </section>;
}
