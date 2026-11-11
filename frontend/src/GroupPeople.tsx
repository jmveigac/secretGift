import { useState, type FormEvent } from 'react';
import type { Person } from './api';

interface Props {
    people: Person[];
    disabled: boolean;
    onSave: (person: { name: string; email: string; active: boolean }, id?: string) => Promise<boolean>;
}
export default function GroupPeople({ people, disabled, onSave }: Props) {
    const [editing, setEditing] = useState<Person | null>(null);
    const [name, setName] = useState(''), [email, setEmail] = useState('');
    function clear() { setEditing(null); setName(''); setEmail(''); }
    async function submit(event: FormEvent) {
        event.preventDefault();
        if (!disabled && await onSave({ name, email, active: editing?.active ?? true }, editing?.id)) clear();
    }
    return <section aria-labelledby="people-title">
        <h2 id="people-title">Personas del grupo</h2>
        <p>El directorio conserva identidades. Cambiar un contacto o desactivarlo no modifica las ediciones existentes.</p>
        <ul>{people.map(person => <li key={person.id}>
            <div className="participant-details">{person.name}<span>{person.email} · {person.active ? 'Activa' : 'Inactiva'}</span></div>
            <div>
                <button className="secondary" disabled={disabled} onClick={() => { setEditing(person); setName(person.name); setEmail(person.email); }}>Editar contacto de {person.name}</button>
                <button className="secondary" disabled={disabled} onClick={() => {
                    if (window.confirm(`¿${person.active ? 'Desactivar' : 'Activar'} a ${person.name}? Se conservarán su identidad y su historial.`)) {
                        void onSave({ ...person, active: !person.active }, person.id).then(ok => { if (ok) clear(); });
                    }
                }}>{person.active ? 'Desactivar' : 'Activar'} a {person.name}</button>
            </div>
        </li>)}</ul>
        <h3>{editing ? 'Editar contacto' : 'Añadir persona al grupo'}</h3>
        <form onSubmit={event => { void submit(event); }}><fieldset disabled={disabled}>
            <label htmlFor="person-name">Nombre de persona</label>
            <input id="person-name" value={name} onChange={e => setName(e.target.value)} required maxLength={100} />
            <label htmlFor="person-email">Correo de persona</label>
            <input id="person-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} />
            <button>Guardar persona</button>
            <button type="button" className="secondary" onClick={clear}>Cancelar contacto</button>
        </fieldset></form>
    </section>;
}
