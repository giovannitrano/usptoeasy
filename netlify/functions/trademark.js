const https = require("https");

function get(url, headers = {}) {
  return new Promise((resolve) => {
    try {
      const req = https.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,*/*",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": "https://tsdr.uspto.gov/",
          "X-Requested-With": "XMLHttpRequest",
          ...headers
        },
        timeout: 15000,
      }, (res) => {
        const chunks = [];
        res.on("data", c => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      });
      req.on("error", e => resolve({ status: 0, body: "" }));
      req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: "" }); });
    } catch(e) { resolve({ status: 0, body: "" }); }
  });
}

// Strip all HTML tags and decode entities, collapse whitespace
function clean(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;|&#160;/g, " ").replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, " ").trim();
}

// Extract content of first element matching class (handles nested tags)
function getByClass(html, className) {
  const re = new RegExp(`<[^>]+class="[^"]*\\b${className}\\b[^"]*"[^>]*>`, "i");
  const m = re.exec(html);
  if (!m) return null;
  // Find the tag name so we can match closing tag
  const tagMatch = m[0].match(/^<(\w+)/);
  if (!tagMatch) return null;
  const tag = tagMatch[1];
  const start = m.index + m[0].length;
  // Walk forward counting open/close tags to find balanced close
  let depth = 1, i = start;
  const openRe = new RegExp(`<${tag}[\\s>]`, "gi");
  const closeRe = new RegExp(`<\\/${tag}>`, "gi");
  while (i < html.length && depth > 0) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose) break;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      i = nextOpen.index + 1;
    } else {
      depth--;
      i = nextClose.index + nextClose[0].length;
    }
  }
  return html.slice(start, i - `</${tag}>`.length);
}

// Extract content of element with given id
function getById(html, id) {
  const re = new RegExp(`<(\\w+)[^>]+\\bid=["']?${id}["']?[^>]*>`, "i");
  const m = re.exec(html);
  if (!m) return null;
  const tag = m[1];
  const start = m.index + m[0].length;
  let depth = 1, i = start;
  const openRe = new RegExp(`<${tag}[\\s>]`, "gi");
  const closeRe = new RegExp(`<\\/${tag}>`, "gi");
  while (i < html.length && depth > 0) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose) break;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      i = nextOpen.index + 1;
    } else {
      depth--;
      i = nextClose.index + nextClose[0].length;
    }
  }
  return html.slice(start, i - `</${tag}>`.length);
}

function extractMarkText(html) {
  // Target: div.value.markText  (has both classes "value" and "markText")
  // Try combined class first
  const inner = getByClass(html, "markText");
  if (inner !== null) {
    const t = clean(inner);
    if (t && t.length > 0 && t.length < 500) return t;
  }

  // Fallback: find any element with markText in its class
  const re = /<[^>]+class="[^"]*markText[^"]*"[^>]*>([\s\S]*?)<\/(div|span|td|p)>/i;
  const m = re.exec(html);
  if (m) {
    const t = clean(m[1]);
    if (t && t.length > 0 && t.length < 500) return t;
  }

  return null;
}

function extractOwner(html) {
  // Target: #relatedProp-section
  // Real HTML structure uses class="key" for labels and class="value" for values.
  // The .value div may contain nested <div> children (e.g. address lines),
  // so we use getByClass (balanced) to capture the full value content.
  const section = getById(html, "relatedProp-section");
  if (!section) return null;

  const pairs = [];

  // Walk through all .row divs; each row has one or more key+value pairs
  // Use balanced extraction for .value so nested <div> tags are included
  const keyRe = /<div[^>]+class="key"[^>]*>([\s\S]*?)<\/div>/gi;
  let km;
  // Collect all keys with their position in the section
  const keys = [];
  while ((km = keyRe.exec(section)) !== null) {
    keys.push({ label: clean(km[1]).replace(/:$/, ""), end: km.index + km[0].length });
  }

  // For each key, find the immediately following .value div (balanced)
  for (const k of keys) {
    const after = section.slice(k.end);
    // Find first occurrence of class="value" after this key
    const valStart = after.search(/<div[^>]+class="value"[^>]*>/i);
    if (valStart === -1) continue;
    const valTagMatch = after.slice(valStart).match(/^<div[^>]+>/);
    if (!valTagMatch) continue;
    const contentStart = valStart + valTagMatch[0].length;
    // Walk balanced divs to find closing tag
    let depth = 1, i = contentStart;
    while (i < after.length && depth > 0) {
      const nextOpen  = after.indexOf("<div", i);
      const nextClose = after.indexOf("</div>", i);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) { depth++; i = nextOpen + 1; }
      else { depth--; i = nextClose + 6; }
    }
    const rawValue = after.slice(contentStart, i - 6);

    // The value may have nested <div> lines — join them with newlines
    const lines = [];
    // Extract text from each inner <div>...</div> if present
    const innerDivRe = /<div[^>]*>([\s\S]*?)<\/div>/gi;
    let dm, hasInner = false;
    while ((dm = innerDivRe.exec(rawValue)) !== null) {
      const t = clean(dm[1]);
      if (t) { lines.push(t); hasInner = true; }
    }
    // If no inner divs found, use the raw text directly
    const value = hasInner ? lines.join("\n") : clean(rawValue);

    if (value) pairs.push(`${k.label}: ${value}`);
  }

  if (pairs.length > 0) return pairs.join("\n");

  // Last resort: strip all tags
  const t = clean(section);
  return t.length > 3 ? t.slice(0, 1500) : null;
}

// Extract a single field value by its label text
function extractField(html, labelText) {
  const re = new RegExp(
    `${labelText}[^<]*<\\/[^>]+>[\\s\\S]{0,200}?<[^>]+class="[^"]*value[^"]*"[^>]*>([\\s\\S]*?)<\\/`,
    "i"
  );
  const m = re.exec(html);
  return m ? clean(m[1]) : null;
}

exports.handler = async (event) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };

  const num = ((event.queryStringParameters || {}).num || "").trim();
  if (!num || !/^\d{7,10}$/.test(num)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid number" }) };
  }

  // THE CONFIRMED WORKING ENDPOINT from debug:
  // https://tsdr.uspto.gov/statusview/sn{NUM}
  // Returns pre-rendered HTML fragment injected into the TSDR page
  
  const r = await get(`https://tsdr.uspto.gov/statusview/sn${num}`);

  let tmName = null, ownerInfo = null, filingDate = null, regDate = null, statusDesc = null;

  if (r.status === 200 && r.body.length > 100) {
    const html = r.body;
    tmName     = extractMarkText(html);
    ownerInfo  = extractOwner(html);
    filingDate = extractField(html, "Filing Date");
    regDate    = extractField(html, "Registration Date");
    statusDesc = extractField(html, "Status");
  }

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      number: num,
      tmName:     tmName     || null,
      ownerInfo:  ownerInfo  || null,
      filingDate: filingDate || null,
      regDate:    regDate    || null,
      statusDesc: statusDesc || null,
      logoUrl:    `https://tmcms-docs.uspto.gov/cases/${num}/mark/large.png`,
      tsdrUrl:    `https://tsdr.uspto.gov/#caseNumber=${num}&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch`,
      tmsearchUrl:`https://tmsearch.uspto.gov/search/search-results/${num}`,
    }),
  };
};
