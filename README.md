# secretGift

Aplicación de amigo invisible con una base web local y una CLI heredada
para generar asignaciones y enviar correos.

## Web local

Requisitos: Ubuntu WSL2, Docker Engine y Docker Compose v2 o posterior.
La web solo muestra la portada y el estado de la conexión; no permite realizar sorteos.

Desde la raíz del repositorio:

```bash
docker compose up --build
```

Abre **http://localhost:8787**. La página comprueba la conexión con el backend.
El acceso está limitado a localhost. Para detener el entorno, pulsa Ctrl+C y ejecuta:

```bash
docker compose down
```

Para trabajar fuera de Docker, instala Node.js 26 LTS (>=26.13.0 <27) y npm:

```bash
npm ci
npm run dev:web
```

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
