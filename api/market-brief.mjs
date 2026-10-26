const sources = {
  ecbResearch: "https://www.ecb.europa.eu/rss/rbu.html",
  fedPolicy: "https://www.federalreserve.gov/feeds/press_monetary.xml",
  ecbCalendar: "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html",
  fedCalendar: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
  boeCalendar: "https://www.bankofengland.co.uk/monetary-policy/upcoming-mpc-dates",
};

const fallbackResearch = [
  {
    source: "Banco Central Europeo",
    title: "Research Bulletin y comunicaciones oficiales",
    published: "2026-10-01",
    nextReport: "Se actualiza al publicarse una nueva comunicación oficial.",
    summary: "Contexto público y oficial sobre política monetaria, economía y mercados del área del euro.",
    url: "https://www.ecb.europa.eu/press/research-publications/resbull/html/index.en.html",
  },
  {
    source: "Federal Reserve",
    title: "Monetary policy releases",
    published: "2026-10-01",
    nextReport: "Se actualiza al publicarse una nueva comunicación oficial.",
    summary: "Comunicados públicos de política monetaria de la Reserva Federal.",
    url: "https://www.federalreserve.gov/monetarypolicy.htm",
  },
];

function response(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "s-maxage=900, stale-while-revalidate=3600" },
  });
}

function decode(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function getText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const result = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "Divisas-BCE/1.0 (official-source-reader)" },
    });
    if (!result.ok) throw new Error(`${result.status} al consultar ${url}`);
    return await result.text();
  } finally {
    clearTimeout(timeout);
  }
}

function field(xml, name) {
  const match = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return decode(match?.[1] || "");
}

function parseRss(xml, source) {
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)]
    .map((match) => {
      const item = match[1];
      const published = new Date(field(item, "pubDate"));
      return {
        source,
        title: field(item, "title"),
        published: Number.isNaN(published.valueOf()) ? new Date().toISOString().slice(0, 10) : published.toISOString().slice(0, 10),
        nextReport: "Actualización automática mediante el feed oficial.",
        summary: field(item, "description") || "Publicación oficial disponible en la fuente enlazada.",
        url: field(item, "link"),
      };
    })
    .filter((item) => item.title && item.url)
    .slice(0, 4);
}

function dateFromWords(text, fallbackYear = new Date().getUTCFullYear()) {
  const months = { Jan: "January", Feb: "February", Mar: "March", Apr: "April", May: "May", Jun: "June", Jul: "July", Aug: "August", Sep: "September", Oct: "October", Nov: "November", Dec: "December" };
  const expanded = text.replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\b/gi, (month) => months[month.slice(0, 3)[0].toUpperCase() + month.slice(1, 3).toLowerCase()] || month);
  const monthFirst = expanded.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:\s*-\s*\d{1,2})?(?:\s+(\d{4}))?/i);
  const match = monthFirst || expanded.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?\s*(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+(\d{4}))?/i);
  if (!match) return null;
  const day = monthFirst ? match[2] : match[1];
  const month = monthFirst ? match[1] : match[2];
  const value = new Date(`${month} ${day}, ${match[3] || fallbackYear} UTC`);
  return Number.isNaN(value.valueOf()) ? null : value.toISOString().slice(0, 10);
}

function fedEvents(html) {
  const text = decode(html);
  const year = new Date().getUTCFullYear();
  const events = [];
  const pattern = /([A-Z][a-z]{2}\.?\s+\d{1,2}(?:\s*-\s*\d{1,2})?)\s+FOMC Meeting/gi;
  for (const match of text.matchAll(pattern)) {
    const date = dateFromWords(match[1].replace(/([A-Z][a-z]{2})\./, "$1"), year);
    if (date) events.push({ date, currencies: ["USD"], title: "Reunión del FOMC", type: "Política monetaria", source: "Federal Reserve", url: sources.fedCalendar });
  }
  return events;
}

function ecbEvents(html) {
  const text = decode(html);
  const pattern = /(\d{2}\/\d{2}\/\d{4})\s+Governing Council of the ECB: monetary policy meeting[^.]{0,180}/gi;
  return [...text.matchAll(pattern)].map((match) => {
    const [day, month, year] = match[1].split("/");
    return {
      date: `${year}-${month}-${day}`,
      currencies: ["EUR"],
      title: "Reunión de política monetaria del BCE",
      type: "Política monetaria",
      source: "Banco Central Europeo",
      url: sources.ecbCalendar,
    };
  });
}

function boeEvents(html) {
  const text = decode(html);
  const next = text.match(/Next due:\s*(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i);
  const date = next ? dateFromWords(next[1]) : null;
  return date ? [{ date, currencies: ["GBP"], title: "Próxima decisión del Comité de Política Monetaria", type: "Política monetaria", source: "Bank of England", url: sources.boeCalendar }] : [];
}

function uniqueEvents(events) {
  const seen = new Set();
  return events.filter((event) => {
    const key = `${event.date}:${event.source}:${event.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.date.localeCompare(b.date));
}

export default {
  async fetch() {
    const [ecbResearch, fedPolicy, ecbCalendar, fedCalendar, boeCalendar] = await Promise.allSettled([
      getText(sources.ecbResearch), getText(sources.fedPolicy), getText(sources.ecbCalendar), getText(sources.fedCalendar), getText(sources.boeCalendar),
    ]);

    const research = [
      ...(ecbResearch.status === "fulfilled" ? parseRss(ecbResearch.value, "Banco Central Europeo · Research Bulletin") : []),
      ...(fedPolicy.status === "fulfilled" ? parseRss(fedPolicy.value, "Federal Reserve · Política monetaria") : []),
    ];
    const events = uniqueEvents([
      ...(ecbCalendar.status === "fulfilled" ? ecbEvents(ecbCalendar.value) : []),
      ...(fedCalendar.status === "fulfilled" ? fedEvents(fedCalendar.value) : []),
      ...(boeCalendar.status === "fulfilled" ? boeEvents(boeCalendar.value) : []),
    ]);
    const unavailable = [ecbResearch, fedPolicy, ecbCalendar, fedCalendar, boeCalendar].filter((item) => item.status === "rejected").length;
    console.info("market-brief", { research: research.length, events: events.length, unavailable });

    return response({
      updatedAt: new Date().toISOString(),
      research: research.length ? research : fallbackResearch,
      events,
      status: unavailable ? "partial" : "ok",
      note: unavailable ? "Alguna fuente oficial no estuvo disponible; se muestran los datos recuperados." : "Actualizado desde fuentes oficiales.",
    });
  },
};
