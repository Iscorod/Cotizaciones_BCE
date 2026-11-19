/**
 * Cotizaciones EUR/XXX: Twelve Data (principal) y FMP (opcional, sin históricos).
 * La clave nunca abandona el servidor. Diseñado para Vercel Functions.
 * Twelve Data: 1 /quote + 1 /time_series por par (máx. 4 pares = 8 créditos/consulta).
 */
const ALLOWED_CURRENCIES = new Set([
  'USD', 'AUD', 'BRL', 'GBP', 'CAD', 'CHF', 'JPY', 'NOK', 'SEK', 'DKK',
  'PLN', 'CZK', 'HUF', 'RON', 'CNY', 'HKD', 'INR', 'KRW', 'MXN', 'NZD',
  'SGD', 'ZAR',
]);
const DEFAULT_SYMBOLS = ['EURUSD', 'EURAUD', 'EURBRL', 'EURGBP'];
const MAX_PAIRS = 4;
const CACHE_SECONDS = 1800;
const BAR_MINUTES = 15;
const BAR_MS = BAR_MINUTES * 60_000;
const HISTORY_OUTPUTSIZE = 800; // >7 días calendario de velas de 15 min; máx. 5000 por solicitud.
const WINDOWS = { '1h': 60 * 60_000, '24h': 24 * 60 * 60_000, '7d': 7 * 24 * 60 * 60_000 };

function json(payload, status = 200, cacheable = false) {
  return Response.json(payload, {
    status,
    headers: {
      'Cache-Control': cacheable ? `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=60` : 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}
function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function positiveNumber(value) {
  const valueNumber = finiteNumber(value);
  return valueNumber !== null && valueNumber > 0 ? valueNumber : null;
}
function isoFromUnix(value) {
  const seconds = positiveNumber(value);
  if (seconds === null || seconds < 946684800 || seconds > 4102444800) return null;
  return new Date(seconds * 1000).toISOString();
}
function utcFromDateTime(value) {
  // Twelve Data /time_series con timezone=UTC devuelve YYYY-MM-DD HH:mm:ss.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const date = Date.parse(value.replace(' ', 'T') + 'Z');
  return Number.isFinite(date) ? date : null;
}
function symbolsFromUrl(url) {
  const raw = url.searchParams.get('symbols');
  if (raw === null) return DEFAULT_SYMBOLS;
  const list = raw.split(',').map(symbol => symbol.trim().toUpperCase());
  if (!list.length || list.length > MAX_PAIRS || new Set(list).size !== list.length) return null;
  if (!list.every(symbol => /^EUR[A-Z]{3}$/.test(symbol) && ALLOWED_CURRENCIES.has(symbol.slice(3)))) return null;
  return list;
}
function providerSettings() {
  const desired = (process.env.FOREX_PROVIDER || 'twelvedata').toLowerCase();
  if (!['fmp', 'twelvedata'].includes(desired)) return null;
  return {
    provider: desired,
    key: desired === 'twelvedata' ? process.env.TWELVEDATA_API_KEY : process.env.FMP_API_KEY,
  };
}

async function requestProvider(endpoint) {
  try {
    const response = await fetch(endpoint, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(11000),
    });
    if (response.status === 429) return { error: 'Límite de consultas de la API alcanzado.' };
    if (response.status === 401 || response.status === 403) return { error: 'Acceso no autorizado. Revisa la clave y el plan.' };
    if (!response.ok) return { error: `El proveedor no responde (HTTP ${response.status}).` };
    const payload = await response.json();
    if (payload?.status === 'error' || (payload?.code && !payload?.values && !payload?.close)) {
      const code = Number(payload?.code);
      return {
        error: code === 429 || code === 4290
          ? 'Se ha superado el límite de créditos. Prueba más tarde.'
          : 'La API no ofrece estos datos para el par o tu plan.',
      };
    }
    return { payload };
  } catch {
    return { error: 'No se pudo conectar con el proveedor de cotizaciones.' };
  }
}

function formatQuote(symbol, raw, provider) {
  if (!raw || typeof raw !== 'object') return null;
  const price = positiveNumber(provider === 'fmp' ? raw.price : raw.close);
  if (price === null) return null;
  return {
    symbol,
    price,
    changePercent: finiteNumber(provider === 'fmp' ? raw.changePercentage : raw.percent_change),
    dayHigh: finiteNumber(provider === 'fmp' ? raw.dayHigh : raw.high),
    dayLow: finiteNumber(provider === 'fmp' ? raw.dayLow : raw.low),
    previousClose: finiteNumber(provider === 'fmp' ? raw.previousClose : raw.previous_close),
    // last_quote_at es la marca temporal del último minuto para Twelve Data.
    // raw.timestamp puede ser la APERTURA de la vela diaria; no se toma como hora actual.
    timestamp: provider === 'fmp' ? isoFromUnix(raw.timestamp) : isoFromUnix(raw.last_quote_at),
    providerDatetime: provider === 'twelvedata' && typeof raw.datetime === 'string' ? raw.datetime.slice(0, 32) : null,
    changes: { '1h': null, '24h': null, '7d': null },
    historyError: null,
    status: 'ok',
  };
}

function comparePriceAgainstHistory(quote, rawHistory) {
  const rawBars = Array.isArray(rawHistory?.values) ? rawHistory.values : [];
  const bars = rawBars.map(bar => ({
    // datetime es la hora de APERTURA; el precio close corresponde al final de la vela.
    end: utcFromDateTime(bar?.datetime) + BAR_MS,
    price: positiveNumber(bar?.close),
    validDate: utcFromDateTime(bar?.datetime) !== null,
  })).filter(bar => bar.validDate && bar.price !== null).sort((a, b) => b.end - a.end);
  if (!bars.length) return { error: 'No hay históricos intradía disponibles.' };

  // Preferimos la hora del último tick real. Si el proveedor no la da, usamos el
  // cierre de la última vela ya completada y avisamos que la hora es aproximada.
  const quoteTimeMs = quote.timestamp ? Date.parse(quote.timestamp) : null;
  const nowMs = Date.now();
  const anchoredAt = quoteTimeMs !== null && Number.isFinite(quoteTimeMs)
    ? quoteTimeMs
    : (bars.find(bar => bar.end <= nowMs + 60_000)?.end ?? null);
  if (anchoredAt === null) return { error: 'No se puede determinar la hora de referencia del histórico.' };

  const changes = {};
  for (const [horizon, durationMs] of Object.entries(WINDOWS)) {
    const target = anchoredAt - durationMs;
    const bar = bars.find(item => item.end <= target && target - item.end < BAR_MS + 60_000);
    if (!bar) { changes[horizon] = null; continue; }
    changes[horizon] = {
      percent: Math.round(((quote.price / bar.price) - 1) * 100 * 10000) / 10000,
      referencePrice: bar.price,
      referenceAt: new Date(bar.end).toISOString(),
    };
  }
  return {
    changes,
    comparisonBaseAt: new Date(anchoredAt).toISOString(),
    approximateBaseTime: quoteTimeMs === null,
  };
}

async function fetchTwelveQuoteWithHistory(symbol, apiKey) {
  const pair = `${symbol.slice(0, 3)}/${symbol.slice(3)}`;
  const quoteUrl = new URL('https://api.twelvedata.com/quote');
  quoteUrl.searchParams.set('symbol', pair);
  quoteUrl.searchParams.set('apikey', apiKey);
  const historyUrl = new URL('https://api.twelvedata.com/time_series');
  historyUrl.searchParams.set('symbol', pair);
  historyUrl.searchParams.set('interval', `${BAR_MINUTES}min`);
  historyUrl.searchParams.set('outputsize', String(HISTORY_OUTPUTSIZE));
  historyUrl.searchParams.set('timezone', 'UTC');
  historyUrl.searchParams.set('apikey', apiKey);

  const [quoteResponse, historyResponse] = await Promise.all([
    requestProvider(quoteUrl.toString()), requestProvider(historyUrl.toString()),
  ]);
  if (quoteResponse.error) return { symbol, status: 'error', message: quoteResponse.error };
  const quote = formatQuote(symbol, quoteResponse.payload, 'twelvedata');
  if (!quote) return { symbol, status: 'error', message: 'No hay cotización para este par en tu plan.' };
  if (historyResponse.error) {
    quote.historyError = historyResponse.error;
    return quote;
  }
  const changes = comparePriceAgainstHistory(quote, historyResponse.payload);
  if (changes.error) quote.historyError = changes.error;
  else Object.assign(quote, changes);
  return quote;
}

async function fetchFmpQuote(symbol, apiKey) {
  const endpoint = new URL('https://financialmodelingprep.com/stable/quote');
  endpoint.searchParams.set('symbol', symbol);
  endpoint.searchParams.set('apikey', apiKey);
  const result = await requestProvider(endpoint.toString());
  if (result.error) return { symbol, status: 'error', message: result.error };
  if (!Array.isArray(result.payload)) return { symbol, status: 'error', message: 'FMP no permite consultar este endpoint.' };
  const record = result.payload.find(item => String(item?.symbol || '').toUpperCase() === symbol);
  const quote = formatQuote(symbol, record, 'fmp');
  if (quote) quote.historyError = 'Comparativas 1h, 24h y 7d disponibles con Twelve Data.';
  return quote || { symbol, status: 'error', message: 'Este par no está disponible en FMP.' };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const symbols = symbolsFromUrl(url);
    if (!symbols) return json({ error: 'Indica entre 1 y 4 pares EUR válidos, sin repetir.' }, 400);
    const settings = providerSettings();
    if (!settings) return json({ error: 'FOREX_PROVIDER debe ser twelvedata o fmp.' }, 503);
    if (!settings.key) {
      return json({
        error: `Falta configurar ${settings.provider === 'twelvedata' ? 'TWELVEDATA_API_KEY' : 'FMP_API_KEY'} en las variables de entorno de Vercel.`,
        provider: settings.provider,
      }, 503);
    }
    const quotes = await Promise.all(symbols.map(symbol => settings.provider === 'twelvedata'
      ? fetchTwelveQuoteWithHistory(symbol, settings.key)
      : fetchFmpQuote(symbol, settings.key)));
    const anyGood = quotes.some(quote => quote.status === 'ok');
    return json({
      provider: settings.provider,
      requestedAt: new Date().toISOString(),
      cacheSeconds: CACHE_SECONDS,
      historicalResolutionMinutes: settings.provider === 'twelvedata' ? BAR_MINUTES : null,
      quotes,
    }, anyGood ? 200 : 502, anyGood);
  },
};
