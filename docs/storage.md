# Modelo SQLite v2

`PRAGMA user_version` versiona el esquema; `State.version=1` sigue describiendo
el estado de una edición y no ha cambiado el contrato HTTP. Los tipos y su
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
`createEdition`, `listEditions`, `readEdition` y `writeEdition`. Son operaciones
internas de persistencia, no endpoints de gestión ni de envío. `createEdition`
copia contactos de personas activas del grupo; `putPerson` nunca modifica esas
copias. Desactivar una persona permite conservar su identidad e historial.
Una edición sorteada rechaza cambios de participantes, asignaciones y fecha;
solo pueden actualizarse sus estados de entrega y revisión.

`read` y `write` adaptan `LocalStore` a la fila `compatibility`. Un reinicio de
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
la copia anterior a la actualización, con la web detenida. El historial todavía
no interviene en el algoritmo del sorteo ni tiene endpoints públicos. La apertura
valida todas las ediciones; su coste crece con el historial y deberá revisarse
si el volumen deja de ser pequeño y local.
