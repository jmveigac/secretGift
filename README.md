# secretGift

Organiza un amigo invisible y envía las asignaciones por correo desde la web
local o utiliza la CLI heredada.

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

## Correo desde la web

Crea un archivo privado `.env` en la raíz (no lo compartas ni lo añadas a Git):

```dotenv
FROM='"Organizador" <organizador@example.invalid>'
HOST='smtp.example.invalid'
PORT='587'
MAILUSER='usuario-smtp'
MAILPWD='contraseña-smtp'
```

Usa los valores de tu servidor SMTP; el puerto 465 utiliza TLS directo. Si el
servidor no requiere autenticación, deja `MAILUSER` y `MAILPWD` vacíos.
Recrea la aplicación con `docker compose up --build`. Sin SMTP configurado
puedes preparar y confirmar el sorteo, pero no enviar correos.

Tras sortear, pulsa «Enviar pendientes y fallidos» y confirma: **se enviarán
correos reales**. «Actualizar estado» permite consultar el progreso. Los aceptados
por SMTP no se reenvían; esta aceptación no garantiza la recepción en la bandeja
de entrada. Los inciertos requieren confirmación adicional porque podrían
haberse enviado ya. Reiniciar el sorteo descarta sus asignaciones y estados de envío.

Antes de usarlo con familiares, prueba con tres participantes ficticios y buzones
que controles: confirma el envío, revisa que cada correo contenga solo su propia
asignación y que los tres destinatarios formen un sorteo válido. Provoca un
rechazo en un servidor SMTP de prueba, consulta el fallo y reintenta tras corregirlo:
los aceptados no deben reenviarse ni cambiar las asignaciones. Reinicia con
`docker compose restart` y comprueba que se conservan los estados. Si se interrumpe
un envío, revisa los buzones antes de decidir si reenvías los inciertos.

## CLI heredada

Necesitas Node.js 26 (>=26.13.0 <27) y npm. Desde la raíz del repositorio:

```bash
npm ci
```

Configura `.env` como se indica arriba y añade `SUBJECT='Amigo invisible'`
para el asunto de los correos de la CLI.

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
