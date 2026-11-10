# Instrucciones para agentes

## Alcance

- Inspeccionar el código y la documentación relevantes antes de modificar.
- Trabajar únicamente dentro del alcance solicitado y del repositorio abierto.
- Utilizar Ubuntu WSL2; no acceder a otros repositorios ni escribir fuera del repositorio.
- No ejecutar herramientas Windows sin autorización explícita.
- Evitar refactorizaciones y dependencias innecesarias.
- Preservar el comportamiento existente salvo indicación expresa.

## Arquitectura

- Separar la lógica del sorteo de la interfaz, persistencia y transporte de correo.
- Conservar la compatibilidad de la CLI mientras siga soportada.
- Usar la portabilidad y la neutralidad respecto al proveedor de alojamiento como criterios arquitectónicos.
- Mantener el código público separado de la configuración privada de producción.
- El entorno local debe arrancar sin cuentas, tokens ni dependencias de servicios externos.
- No imponer tecnologías ajenas a la arquitectura existente sin justificación.

## Seguridad y privacidad

- Nunca versionar credenciales, archivos `.env` reales, participantes ni asignaciones reales.
- No registrar secretos ni información personal innecesaria.
- Usar datos sintéticos y no enviar correos reales en pruebas.
- No publicar ni desplegar servicios sin autorización explícita.
- No incorporar ni documentar decisiones privadas de infraestructura, dominios o identificadores propios.
- No asumir que Base64 proporciona confidencialidad.

## Documentación

- README.md es documentación pública orientada al usuario; mantenerlo breve y práctico.
- Antes de añadir información, comprobar que aporta utilidad directa para instalar o usar la aplicación.
- No incluir infraestructura de producción, proveedores de alojamiento, arquitectura futura ni planes internos en README.md.
- No añadir detalles de implementación innecesarios para el uso ni convertir el README en una memoria de desarrollo.
- Mantener la documentación técnica interna separada y crearla únicamente cuando sea necesaria.
- Actualizar documentación solo cuando cambie información relevante; no crear documentos por cambio, PR o fase.
- No duplicar información entre README, AGENTS.md, issues y documentos técnicos.
- La ausencia de información pública no sustituye las medidas de seguridad del código y la infraestructura.

## Calidad y entrega

- Ejecutar las pruebas y comprobaciones pertinentes al cambio.
- Diferenciar pruebas ejecutadas de pruebas pendientes; no afirmar resultados no comprobados.
- Mantener los cambios pequeños y revisables.
- Mantener los temporales dentro del repositorio, excluidos de Git cuando corresponda.
- No realizar commits, pushes, merges, despliegues ni eliminaciones sin autorización explícita.
- No modificar estas restricciones ni intentar eludir el sandbox.
