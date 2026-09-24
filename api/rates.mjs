const currencies = ["USD", "AUD", "BRL", "GBP"];

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}

function toIso(date) {
  return date.toISOString().slice(0, 10);
}

export default {
  async fetch(request) {
    const requestedDate = new URL(request.url).searchParams.get("date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate || "")) {
      return json({ error: "Indica una fecha válida en formato AAAA-MM-DD." }, 400);
    }

    const end = new Date(`${requestedDate}T12:00:00Z`);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 14);
    const params = new URLSearchParams({
      format: "csvdata",
      detail: "dataonly",
      startPeriod: toIso(start),
      endPeriod: requestedDate,
    });
    const endpoint = `https://data-api.ecb.europa.eu/service/data/EXR/D.USD+AUD+BRL+GBP.EUR.SP00.A?${params}`;

    try {
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error(`BCE respondió ${response.status}`);

      const [header, ...lines] = (await response.text()).trim().split(/\r?\n/);
      const keys = header.split(",");
      const groups = {};
      for (const line of lines) {
        const row = Object.fromEntries(line.split(",").map((value, index) => [keys[index], value]));
        if (!currencies.includes(row.CURRENCY)) continue;
        (groups[row.TIME_PERIOD] ||= []).push({ currency: row.CURRENCY, value: Number(row.OBS_VALUE) });
      }

      const date = Object.keys(groups).sort().reverse().find((key) => groups[key].length === currencies.length);
      if (!date) return json({ error: "No hay datos del BCE para esa fecha." }, 404);

      return json({ requestedDate, date, rates: groups[date] });
    } catch {
      return json({ error: "No se han podido consultar los datos del BCE." }, 502);
    }
  },
};
