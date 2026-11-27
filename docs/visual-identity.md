# Identidad visual

La cabecera y las tarjetas adoptan verdes bosque y pera con un acento albaricoque.
El tema claro usa crema y superficies luminosas. Las variables de
`frontend/src/styles.css` definen fondo, superficies, texto, bordes, foco y
estados. El modo Sistema lee `prefers-color-scheme`. La elección explícita se
aplica antes del primer render mediante `frontend/public/assets/theme.js`.

La tipografía usa Aptos y Segoe UI si están instaladas, con una alternativa del
sistema. No se redistribuyen fuentes ni se realizan solicitudes externas. El
símbolo SVG del regalo se dibujó para secretGift. La ilustración WebP original
se creó con ImageGen y se optimizó localmente. El favicon SVG y esta
ilustración tienen rutas estáticas explícitas, MIME propio y caché de un día.
Solo el documento de la aplicación permite imágenes del mismo origen. La referencia conceptual privada
no se distribuye.

Los estados combinan texto con color. Los medidores cuentan aceptaciones del
servidor de correo correspondientes al modo indicado. La cuenta atrás utiliza
días de calendario de la zona del evento para distinguir Hoy, futuro y pasado.
La animación de confirmación respeta `prefers-reduced-motion`.

Para revisar cambios, compila y usa un navegador con un perfil temporal en una
instancia aislada con datos ficticios y SMTP simulado. Comprueba ambos temas
en 360, 390, 768, 1024, 1440 y 1920 px, además de teclado, zoom al 200 % y
reducción de movimiento. Mantén las capturas de validación fuera de Git.
