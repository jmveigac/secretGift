# secretGift

Organiza un amigo invisible desde la web local o utiliza la CLI heredada para
sortear y enviar las asignaciones por correo.

## Web local

Necesitas Docker Engine y Docker Compose v2 o posterior. Desde la raíz del repositorio:

```bash
docker compose up --build
```

Abre **http://localhost:8787**. Añade o edita participantes e indica opcionalmente
su destinatario anterior. Confirma el sorteo: no muestra asignaciones ni envía
correos. Para modificar la lista después, confirma «Reiniciar sorteo»; conserva
los participantes. Para empezar con otra lista, elimínalos desde la interfaz.

El acceso está limitado a localhost. Los datos se conservan en un volumen local
al detener la aplicación. Para detenerla, pulsa Ctrl+C y ejecuta:

```bash
docker compose down
```

El límite es de 15 participantes; puedes cambiarlo mediante `MAX_PARTICIPANTS`
al arrancar Docker Compose.

## CLI heredada

Necesitas Node.js 26 (>=26.13.0 <27) y npm. Desde la raíz del repositorio:

```bash
npm ci
```

Crea `.env` con tu configuración SMTP; sustituye estos valores ficticios:

```dotenv
FROM='"Organizador" <organizador@example.invalid>'
HOST='smtp.example.invalid'
PORT='587'
MAILUSER=''
MAILPWD=''
SUBJECT='Amigo invisible'
```

Puedes introducir los participantes por consola o cargar `participants.json`
desde la raíz: un array JSON codificado en Base64. Ejemplo sintético (GNU `base64`):

```bash
base64 -w 0 > participants.json <<'JSON'
[
  {"name":"A","email":"a@example.invalid","lastGift":""},
  {"name":"B","email":"b@example.invalid","lastGift":""},
  {"name":"C","email":"c@example.invalid","lastGift":""}
]
JSON
```

Los nombres y correos deben ser únicos. `lastGift` es el nombre de otro
participante que recibió el regalo el año anterior, o `""` si no existe.

**La CLI envía correos reales.** Ejecuta:

```bash
npm start
```

Elige `1` para sortear y enviar. El resultado se guarda en `newParticipants.json`
en Base64. Elige `2` para reenviar las asignaciones de ese archivo, que debe estar
en la raíz.

Uso local sin autenticación ni aislamiento entre personas con acceso. Los datos
y asignaciones se guardan sin cifrar; Base64 no ofrece confidencialidad. Protege
el equipo, las copias y los archivos de participantes, asignaciones y credenciales.
