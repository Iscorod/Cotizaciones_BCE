const allowedPeriods = new Set(["1W", "1M", "YTD", "1Y", "5Y"]);

function json(payload, status = 200) {
  return Response.json(payload, { status, headers: { "Cache-Control": "public, max-age=3600" } });
}

function iso(date) {
  return date.toISOString().slice(0, 10);
}

function startDateFor(period, end) {
  const start = new Date(end);
  if (period === "1W") start.setUTCDate(start.getUTCDate() - 7);
  if (period === "1M") start.setUTCMonth(start.getUTCMonth() - 1);
  if (period === "YTD") start.setUTCMonth(0, 1);
  if (period === "1Y") start.setUTCFullYear(start.getUTCFullYear() - 1);
  if (period === "5Y") start.setUTCFullYear(start.getUTCFullYear() - 5);
  return start;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const currency = (url.searchParams.get("currency") || "USD").toUpperCase();
    const period = url.searchParams.get("period") || "1Y";
    if (!/^[A-Z]{3}$/.test(currency) || !allowedPeriods.has(period)) return json({ error: "Parámetros no válidos." }, 400);

    const end = new Date();
    const start = startDateFor(period, end);
    const params = new URLSearchParams({ format: "csvdata", detail: "dataonly", startPeriod: iso(start), endPeriod: iso(end) });
    const endpoint = `https://data-api.ecb.europa.eu/service/data/EXR/D.${currency}.EUR.SP00.A?${params}`;

    try {
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error(`BCE respondió ${response.status}`);
      const [header, ...lines] = (await response.text()).trim().split(/\r?\n/);
      const keys = header.split(",");
      const observations = lines.map((line) => Object.fromEntries(line.split(",").map((value, index) => [keys[index], value])))
        .filter((row) => row.CURRENCY === currency && row.TIME_PERIOD && row.OBS_VALUE)
        .map((row) => ({ date: row.TIME_PERIOD, value: Number(row.OBS_VALUE) }))
        .sort((a, b) => a.date.localeCompare(b.date));
      if (!observations.length) return json({ error: "No hay observaciones para el período seleccionado." }, 404);
      return json({ currency, period, observations });
    } catch {
      return json({ error: "No se ha podido consultar el histórico del BCE." }, 502);
    }
  },
};
