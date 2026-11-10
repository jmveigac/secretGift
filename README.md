# secretGift

Aplicación de amigo invisible con una base web local y una CLI heredada
para generar asignaciones y enviar correos.

## Web local

Requisitos: Ubuntu WSL2, Docker Engine y Docker Compose v2 o posterior.
Añade o edita participantes y selecciona opcionalmente su destinatario anterior.
Confirma el sorteo para generar las asignaciones sin mostrarlas ni enviar correos.
Para cambiar la lista tras sortear, confirma «Reiniciar sorteo»; conserva los participantes.

Desde la raíz del repositorio:

```bash
docker compose up --build
```

Abre **http://localhost:8787**. Los datos se conservan en un volumen local incluso después de detener Docker.
El acceso está limitado a localhost. Para detener el entorno, pulsa Ctrl+C y ejecuta:

```bash
docker compose down
```

Para trabajar fuera de Docker, instala Node.js 26 LTS (>=26.13.0 <27) y npm:

```bash
npm ci
npm run dev:web
```

Este comando compila React con Vite y arranca la web en **http://localhost:8787**.
Para recompilar la interfaz al editarla, usa `npm run watch:frontend` en otra terminal
y recarga el navegador. Para compilar sin arrancar, ejecuta `npm run build:web`;
el resultado se sirve con `node build/web/server.js`.
`npm test` ejecuta las pruebas del backend y de los componentes React.

La ruta JSON se configura con `DATA_FILE` (por defecto `./data/state.json` fuera
de Docker); `MAX_PARTICIPANTS` limita la lista (15 por defecto). Para empezar con
otra lista, reinicia el sorteo y elimina los participantes desde la interfaz.

Uso local sin autenticación: no existe aislamiento entre personas con acceso.
El archivo contiene correos y asignaciones sin cifrar, con permisos restrictivos;
protege el equipo y sus copias. Base64 tampoco proporciona confidencialidad.

## CLI heredada

Usa la misma instalación de Node.js y dependencias indicada arriba.
Crea un archivo `.env` en la raíz con tu configuración SMTP. Este ejemplo
contiene valores ficticios: sustituye los campos antes de usar la CLI.

```dotenv
FROM='"Organizador" <organizador@example.invalid>'
HOST='smtp.example.invalid'
PORT='587'
MAILUSER=''
MAILPWD=''
SUBJECT='Amigo invisible'
TESTMAIL='prueba@example.invalid'
```

Para un nuevo sorteo, puedes introducir los participantes por consola o cargar
`participants.json` desde la raíz. Debe contener un array JSON codificado en
Base64, no JSON plano. Ejemplo sintético listo para codificar en Ubuntu:

```bash
base64 -w 0 > participants.json <<'JSON'
[
  {"name":"A","email":"a@example.invalid","lastGift":""},
  {"name":"B","email":"b@example.invalid","lastGift":""},
  {"name":"C","email":"c@example.invalid","lastGift":""}
]
JSON
```

`lastGift` es el nombre de quien recibió el regalo el año anterior; usa `""`
si no existe. Los nombres deben ser únicos.

La CLI puede enviar correos reales.

```bash
npm start
```

Elige `1` para generar un sorteo y enviarlo por correo. La CLI guarda el resultado
en `newParticipants.json`, también en Base64. Para reenviar, elige `2` y conserva
ese archivo en la raíz; contiene las asignaciones privadas que se volverán a enviar.
