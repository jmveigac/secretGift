# secretGift

Organiza un amigo invisible y envía las asignaciones por correo desde la web
local o utiliza la CLI heredada.

## Web local

Necesitas Docker Engine y Docker Compose v2 o posterior. Desde la raíz del repositorio:

```bash
docker compose up --build
```

Abre **http://localhost:8787**. La navegación separa cuatro operaciones:

- **Mis grupos:** abre un grupo para consultar sus sorteos, gestionar participantes
  o cambiar su nombre. Editar o desactivar contactos conserva sus identidades y no
  altera las copias guardadas en sorteos anteriores.
- **Nuevo sorteo:** sigue los cinco pasos de grupo, participantes, antecedentes,
  fecha y revisión. Puedes crear un grupo y añadir o editar contactos en el proceso.
  Desmarcar a alguien lo excluye solo de este sorteo; desactivarlo afecta al directorio.
- **Recordar sorteo:** selecciona un sorteo confirmado y reenvía a todos sus
  asignaciones originales, incluidos quienes recibieron el primer correo. Cada
  recordatorio conserva su propia campaña y sus resultados de entrega.
- **Repetir sorteo:** parte de uno anterior para crear una edición nueva. Propone
  sus participantes que siguen activos y permite revisar selección, título y fecha.
  Conserva el sorteo original y aplica los antecedentes vigentes.

Cada grupo puede celebrar varios sorteos del mismo año, con sus propios títulos y
fechas. El historial muestra estado, notificaciones y disponibilidad de resultados.
Los borradores existentes se pueden abrir y preparar antes de confirmarlos.
Confirmar genera y guarda las asignaciones, **sin enviar correos**. Si no existe
solución, se informa y no se guarda un sorteo parcial.

En «Antecedentes» indica únicamente relaciones conocidas de sorteos externos,
completas o parciales, entre personas seleccionadas. Deja vacío lo desconocido;
si el destinatario anterior no participa, no hace falta una exclusión manual.
No se inventa un sorteo histórico para completar huecos. Nadie se regala a sí mismo
ni repite su último destinatario verificado del mismo grupo. Ese historial tiene
prioridad sobre el antecedente manual; si el destinatario verificado está ausente,
no se aplica otra exclusión manual en su lugar. La revisión explica qué fuente
se utiliza sin mostrar parejas privadas. Los antecedentes manuales pertenecen a
la nueva edición, no modifican el historial verificado del grupo.

Indica fecha, hora y zona horaria del evento (por defecto `Europe/Madrid`). Esa será
también la fecha de revelación. El servidor rechaza horas ambiguas o inexistentes
por cambios de horario; elige otra hora. Una fecha pasada deja los resultados
disponibles al confirmar. La fecha queda fija cuando se confirma el sorteo.

Hasta la revelación, las asignaciones permanecen ocultas **incluso al organizador**:
la API también deniega su consulta. La decisión usa el reloj del servidor, no el
navegador. Al llegar la fecha, actualiza el estado y pulsa «Ver resultados»; no
necesitas mantener abierta la página. Los correos individuales y recordatorios
pueden contener la asignación antes de esa fecha.

Los sorteos anteriores sin fecha de revelación permanecen ocultos; no se deduce
una fecha de su año ni se permite adelantarla mediante una edición ordinaria.
No hay una herramienta de regularización para esos sorteos en esta versión.
Esta protección temporal no es autenticación: después de revelar, cualquier
persona con acceso local a la aplicación podrá consultar los resultados. Un
administrador con acceso a la base y su clave puede leer los datos internos.

«Ayuda y herramientas» contiene la vista previa de correo con datos ficticios.

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
APP_MODE=test
TEST_EMAIL=pruebas@example.invalid
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

Configura `APP_MODE=test` para dirigir **todos los mensajes exclusivamente a
`TEST_EMAIL`**, una única dirección sin nombre visible. Web y CLI aplican la misma
redirección, también en reintentos. Cada participante genera un mensaje individual
con su asignación original, marcado como prueba e identificado por su nombre.
Los contactos y las asignaciones guardados no cambian. El buzón de pruebas recibirá
asignaciones privadas: usa únicamente uno que controles.

`APP_MODE=production` permite enviar a los participantes originales. Si falta
`APP_MODE`, tiene otro valor o falta un `TEST_EMAIL` válido en pruebas, se bloquean
los envíos; no se sustituye el buzón de pruebas por direcciones reales.
**Las instalaciones anteriores deben elegir un modo explícitamente.** Las variables
SMTP existentes se conservan.

Abre el sorteo y pulsa «Enviar … notificaciones». La web muestra el modo y, en
pruebas, el buzón efectivo; la confirmación indica el número de mensajes.
Los resultados de pruebas y producción se conservan por separado para cada edición:
`pending` (pendiente), `failed` (rechazo), `uncertain` (resultado incierto) y
`accepted` (aceptado por SMTP, sin garantizar recepción). Los aceptados no se
reenvían en ese modo; reenviar inciertos requiere confirmación adicional y puede
producir duplicados. «Actualizar estado» consulta el progreso. Un error HTTP se
muestra como alerta; completar una solicitud no significa que todos fueran aceptados.
Los recordatorios tienen campañas independientes; reintenta la campaña fallida
en lugar de crear otra si quieres evitar duplicar los mensajes ya aceptados.
Las campañas de prueba solo pueden reintentarse en modo pruebas, y las de
producción en producción.

Para cambiar de modo, actualiza tu `.env` privado y recrea la aplicación con
`docker compose up -d --build`; recarga la página y comprueba modo y contadores.
Cambiar de modo no envía nada. Las aceptaciones de prueba no completan entregas
reales: en producción será necesaria otra confirmación. Cambiar `TEST_EMAIL` no
reinicia los estados de prueba ni reenvía los ya aceptados; usa otra edición si
necesitas una nueva tanda. Mientras hay un envío activo se bloquean escrituras;
si otra pestaña modifica la edición, actualiza antes de confirmar de nuevo.

Para una prueba SMTP real posterior, con autorización del organizador: configura
`APP_MODE=test`, un buzón propio y el SMTP del proveedor; recrea, recarga y verifica
el destino antes de confirmar. Con cuatro participantes deben llegar cuatro
mensajes individuales al único buzón, manteniendo producción pendiente. Revisa
contenido, contadores y persistencia tras reiniciar. Antes de reintentar inciertos,
comprueba el buzón. Solo después cambia explícitamente a producción si deseas
entregar a los participantes. Esta comprobación externa no forma parte de las
pruebas automatizadas, que utilizan SMTP simulado.

## Importar archivos de la CLI

La importación es un comando independiente: no sortea ni envía correos. Admite
el array JSON de la CLI, directamente o codificado en Base64. Declara en un plan
si son restricciones manuales (`manual`) o asignaciones generadas (`assignments`);
el nombre del archivo no determina su significado. Prepara las asociaciones con
IDs existentes, altas nuevas u omisiones según el [formato del plan](docs/storage.md#importación-explícita-de-la-cli).

Con Node.js 26 y `npm ci`, usa una instalación web ya inicializada en SQLite v5.
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

**La CLI envía según `APP_MODE`, sin los contadores persistidos de la web.** Ejecuta:

```bash
npm start
```

Elige `1` para sortear y enviar. El resultado se guarda en `newParticipants.json`
en Base64. Elige `2` para reenviar las asignaciones de ese archivo, que debe estar
en la raíz.

Uso local sin autenticación ni aislamiento entre personas con acceso. Los archivos de la CLI
y sus asignaciones se guardan sin cifrar; Base64 no ofrece confidencialidad. Protege
el equipo, las copias y los archivos de participantes, asignaciones y credenciales.
