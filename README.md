# Divisas BCE

Boceto estático para consultar tipos de cambio oficiales del Banco Central Europeo.

## Publicarlo en Vercel

1. Sube esta carpeta a un repositorio de GitHub, GitLab o Bitbucket.
2. En Vercel, selecciona **Add New → Project** e importa el repositorio.
3. Vercel detectará la configuración automáticamente. No necesita comandos de instalación ni de compilación.
4. Pulsa **Deploy**.

La aplicación se publica desde la carpeta `dist`. La función `api/rates.mjs` se ejecuta en Vercel y consulta la API del BCE en cada fecha solicitada; así se evitan restricciones de acceso del navegador a la fuente externa.

Los pares iniciales están definidos en `dist/pairs.json`. Cada persona puede añadir o eliminar pares y su selección se guarda en el navegador de su dispositivo. Para compartir cambios entre dispositivos o usuarios habría que añadir almacenamiento compartido.
