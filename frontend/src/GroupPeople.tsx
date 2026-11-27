import { Avatar } from './VisualIdentity';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Person } from './api';

interface Props {
    people: Person[];
    disabled: boolean;
    onSave: (person: { name: string; email: string; active: boolean }, id?: string) => Promise<boolean>;
}

export default function GroupPeople({ people, disabled, onSave }: Props) {
    const nameInput = useRef<HTMLInputElement>(null);
    const addButton = useRef<HTMLButtonElement>(null);
    const origin = useRef<HTMLButtonElement | null>(null);
    const focusAfterSave = useRef<HTMLElement | null>(null);
    const [open, setOpen] = useState(false), [editing, setEditing] = useState<Person>();
    const [name, setName] = useState(''), [email, setEmail] = useState('');
    const [validation, setValidation] = useState<{ name?: string; email?: string }>({});
    const [notice, setNotice] = useState('');
    const [sending, setSending] = useState(false);
    const sendingRef = useRef(false);
    const busy = disabled || sending;

    useEffect(() => { if (open) nameInput.current?.focus(); }, [open, editing]);
    useEffect(() => {
        if (busy || !focusAfterSave.current) return;
        focusAfterSave.current.focus();
        focusAfterSave.current = null;
    }, [busy]);
    function clear() { setEditing(undefined); setName(''); setEmail(''); setValidation({}); }
    function close() { clear(); setOpen(false); (origin.current ?? addButton.current)?.focus(); }
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy || sendingRef.current) return;
        const next = {
            name: name.trim() ? undefined : 'Escribe el nombre de la persona.',
            email: event.currentTarget.querySelector<HTMLInputElement>('input[type="email"]')?.validity.valid ? undefined : 'Escribe una dirección de correo válida.',
        };
        setValidation(next);
        if (next.name || next.email) {
            event.currentTarget.querySelector<HTMLInputElement>(next.name ? '#person-name' : '#person-email')?.focus();
            return;
        }
        const another = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'another';
        sendingRef.current = true; setSending(true);
        try {
            if (await onSave({ name, email, active: editing?.active ?? true }, editing?.id)) {
                setNotice(editing ? 'Contacto actualizado.' : 'Persona añadida.');
                clear();
                if (another) focusAfterSave.current = nameInput.current;
                else { setOpen(false); focusAfterSave.current = origin.current ?? addButton.current; }
            }
        } finally { sendingRef.current = false; setSending(false); }
    }
    return <section aria-labelledby="people-title">
        <div className="section-heading"><h2 id="people-title">Participantes del grupo</h2>
            <button ref={addButton} disabled={busy} onClick={() => { origin.current = addButton.current; clear(); setOpen(true); nameInput.current?.focus(); }}>Añadir persona</button>
        </div>
        <p>Estar en el grupo permite participar. En cada sorteo eliges quién entra. Los cambios al contacto no modifican sorteos anteriores.</p>
        {notice && <p role="status">{notice}</p>}
        {open && <form className="contact-form" noValidate onSubmit={event => { void submit(event); }}><fieldset disabled={busy}>
            <legend>{editing ? 'Editar contacto' : 'Nueva persona'}</legend>
            <label htmlFor="person-name">Nombre de persona</label>
            <input ref={nameInput} id="person-name" value={name} onChange={event => { setName(event.target.value); setValidation(current => ({ ...current, name: undefined })); }}
                required maxLength={100} aria-invalid={!!validation.name} aria-describedby={validation.name ? 'person-name-error' : undefined} />
            {validation.name && <p className="field-error" id="person-name-error">{validation.name}</p>}
            <label htmlFor="person-email">Correo de persona</label>
            <input id="person-email" type="email" value={email} onChange={event => { setEmail(event.target.value); setValidation(current => ({ ...current, email: undefined })); }}
                required maxLength={254} aria-invalid={!!validation.email} aria-describedby={validation.email ? 'person-email-error' : undefined} />
            {validation.email && <p className="field-error" id="person-email-error">{validation.email}</p>}
            <div className="actions"><button>Guardar persona</button>
                {!editing && <button className="secondary" value="another">Guardar y añadir otra</button>}
                <button type="button" className="secondary" onClick={close}>Cancelar contacto</button></div>
        </fieldset></form>}
        {!people.length && <p>Aún no hay personas en este grupo.</p>}
        <ul className="directory-list">{people.map(person => <li key={person.id}>
            <div className="person-identity"><Avatar name={person.name} /><div className="participant-details"><strong>{person.name}</strong><span>{person.email} · {person.active ? 'Activa' : 'Inactiva'}</span></div></div>
            <div className="actions">
                <button className="secondary" disabled={busy} aria-label={`Editar contacto de ${person.name}`} onClick={event => {
                    origin.current = event.currentTarget; setEditing(person); setName(person.name); setEmail(person.email); setValidation({}); setOpen(true);
                }}>Editar</button>
                <button className="secondary" disabled={busy} aria-label={`${person.active ? 'Desactivar' : 'Activar'} a ${person.name}`} onClick={event => {
                    const button = event.currentTarget;
                    if (window.confirm(`¿${person.active ? 'Desactivar' : 'Activar'} a ${person.name}? Se conservará su historial.`)) {
                        void onSave({ ...person, active: !person.active }, person.id).then(ok => { if (ok) {
                            setNotice(person.active ? 'Persona desactivada.' : 'Persona activada.');
                            button.focus();
                        } });
                    }
                }}>{person.active ? 'Desactivar' : 'Activar'}</button>
            </div>
        </li>)}</ul>
    </section>;
}
