/**
 * Cotizaciones de mercado EUR/XXX para Vercel.
 * La clave se lee exclusivamente en el servidor. No se utiliza para cotizaciones BCE.
 * Proveedores: FMP (por defecto) o Twelve Data (alternativa si FMP no autoriza Forex).
 */
const ALLOWED_CURRENCIES = new Set([
  'USD', 'AUD', 'BRL', 'GBP', 'CAD', 'CHF', 'JPY', 'NOK', 'SEK', 'DKK',
  'PLN', 'CZK', 'HUF', 'RON', 'CNY', 'HKD', 'INR', 'KRW', 'MXN', 'NZD',
  'SGD', 'ZAR',
]);
const DEFAULT_SYMBOLS = ['EURUSD', 'EURAUD', 'EURBRL', 'EURGBP'];
const MAX_PAIRS = 4;
const CACHE_SECONDS = 1800; // Evita sobrepasar fácilmente los límites gratuitos.

function json(payload, status = 200, cacheable = false) {
  return Response.json(payload, {
    status,
    headers: {
      'Cache-Control': cacheable
        ? `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=60`
        : 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function symbolsFromUrl(url) {
  const raw = url.searchParams.get('symbols');
  if (raw === null) return DEFAULT_SYMBOLS;
  const list = raw.split(',').map((symbol) => symbol.trim().toUpperCase());
  if (!list.length || list.length > MAX_PAIRS || new Set(list).size !== list.length) return null;
  if (!list.every((symbol) => /^EUR[A-Z]{3}$/.test(symbol) && ALLOWED_CURRENCIES.has(symbol.slice(3)))) return null;
  return list;
}

function providerSettings() {
  const desired = (process.env.FOREX_PROVIDER || '').toLowerCase();
  if (desired && !['fmp', 'twelvedata'].includes(desired)) return null;
  const provider = desired || (process.env.TWELVEDATA_API_KEY && !process.env.FMP_API_KEY ? 'twelvedata' : 'fmp');
  const key = provider === 'fmp' ? process.env.FMP_API_KEY : process.env.TWELVEDATA_API_KEY;
  return { provider, key };
}

function formatQuote(symbol, raw, provider) {
  if (!raw || typeof raw !== 'object') return null;
  const price = finiteNumber(provider === 'fmp' ? raw.price : raw.close);
  if (price === null || price <= 0) return null;
  let timestamp = null;
  if (provider === 'fmp' && Number.isFinite(Number(raw.timestamp)) && Number(raw.timestamp) > 0) {
    const date = new Date(Number(raw.timestamp) * 1000);
    if (!Number.isNaN(date.getTime())) timestamp = date.toISOString();
  }
  // En Twelve Data 'datetime' puede no llevar zona horaria: se informa tal cual,
  // sin inventar un huso horario ni presentarlo como fecha UTC.
  const providerDatetime = provider === 'twelvedata' && typeof raw.datetime === 'string'
    ? raw.datetime.slice(0, 32) : null;
  return {
    symbol,
    price,
    changePercent: finiteNumber(provider === 'fmp' ? raw.changePercentage : raw.percent_change),
    dayHigh: finiteNumber(provider === 'fmp' ? raw.dayHigh : raw.high),
    dayLow: finiteNumber(provider === 'fmp' ? raw.dayLow : raw.low),
    previousClose: finiteNumber(provider === 'fmp' ? raw.previousClose : raw.previous_close),
    timestamp,
    providerDatetime,
    status: 'ok',
  };
}

async function fetchQuote(symbol, provider, apiKey) {
  const endpoint = provider === 'fmp'
    ? new URL('https://financialmodelingprep.com/stable/quote')
    : new URL('https://api.twelvedata.com/quote');
  endpoint.searchParams.set('symbol', provider === 'fmp' ? symbol : `${symbol.slice(0, 3)}/${symbol.slice(3)}`);
  endpoint.searchParams.set('apikey', apiKey);

  try {
    const response = await fetch(endpoint.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(9000),
    });
    if (response.status === 429) return { symbol, status: 'error', message: 'Límite de consultas del proveedor alcanzado.' };
    if (response.status === 401 || response.status === 403) {
      return { symbol, status: 'error', message: 'El proveedor no autoriza este acceso. Revisa la clave, el plan o la región.' };
    }
    if (!response.ok) return { symbol, status: 'error', message: `El proveedor no responde (${response.status}).` };
    const payload = await response.json();
    // FMP suele devolver un array; Twelve Data devuelve un objeto o un objeto de error.
    if (provider === 'twelvedata' && payload?.status === 'error') {
      return { symbol, status: 'error', message: 'Este par no está disponible con el plan o la clave de Twelve Data.' };
    }
    if (provider === 'fmp' && !Array.isArray(payload)) {
      return { symbol, status: 'error', message: 'FMP ha rechazado la consulta o no permite este endpoint.' };
    }
    const record = provider === 'fmp'
      ? payload.find((item) => String(item?.symbol || '').toUpperCase() === symbol)
      : payload;
    const quote = formatQuote(symbol, record, provider);
    return quote || { symbol, status: 'error', message: 'Este par no está disponible con tu plan o aún no tiene datos.' };
  } catch {
    return { symbol, status: 'error', message: 'No se pudo conectar con el proveedor de cotizaciones.' };
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const symbols = symbolsFromUrl(url);
    if (!symbols) return json({ error: 'Indica entre 1 y 4 pares EUR válidos, sin repetir.' }, 400);

    const settings = providerSettings();
    if (!settings) return json({ error: 'FOREX_PROVIDER debe ser fmp o twelvedata.' }, 503);
    if (!settings.key) {
      const envName = settings.provider === 'fmp' ? 'FMP_API_KEY' : 'TWELVEDATA_API_KEY';
      return json({
        error: `Falta configurar ${envName} en las variables de entorno de Vercel.`,
        provider: settings.provider,
      }, 503);
    }

    const quotes = await Promise.all(symbols.map((symbol) => fetchQuote(symbol, settings.provider, settings.key)));
    const hasAnyData = quotes.some((quote) => quote.status === 'ok');
    return json({
      provider: settings.provider,
      requestedAt: new Date().toISOString(),
      cacheSeconds: CACHE_SECONDS,
      quotes,
    }, hasAnyData ? 200 : 502, hasAnyData);
  },
};
