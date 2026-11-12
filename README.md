# secretGift

Organiza un amigo invisible y envía las asignaciones por correo desde la web
local o utiliza la CLI heredada.

## Web local

Necesitas Docker Engine y Docker Compose v2 o posterior. Desde la raíz del repositorio:

```bash
docker compose up --build
```

Abre **http://localhost:8787**. Crea un grupo con nombre y selecciónalo en
«Grupo activo». En «Personas del grupo» añade o edita contactos; puedes activar
o desactivar personas sin borrar su identidad ni su historial. Los cambios del
directorio no modifican los contactos guardados en ediciones anteriores.

Crea una edición con nombre y año, marcando las personas activas que participarán.
Puedes crear varias del mismo año con nombres distintos. «Edición activa» permite
abrirlas después: distingue las pendientes de las sorteadas. El encabezado indica
siempre el grupo y la edición actuales. Cambiar de selección no envía correos.

Antes de sortear puedes incluir personas activas del grupo, añadir participantes
nuevos, editar sus datos para esa edición e indicar una restricción manual de
destinatario anterior.
Retirar a alguien de esa lista no lo desactiva en el directorio. Confirma el
sorteo: no muestra asignaciones ni envía correos. Después se bloquea la lista;
para preparar otro sorteo, crea otra edición o confirma «Reiniciar sorteo».
Las ediciones sorteadas conservan sus datos y muestran fecha y contadores de envío.

Nadie puede regalarse a sí mismo ni repetir su último destinatario conocido del
mismo grupo. La web busca ese antecedente por la identidad estable de cada persona,
aunque cambie su nombre o correo o se ausente varias ediciones. Solo cuenta el
último sorteo verificado de esa persona; si su destinatario ya no participa, no
se añade esa exclusión. Sin antecedente verificado se usa la restricción manual
`previousId`, si existe; el historial verificado tiene prioridad.

El orden es el de confirmación efectiva de los sorteos, independiente del año y
de cuándo se creó la edición. Una edición antigua pendiente o una continuación
ocupa su posición al sortearse. Si un grupo ya tenía varios sorteos antes de esta
actualización, se conservan sin inventar su orden y no generan restricciones automáticas. Si tenía uno solo,
este sí es un antecedente inequívoco de los nuevos sorteos.
Las parejas y exclusiones históricas son privadas y no se muestran en la web.
Si no hay solución, se informa del problema y la edición sigue sin sortear;
no se relajan restricciones ni se guardan resultados parciales.

El acceso está limitado a localhost. Los datos se conservan en un volumen local
al detener la aplicación. Para detenerla, pulsa Ctrl+C y ejecuta:

```bash
docker compose down
```

El límite es de 15 participantes; puedes cambiarlo mediante `MAX_PARTICIPANTS`
al arrancar Docker Compose.

## Datos, migración y copias

La web guarda SQLite en `/app/data/state.sqlite` (volumen `local-data`) y genera
una clave privada en `/app/keys/storage.key` (volumen independiente `local-keys`).
Ambos sobreviven a `docker compose down`, reinicios y recreaciones. **No uses
`docker compose down -v`: elimina los volúmenes y sus datos.** Sin Docker,
`npm run dev:web` usa `data/state.sqlite` y `keys/storage.key`; puedes elegir
rutas con `DATA_FILE` y `DATA_KEY_FILE`, en directorios separados.

SQLite ahora conserva grupos independientes y ediciones con sus propias copias
de participantes, asignaciones y estados de envío. La actualización migra
automáticamente el sorteo existente a un grupo y una edición iniciales, con la
misma clave y sin enviar correos. Haz una copia antes de actualizar; si la
migración se interrumpe, vuelve a arrancar con la base y su clave originales.
El grupo y la edición migrados aparecen en los selectores de la web.

Al actualizar una instalación anterior, conserva su volumen `local-data`.
Si todavía no hay SQLite, la web valida y migra automáticamente `state.json`
del mismo directorio, sin sortear ni enviar correos. Conserva participantes,
restricciones, sorteo y estados de envío. El JSON original permanece sin cifrar:
comprueba en la interfaz los participantes, la confirmación y los contadores de
envío, reinicia y verifica de nuevo. Haz una copia de seguridad antes de retirar
explícitamente ese JSON. Los archivos de la CLI no se importan automáticamente.
Si la migración falla, corrige el problema y vuelve a arrancar; una base existente
no se sobrescribe. No borres una base para intentar corregir un error de clave.

Para obtener una copia consistente, detén la web y copia **ambos directorios
completos**, incluidos los auxiliares de SQLite si los hubiera:

```bash
docker compose stop web
mkdir -p .task/backup/data .task/backup/keys
chmod 700 .task/backup .task/backup/data .task/backup/keys
docker compose cp web:/app/data/. .task/backup/data/
docker compose cp web:/app/keys/. .task/backup/keys/
docker compose start web
```

Usa una carpeta nueva para cada copia. Guarda los datos y la clave en respaldos
privados separados; la carpeta `.task` está excluida de Git. Protege también
cualquier JSON heredado incluido en la copia. Nunca copies solo el archivo
SQLite mientras la aplicación esté escribiendo.

Para restaurar en una instalación nueva, ejecuta `docker compose create web`,
copia el contenido respaldado de `data` a `/app/data/` y el de `keys` a
`/app/keys/` usando `docker compose cp`. Antes de arrancar, ajusta la propiedad
y los permisos de los archivos restaurados:

```bash
docker compose run --rm --no-deps --user root web sh -c \
  'chown -R node:node /app/data /app/keys && chmod 700 /app/data /app/keys && chmod 600 /app/data/* /app/keys/*'
docker compose up -d
```

Restaura el par de respaldos de la misma instalación con la web detenida y los
volúmenes de destino vacíos. Conserva la copia anterior hasta verificar los
participantes y estados restaurados. Perder la clave impide recuperar los datos;
la aplicación rechaza una base con clave ausente, incorrecta o datos dañados.
Si existe la clave pero faltan SQLite y el JSON heredado, el arranque se detiene
para evitar crear una base vacía. Restaura la base con su clave correspondiente
siguiendo el procedimiento anterior.

El cifrado AES-256-GCM protege los campos personales y las relaciones privadas;
**no cifra todo el archivo SQLite**. Identificadores técnicos, fechas y estados
operativos permanecen visibles. No hay rotación de claves en esta versión.
Un administrador con acceso al proceso y a la clave puede recuperar los datos.

## Correo desde la web

Los correos incluyen HTML y una alternativa completa en texto plano. Pulsa
«Vista previa del correo» en la web para abrir un ejemplo en otra pestaña:
solo utiliza datos ficticios, no consulta tu sorteo ni envía correos. No necesita SMTP.

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
correos reales solo para la edición seleccionada**. Cada edición tiene sus propios
contadores y estados. «Actualizar estado» permite consultar el progreso. Los aceptados
por SMTP no se reenvían; esta aceptación no garantiza la recepción en la bandeja
de entrada. Los inciertos requieren confirmación adicional porque podrían
haberse enviado ya. Reiniciar el sorteo abre una edición de trabajo sin sorteo;
la edición anterior conserva sus participantes, asignaciones y estados en SQLite.
Mientras hay un envío activo se bloquean las escrituras. Si otra pestaña cambia
los datos, actualiza el grupo o el estado de la edición antes de volver a intentarlo.

Antes de usarlo con familiares, prueba con tres participantes ficticios y buzones
que controles: confirma el envío, revisa que cada correo contenga solo su propia
asignación y que los tres destinatarios formen un sorteo válido. Provoca un
rechazo en un servidor SMTP de prueba, consulta el fallo y reintenta tras corregirlo:
los aceptados no deben reenviarse ni cambiar las asignaciones. Reinicia con
`docker compose restart` y comprueba que se conservan los estados. Si se interrumpe
un envío, revisa los buzones antes de decidir si reenvías los inciertos.

## Importar archivos de la CLI

La importación es un comando independiente: no sortea ni envía correos. Admite
el array JSON de la CLI, directamente o codificado en Base64. Declara en un plan
si son restricciones manuales (`manual`) o asignaciones generadas (`assignments`);
el nombre del archivo no determina su significado. Prepara las asociaciones con
IDs existentes, altas nuevas u omisiones según el [formato del plan](docs/storage.md#importación-explícita-de-la-cli).

Con Node.js 26 y `npm ci`, usa una instalación web ya inicializada en SQLite v3.
Antes de confirmar, detén la web y [copia la base y su clave](#datos-migración-y-copias).
Guarda el origen y el plan en una carpeta privada excluida de Git, como `.task/import`:

```bash
npm run import:cli -- --source .task/import/origen.json --plan .task/import/plan.json
```

Sin confirmación solo valida y muestra contadores y un código. Revisa el plan y
confirma repitiendo el comando con `--confirm CODIGO`. Usa `--data` y `--key`
para seleccionar la base y su clave, o las variables `DATA_FILE` y `DATA_KEY_FILE`.
Para volúmenes Docker, consulta el [procedimiento de importación](docs/storage.md#importación-explícita-de-la-cli).

Las restricciones crean una edición pendiente y no necesitan fecha histórica.
Las asignaciones exigen fecha **y hora reales conocidas**, además de una posición
cronológica explícita y compatible. Solo el año o el día no bastan; tampoco se
puede insertar antes de una posición 1 ocupada sin reordenar, operación no admitida.
Sus entregas quedan inciertas, nunca aceptadas, y requieren confirmación adicional
si después decides enviarlas desde la web. No se sobrescriben ediciones ni contactos.
Si hay conflictos, corrige el plan y repite la vista previa; un fallo revierte toda
la importación. Para deshacer una importación confirmada, restaura la copia previa
con la web detenida. Los archivos originales se conservan.

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

Uso local sin autenticación ni aislamiento entre personas con acceso. Los archivos de la CLI
y sus asignaciones se guardan sin cifrar; Base64 no ofrece confidencialidad. Protege
el equipo, las copias y los archivos de participantes, asignaciones y credenciales.
