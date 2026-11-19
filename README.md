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

## Nueva pestaña: Mercado Forex

`dist/mercado.html` añade cotizaciones intradía de **pares EUR/** sin mezclar los
precios de mercado con las referencias oficiales del BCE. Los pares iniciales son
EUR/USD, EUR/AUD, EUR/BRL y EUR/GBP. Permite personalizar hasta 4 pares; se
recuerda la selección en el navegador. Muestra, cuando el proveedor los ofrece,
precio, variación porcentual, máximo/mínimo diario, cierre previo y hora de la
última cotización. No incluye acciones, precios objetivo ni recomendaciones.

La nueva función `api/forex.mjs` consulta proveedores desde el **servidor** para
no mostrar la clave de API en el código del navegador. Se necesita una cuenta y
una clave válida: sin ella, la pestaña informa del error y **no inventa datos**.

### Configurar FMP en Vercel

1. Crea una cuenta en [Financial Modeling Prep](https://site.financialmodelingprep.com/).
2. En **Vercel → tu proyecto → Settings → Environment Variables**, añade
   `FMP_API_KEY` con tu clave (en los entornos donde quieras usarla).
3. Opcional: añade `FOREX_PROVIDER` = `fmp` (es el valor por defecto si hay
   una clave FMP).
4. Vuelve a desplegar el proyecto para activar las variables en la función.
5. Abre la nueva pestaña **Mercado Forex** y prueba EUR/USD.

**Atención:** FMP indica en su documentación que el endpoint Forex Quote
`/stable/quote?symbol=EURUSD` está restringido para empresas fuera de EE. UU.
Además, el plan Basic solo incluye 10 pares concretos (por ejemplo, EUR/USD);
**no se garantiza** que EUR/AUD, EUR/BRL o EUR/GBP estén disponibles.
Una suscripción gratuita tampoco concede derechos de visualización pública:
consulta con FMP los requisitos de licencia antes de abrir este panel a terceros.

### Alternativa si FMP no da acceso: Twelve Data

La misma pestaña también admite Twelve Data **sin cambiar HTML ni JavaScript**.
En Vercel añade `FOREX_PROVIDER` = `twelvedata` y `TWELVEDATA_API_KEY` con la clave
obtenida en https://twelvedata.com. El backend consultará `/quote` con
símbolos como `EUR/USD`. Revisa qué pares, frecuencia y uso público permite tu
plan de Twelve Data; los datos de algunos campos pueden no estar disponibles.

### Consumo y frecuencia

- La web consulta automáticamente cada **30 minutos** mientras está abierta;
  también hay un botón de actualización manual.
- El backend limita cada consulta a **4 pares EUR/**, valida la entrada y solicita
  un par por petición externa. Para minimizar llamadas, las respuestas válidas
  incluyen caché de CDN de Vercel (`s-maxage=1800` segundos).
- No equivale a un streaming tick a tick: la frescura depende del proveedor y
  puede haber hasta 30 minutos de caché. En fechas de cierre de mercado pueden
  mantenerse los últimos precios disponibles.
- Es una implementación para pruebas o uso autorizado. Para gran tráfico o
  licencias estrictas considera autenticación, cuotas por usuario y caché
  compartida persistente.

Para probar manualmente el backend después del despliegue:

```text
https://TU-DOMINIO.vercel.app/api/forex?symbols=EURUSD,EURAUD,EURBRL,EURGBP
```

**Nunca** incluyas la clave en la URL del navegador, en un repositorio, ni en
variables Vercel con prefijo `NEXT_PUBLIC_` o `VITE_`.
