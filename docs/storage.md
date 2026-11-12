# Modelo SQLite v3

`PRAGMA user_version` versiona el esquema; `State.version=1` sigue describiendo
el estado de una edición; el contrato HTTP anterior sigue siendo compatible. Los tipos y su
validación residen en `src/domain/editions.ts`.

## Identidades e instantáneas

| Tabla | Identidad y responsabilidad |
| --- | --- |
| `groups` | UUID estable y nombre cifrado. |
| `people` | `(group_id, id)`: identidad estable, contacto actual cifrado y pertenencia activa/inactiva. Nunca se identifica por nombre o correo. |
| `editions` | UUID estable, grupo, nombre cifrado y año. El año y el nombre no son claves únicas. |
| `participants` | `(group_id, edition_id, id)`: participación de una persona, posición y copia cifrada de nombre, correo y exclusión anterior. |
| `draw` | `(group_id, edition_id)`: fecha y revisión de envío de una edición sorteada. |
| `assignments` | `(group_id, edition_id, giver)`: destinatario cifrado y estado SMTP individual. |
| `compatibility` | Fila única con el grupo inicial y la edición de trabajo de la API actual. |
| `metadata` | Verificador autenticado de la clave. |

Las claves foráneas compuestas exigen que personas, participaciones y sorteo
pertenezcan al mismo grupo y edición. El destinatario y las exclusiones están
cifrados: su pertenencia y unicidad se comprueban al descifrar y validar el
estado completo de cada edición. Las relaciones históricas se consultan mediante
los IDs de persona de esas instantáneas, nunca mediante contactos.

Los contextos AAD de v2 incluyen grupo, edición, tipo e ID de fila; los del
directorio incluyen grupo e ID de persona. Copiar contenido cifrado a otra
edición o grupo falla la autenticación. Se conserva el formato del sobre
AES-GCM y el contexto del verificador de clave.

## Operaciones internas y compatibilidad

`EncryptedDatabase` ofrece `createGroup`, `listGroups`, `putPerson`, `listPeople`,
`createEdition`, `listEditions`, `readEdition`, `writeEdition`, `renameGroup` y
`forkEdition`. `LocalStore` aplica la validación de ámbito y el bloqueo antes de
exponerlas en HTTP. `createEdition`
copia contactos de personas activas del grupo; `putPerson` nunca modifica esas
copias. Desactivar una persona permite conservar su identidad e historial.
Una edición sorteada rechaza cambios de participantes, asignaciones y fecha;
solo pueden actualizarse sus estados de entrega y revisión.

`read` y `write` adaptan las rutas anteriores de `LocalStore` a `compatibility`. Un reinicio de
un sorteo conserva la edición sorteada y cambia el puntero a una nueva edición
sin sorteo con la misma lista. Editar o retirar participantes en esa lista no
altera el historial. Los cambios de entrega no reescriben los contactos actuales
del directorio. Se mantienen los bloqueos de `LocalStore`: cualquier futura
capa de aplicación debe adquirir el bloqueo de almacenamiento antes de realizar
operaciones de negocio o envíos. Las transacciones del repositorio no sustituyen
ese bloqueo ni las reglas de confirmación/reintentos SMTP.

## Transición de esquema

La apertura de v1 autentica la clave y valida integridad, relaciones y todo el
estado antes de reemplazar sus tablas. Una sola transacción `BEGIN IMMEDIATE`
crea el modelo v2 y vuelve a cifrar los registros con sus nuevos contextos.
Conserva los IDs de personas, fecha, revisión y estados; el año inicial se toma
de la fecha UTC del sorteo o del año UTC actual si todavía no hay sorteo.
Antes de confirmar, valida todas las entidades y compara el estado reconstruido
con el original. El cambio a `user_version=2` pertenece a esa transacción.
No se utiliza una segunda base ni una nueva clave. JSON heredado e instalaciones
nuevas se inicializan directamente como v2 mediante la publicación atómica ya
existente.

No hay migración inversa: para volver a una versión antigua se debe restaurar
la copia anterior a la actualización, con la web detenida. La apertura
valida todas las ediciones; su coste crece con el historial y deberá revisarse
si el volumen deja de ser pequeño y local.

## API de grupos y ediciones

El esquema pasa a v3; los sobres cifrados existentes no cambian. No hay selección global
de grupo o edición en el servidor: cada operación nueva lleva ambos IDs en la URL.

| Ruta | Operaciones |
| --- | --- |
| `/api/groups` | GET/HEAD lista grupos; POST crea uno. |
| `/api/groups/:g` | GET/HEAD devuelve directorio y resúmenes operativos propios; PUT cambia el nombre. |
| `/api/groups/:g/people` | POST crea una identidad activa o inactiva. |
| `/api/groups/:g/people/:p` | PUT edita contacto y pertenencia activa. No hay borrado. |
| `/api/groups/:g/editions` | POST crea una edición con nombre, año y `personIds` activos. |
| `/api/groups/:g/editions/:e` | GET/HEAD devuelve el estado público de esa edición. |
| `/api/groups/:g/editions/:e/participants[/:p]` | POST añade una persona del grupo (`personId`) o una nueva; PUT/DELETE editan o retiran una participación sin sorteo. |
| `/api/groups/:g/editions/:e/draw[/send\|/reset]` | POST confirma sorteo, envío o creación de una continuación sin sorteo. |

Cada escritura, salvo crear un grupo, exige `expectedRevision` del grupo o edición
leídos. Es un HMAC del estado y del ámbito con la clave existente; un hash público
del sorteo permitiría probar combinaciones de asignaciones. Se compara con el
estado actual después de adquirir el bloqueo. Son revisiones del contenido, no
contadores persistentes: un estado idéntico produce la misma revisión. El envío
exige además la fecha y revisión SMTP existentes. Incluir una persona del
directorio en una edición exige también `expectedGroupRevision`, para no copiar
un contacto que cambió desde su selección. Las respuestas de una escritura
usan el estado persistido, incluidos los estados `pending` normalizados.

Todos los escritores HTTP comparten el bloqueo de almacenamiento, incluido el
directorio y otros grupos. Las lecturas durante SMTP no cambian el historial.
Los contactos son únicos entre personas activas del mismo grupo; los nombres de
grupo son únicos y una edición no puede repetir nombre y año dentro de su grupo
en las nuevas operaciones HTTP. Las comparaciones ignoran mayúsculas.

`writeEdition` puede insertar una nueva identidad y su participación en una misma
transacción. Editar una participación solo altera su instantánea sin sorteo, no
el directorio. `forkEdition` mantiene la edición original y actualiza el puntero
de compatibilidad solo si esa era la edición de trabajo anterior.

Los endpoints anteriores siguen operando sobre `compatibility`, no sobre la
selección del navegador; la nueva interfaz utiliza exclusivamente rutas con
ámbito. Los resúmenes no contienen asignaciones y el estado público conserva la
lista explícita de campos de `StateResponse`. Los antecedentes intervienen internamente en el algoritmo sin exponerse en estas respuestas.


## Orden histórico y restricciones (v3)

La migración v2→v3 añade a `draw` `history_sequence` (entero positivo nullable),
`restrictions` (BLOB cifrado nullable) y un índice único `(group_id, history_sequence)`.
Autentica y valida toda la base antes del DDL, valida después y confirma columnas,
índice y `user_version=3` en una transacción `BEGIN IMMEDIATE`. Una interrupción
revierte la transacción; el siguiente arranque puede reintentar. No reescribe
asignaciones, contactos, fechas, estados SMTP ni la clave. Las entradas v1 pasan
primero por la migración existente a v2; una interrupción entre ambas deja v2
válida y la migración a v3 se reintenta al abrir.

Cada sorteo nuevo recibe `MAX(history_sequence)+1` de su grupo dentro de la
transacción que guarda el resultado completo. La secuencia representa el orden
real de confirmación; no el año de referencia, la creación de ediciones ni el reloj.
Varias ediciones del mismo año se ordenan por confirmación. Una edición antigua
pendiente y una continuación se sitúan cuando se sortean; hasta entonces carecen
de posición y no aportan antecedentes. La secuencia se conserva al actualizar SMTP.
La lectura de antecedentes, control de revisión y escritura HTTP comparten el
bloqueo de almacenamiento. El repositorio vuelve a comprobar las restricciones
antes de guardar en su transacción. La revisión HMAC de edición incluye los
antecedentes aplicables para rechazar confirmaciones obsoletas.

En grupos con varios sorteos migrados, esas entradas quedan con secuencia y
restricciones `NULL`: no hay datos suficientes para certificar su secuencia real. No se deduce de UUID, `rowid`,
nombre, año ni fecha del sorteo, ni siquiera cuando las fechas son distintas.
Si un grupo contiene un solo sorteo al migrar, recibe la posición 1: no hay
ambigüedad relativa y precede inequívocamente a las futuras confirmaciones. Sus
restricciones permanecen `NULL`; su instantánea y envíos siguen siendo válidos
con las reglas originales. No existe interfaz para ordenar estas entradas. La herramienta de importación puede proporcionar posiciones explícitas libres
en esta secuencia por grupo, verificando su relación con las posiciones existentes.
No reordena el historial.

Para cada ID estable se toma su última asignación en una edición del mismo grupo
con secuencia menor; una edición pendiente utiliza las posiciones ya confirmadas.
Cada persona puede tener un antecedente de una edición diferente. Se ignoran las
ediciones sin secuencia verificada y sin sorteo. No se buscan coincidencias de
contacto ni se acumulan destinatarios de años anteriores. El destinatario automático
tiene prioridad sobre `previousId`; si ya no participa, no se añade exclusión y
no se recupera la manual como sustituto. Sin antecedente verificado se conserva
`previousId`. La interfaz identifica este campo como manual.

`drawParticipants` recibe IDs como identificadores y mantiene su emparejamiento
aleatorio. Se prohíben la autoasignación y el destinatario anterior aplicable,
exigiendo una permutación completa. Si no existe solución, HTTP devuelve 422
sin parejas privadas ni modificaciones persistidas. Las restricciones efectivas
se guardan cifradas con AAD de grupo/edición, como instantánea inmutable del sorteo.
`validateState` usa esa instantánea para los nuevos sorteos y `previousId` para
los heredados; no reinterpreta sorteos confirmados al crecer el historial.
Los endpoints mantienen listas explícitas de campos públicos: nunca devuelven
asignaciones, la instantánea de restricciones ni destinatarios históricos.


## Importación explícita de la CLI

`npm run import:cli -- --source ARCHIVO --plan PLAN [--data SQLITE] [--key CLAVE]`
valida y devuelve solo contadores y un código HMAC. `--confirm CODIGO` confirma
exactamente esa vista previa. `--help` muestra las opciones. No importa al arrancar
la web. Requiere una instalación v3 existente: no inicializa ni migra bases.
Las rutas y `MAX_PARTICIPANTS` usan los valores habituales de la web; el límite
por defecto es 15 participantes seleccionados (máximo configurable 100).

**Significado verificado en la CLI:** `participants.json` es entrada: `lastGift`
expresa una restricción manual anterior, posiblemente vacía. `drawParticipants`
sustituye ese campo en su resultado por el destinatario generado; `writeJson`
escribe `newParticipants.json` antes de que `src/index.ts` intente enviar correo.
El fichero resultante conserva las parejas generadas, no las restricciones de
entrada ni pruebas de entrega SMTP. El modo de reenvío vuelve a usar esas parejas.
Los dos archivos tienen idéntica estructura y no llevan identificadores,
procedencia, grupo, fecha, año, secuencia ni estados de envío: el organizador debe
declarar el significado y comprobar que el origen corresponde al sorteo deseado.
Una permutación estructuralmente válida por sí sola no acredita su procedencia.

El origen admite un array JSON UTF-8 o su codificación Base64 canónica, con
espacios/saltos de línea entre bloques Base64. Cada objeto contiene exactamente
`name`, `email` y `lastGift`, todos de tipo string. Se rechazan campos desconocidos,
controles, contactos inválidos, nombres con espacios no normalizados, duplicados
ignorando mayúsculas y referencias a destinatarios inexistentes o a uno mismo.
Los nombres de `lastGift` deben coincidir exactamente con un nombre del archivo;
solo sirven para interpretar las referencias internas de ese fichero. Nunca se
usan para enlazar personas entre archivos o con el directorio. Ambos archivos
(origen y plan) deben ser regulares y no superar 1 MiB; el origen admite 1–100 filas.
Base64 no cifra; protege ambos archivos y no los versiones.

El plan es JSON UTF-8. Ejemplo de estructura **ficticia**, para tres registros:

```json
{
  "mode": "manual",
  "target": { "newGroup": "Grupo de prueba" },
  "edition": { "name": "Edición de prueba", "year": 2001 },
  "identities": [
    { "record": 0, "new": true },
    { "record": 1, "new": true },
    { "record": 2, "new": true }
  ]
}
```

- `mode` es obligatorio: `manual` crea una edición pendiente con `previousId`;
  `assignments` guarda parejas ya generadas como un sorteo histórico confirmado.
  No se deduce del nombre, contenido o extensión del archivo.
- `target` contiene **solo** `groupId` de un grupo existente o `newGroup` con un
  nombre nuevo. Puedes consultar los IDs de grupo en la respuesta local de
  `/api/groups` y los de persona en `/api/groups/ID`, desde el navegador. No publiques
  esas respuestas ni el plan. La selección del navegador no selecciona el destino
  del comando. Un ID ajeno o inexistente produce error.
- `edition` declara nombre y año de referencia para una edición nueva. No se
  sobrescribe una existente, aunque esté pendiente. Nombre y año repetidos se
  rechazan. El año de referencia no establece la cronología del sorteo.
- `identities` contiene una entrada por índice de fila, empezando por cero. Cada
  entrada declara exactamente una opción: `personId` con el UUID existente,
  `new: true` o `skip: true`. No hay asociación automática por nombre/correo.
  Los IDs asociados deben pertenecer al grupo, sin repetirse. Una coincidencia
  de contacto con cualquier persona existente bloquea `new`: debe resolverse
  mediante asociación explícita u omisión. No se actualiza ni reactiva a la persona
  asociada; la edición conserva el contacto del archivo como instantánea.
  Se puede omitir un registro solo si no deja referencias de participantes
  seleccionados apuntando fuera de la selección. No se eliminan referencias
  silenciosamente. La selección no puede quedar vacía.
- Solo `assignments` exige `history`, por ejemplo
  `{ "completedAt": "2001-05-06T12:30:00.000Z", "sequence": 1 }` con valores
  reales proporcionados expresamente. La fecha debe ser un instante UTC completo
  válido `YYYY-MM-DDTHH:mm:ss.sssZ`, no futuro. No se sustituye por la fecha de
  importación ni se completan horas desconocidas. Si solo se conoce año o día,
  o no se verifica la posición, el archivo no puede importarse como sorteo.
  `manual` no admite `history`. No convierte asignaciones en restricciones
  automáticamente para eludir metadatos ausentes.

En modo asignaciones el origen completo debe ser una permutación sin
autoasignaciones y con al menos dos participantes seleccionados. Omitir personas
solo es posible si la selección conserva ciclos completos; no se generan parejas
nuevas ni sorteos parciales. Los estados SMTP se guardan como `uncertain`: expresan
que no existe evidencia del resultado de envío, no que se haya realizado un
intento desde la web. No se inventan éxitos, fallos ni pendientes acreditados.
El importador no carga el transporte SMTP. En la web, enviar estos inciertos
exige la confirmación adicional existente; la importación nunca lo hace.

### Compatibilidad cronológica e integridad

`sequence` es una posición entera positiva explícita y libre en el grupo. No se
asigna por fecha ni por orden de importación. Las fechas declaradas deben ser
compatibles con **todos** los sorteos con posición conocida: no anterior a un
predecesor ni posterior a un sucesor. Instantes iguales se ordenan por la posición
expresamente declarada. Se rechaza un grupo que contenga sorteos sin secuencia,
porque no se puede certificar la posición relativa a ellos. Esas entradas no se
modifican. Una posición libre puede ser un hueco o estar después del máximo;
si la posición 1 está ocupada, v3 no permite insertar un antecedente anterior sin
reordenar. El comando rechaza el caso. No se renumeran posiciones, ni se inventan
grupos alternativos para eludirlo. No es necesario que las posiciones sean contiguas.
Los siguientes sorteos web continúan usando `MAX(history_sequence)+1`.

Antes de escribir se comprueba la última asignación conocida de cada persona por
ID en la secuencia. Tanto el sorteo importado como sus sucesores deben evitar
repetir ese destinatario. Un conflicto revierte la importación sin revelar las
parejas implicadas. Las restricciones efectivas del importado se guardan cifradas
con los contextos AAD actuales; no se reescriben las instantáneas de los sorteos
existentes. Una edición manual pendiente sigue sometida a la prioridad del
historial automático de la fase 7 cuando se sortee.

Se rechazan reimportaciones con nombre/año ya presentes y ediciones equivalentes
del mismo modo: contactos y relaciones normalizados por orden de fila y mayúsculas
del correo, sin usar estos contactos como asociación de identidad. Para sorteos
confirmados se compara además el instante histórico. La comprobación es sobre las
instantáneas actuales; no hay registro de importaciones nuevo. Modificar después
una edición manual o cambiar intencionadamente origen, fecha o destino puede
cambiar esa equivalencia: revisa siempre el plan y el resumen. No hay deduplicación
entre grupos distintos, cuyas identidades son independientes.

El token de vista previa es un HMAC con la clave existente sobre origen, plan,
límite y estado completo del destino, incluidas sus secuencias. No es un hash
público de parejas. Cambiar los datos o el grupo entre vista previa y confirmación
requiere repetirla. Los IDs nuevos se generan al preparar cada ejecución y solo
se publican en SQLite durante la confirmación; no forman parte del token.

El servicio adquiere `storageLock` antes de abrir la base, compartido con
`LocalStore` y SMTP, y rechaza una operación mientras otro escritor o envío
mantiene el bloqueo. El repositorio valida y publica personas, grupo, edición,
asignaciones, secuencia y estados en una transacción `BEGIN IMMEDIATE`. Compara
el estado releído con el preparado y comprueba claves foráneas antes de confirmar.
La vista previa usa una transacción de lectura y no crea entidades. No cambia el
esquema v3 ni la clave. Los errores pueden identificar índices de registro, pero no su contenido, contactos, parejas, rutas
privadas ni detalles de SQLite; los resúmenes solo contienen contadores, modo y
el código de confirmación. Los endpoints públicos mantienen sus campos actuales.

### Uso con Docker y recuperación

Haz antes la copia de ambos volúmenes descrita en README, con la web detenida.
Reconstruye la imagen para incluir el comando (`docker compose build web`). Guarda
origen y plan en `.task/import`, con permisos de lectura para el usuario `node`
del contenedor. Mantén la web detenida durante la validación y confirmación:

```bash
docker compose run --rm --no-deps -v "$PWD/.task/import:/import:ro" web \
  node build/import/cli.js --source /import/origen.json --plan /import/plan.json
```

Repite con `--confirm CODIGO` tras revisar el plan y los contadores. El contenedor
usa los volúmenes de datos y clave existentes; el directorio de entrada se monta
solo para lectura. Tras importar, arranca la web y verifica la nueva edición.
En uso sin Docker el comando npm admite los mismos archivos y permite seleccionar
las rutas con `--data` y `--key`. No ejecutes la CLI heredada (`npm start`) para
importar: esa CLI sí intenta enviar correos.

Un error anterior al commit deja la base sin importaciones parciales; corrige el
problema y vuelve a generar la vista previa. Una repetición después de un commit
se rechaza mediante los conflictos descritos. Para revertir una importación
confirmada, detén la web y restaura **ambos directorios completos** de la copia
previa, según README. Esto también revierte cualquier cambio posterior al respaldo.
No se eliminan los archivos de origen ni se regeneran claves para recuperar datos.
