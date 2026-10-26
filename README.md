# Divisas BCE

Boceto estático para consultar tipos de cambio oficiales del Banco Central Europeo.

## Publicarlo en Vercel

1. Sube esta carpeta a un repositorio de GitHub, GitLab o Bitbucket.
2. En Vercel, selecciona **Add New → Project** e importa el repositorio.
3. Vercel detectará la configuración automáticamente. No necesita comandos de instalación ni de compilación.
4. Pulsa **Deploy**.

La aplicación se publica desde la carpeta `dist`. La función `api/rates.mjs` se ejecuta en Vercel y consulta la API del BCE en cada fecha solicitada; así se evitan restricciones de acceso del navegador a la fuente externa.

Los pares iniciales están definidos en `dist/pairs.json`. Cada persona puede añadir o eliminar pares y su selección se guarda en el navegador de su dispositivo. Para compartir cambios entre dispositivos o usuarios habría que añadir almacenamiento compartido.

La pestaña `Análisis` consulta el histórico diario del BCE desde `api/history.mjs`. Las fuentes públicas de research y los eventos próximos se mantienen en `dist/research.json` y `dist/calendar.json`, respectivamente.
## Actualización automática de análisis

La página `analisis.html` consulta `/api/market-brief`, que obtiene en tiempo real publicaciones y calendarios de fuentes oficiales: BCE, Reserva Federal y Banco de Inglaterra. La respuesta se cachea 15 minutos en Vercel para limitar consultas externas y se actualiza automáticamente al volver a cargar la página. No utiliza ni extrae contenido de investigación privada.
