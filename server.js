const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { createMollieClient } = require("@mollie/api-client");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const SITE_URL = process.env.SITE_URL || "https://blablastore.it";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://blablastore.it";
const MOLLIE_API_KEY = (process.env.MOLLIE_API_KEY || "").trim();

if (!MOLLIE_API_KEY) {
  console.warn("ATTENZIONE: MOLLIE_API_KEY non impostata su Render.");
}

// DEBUG SICURO: mostra solo prefisso e lunghezza, non la chiave completa.
console.log("MOLLIE KEY PREFIX:", MOLLIE_API_KEY.substring(0, 10));
console.log("MOLLIE KEY LENGTH:", MOLLIE_API_KEY.length);
console.log(
  "MOLLIE KEY MODE:",
  MOLLIE_API_KEY.startsWith("live_")
    ? "live"
    : MOLLIE_API_KEY.startsWith("test_")
      ? "test"
      : "unknown"
);

const mollieClient = createMollieClient({
  apiKey: MOLLIE_API_KEY || "test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
});

app.use(express.json({ limit: "1mb" }));
app.use(cors({
  origin: [
    ALLOWED_ORIGIN,
    "https://blablastore.it",
    "https://www.blablastore.it",
    "https://blablastore.onrender.com"
  ],
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

function euroToMollieAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error("Importo non valido");
  }
  return number.toFixed(2);
}

function calculateVatAmount(grossAmount, vatRate = 22) {
  const gross = Number(grossAmount);
  const vat = gross - gross / (1 + vatRate / 100);
  return euroToMollieAmount(vat);
}

function normalizeCartItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Carrello vuoto");
  }

  return items.map((item) => {
    const name = String(item.name || item.title || "Prodotto").slice(0, 255);
    const quantity = Math.max(1, parseInt(item.quantity || item.qty || 1, 10));
    const unitPrice = Number(item.price);

    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      throw new Error("Prezzo non valido per " + name);
    }

    return {
      name,
      quantity,
      unitPrice,
      total: unitPrice * quantity,
      sku: String(item.sku || item.id || "SKU-BLABLA").slice(0, 64),
      productUrl: item.productUrl || SITE_URL,
      imageUrl: item.imageUrl || undefined
    };
  });
}

function pickCustomerValue(customer, names) {
  for (const name of names) {
    if (customer && customer[name] !== undefined && customer[name] !== null && String(customer[name]).trim()) {
      return String(customer[name]).trim();
    }
  }
  return "";
}

function buildMollieAddress(customer = {}) {
  const fullName = pickCustomerValue(customer, ["name", "fullName", "nome"]);
  const nameParts = fullName.split(" ").filter(Boolean);
  const givenName = pickCustomerValue(customer, ["givenName", "firstName", "nomeCliente", "nome"]) || nameParts[0] || "";
  const familyName = pickCustomerValue(customer, ["familyName", "lastName", "cognomeCliente", "cognome"]) || nameParts.slice(1).join(" ") || "";
  const email = pickCustomerValue(customer, ["email", "mail"]);
  const phone = pickCustomerValue(customer, ["phone", "telefono", "tel", "mobile"]);
  const streetAndNumber = pickCustomerValue(customer, ["streetAndNumber", "address", "indirizzo", "via"]);
  const postalCode = pickCustomerValue(customer, ["postalCode", "zip", "cap"]);
  const city = pickCustomerValue(customer, ["city", "citta", "città"]);
  const country = (pickCustomerValue(customer, ["country", "paese", "countryCode"]) || "IT").toUpperCase();

  const missing = [];
  if (!givenName) missing.push("nome");
  if (!familyName) missing.push("cognome");
  if (!email) missing.push("email");
  if (!streetAndNumber) missing.push("indirizzo");
  if (!postalCode) missing.push("CAP");
  if (!city) missing.push("città");

  if (missing.length) {
    throw new Error(
      "Per mostrare solo Klarna servono questi dati cliente: " +
      missing.join(", ") +
      ". Aggiungili al checkout del sito e riprova."
    );
  }

  return {
    givenName,
    familyName,
    email,
    phone: phone || undefined,
    streetAndNumber,
    postalCode,
    city,
    country
  };
}

function getCheckoutUrl(resource) {
  if (resource && typeof resource.getCheckoutUrl === "function") {
    return resource.getCheckoutUrl();
  }
  return resource?._links?.checkout?.href || resource?.links?.checkout?.href;
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Blabla Store Mollie Backend",
    status: "online",
    checkout: "Mollie Orders API - solo Klarna",
    ai: "catalogo veloce + schede tecniche su richiesta"
  });
});

app.get("/api/debug-mollie-key", (req, res) => {
  res.json({
    ok: true,
    prefix: MOLLIE_API_KEY.substring(0, 10),
    length: MOLLIE_API_KEY.length,
    mode: MOLLIE_API_KEY.startsWith("live_")
      ? "live"
      : MOLLIE_API_KEY.startsWith("test_")
        ? "test"
        : "unknown"
  });
});

app.post("/api/create-payment", async (req, res) => {
  try {
    const { items, customer } = req.body;
    const normalizedItems = normalizeCartItems(items);
    const total = normalizedItems.reduce((sum, item) => sum + item.total, 0);
    const orderNumber = "BBS-" + Date.now();
    const address = buildMollieAddress(customer || {});

    const lines = normalizedItems.map((item) => ({
      type: "physical",
      name: item.name,
      quantity: item.quantity,
      sku: item.sku,
      unitPrice: { currency: "EUR", value: euroToMollieAmount(item.unitPrice) },
      totalAmount: { currency: "EUR", value: euroToMollieAmount(item.total) },
      vatRate: "22.00",
      vatAmount: { currency: "EUR", value: calculateVatAmount(item.total, 22) },
      productUrl: item.productUrl,
      imageUrl: item.imageUrl
    }));

    const order = await mollieClient.orders.create({
      orderNumber,
      amount: { currency: "EUR", value: euroToMollieAmount(total) },
      method: ["klarna", "klarnapaylater", "klarnapaynow", "klarnasliceit"],
      locale: "it_IT",
      billingAddress: address,
      shippingAddress: address,
      redirectUrl: SITE_URL + "/?payment=return&order=" + encodeURIComponent(orderNumber),
      webhookUrl: process.env.WEBHOOK_URL || undefined,
      lines,
      metadata: {
        source: "blablastore.it",
        orderNumber,
        customer: customer || {},
        items: normalizedItems
      }
    });

    const checkoutUrl = getCheckoutUrl(order);
    if (!checkoutUrl) {
      throw new Error("Ordine creato, ma Mollie non ha restituito il checkoutUrl.");
    }

    res.json({ ok: true, orderId: order.id, orderNumber, checkoutUrl });
  } catch (error) {
    console.error("Errore create-payment Klarna Orders API:", error);
    res.status(400).json({
      ok: false,
      error: error.message || "Errore durante la creazione dell'ordine Klarna"
    });
  }
});

app.post("/api/webhook", express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const mollieId = req.body.id;
    if (!mollieId) {
      return res.status(200).send("missing id");
    }

    if (String(mollieId).startsWith("ord_")) {
      const order = await mollieClient.orders.get(mollieId);
      console.log("Webhook Mollie Order:", {
        id: order.id,
        status: order.status,
        amount: order.amount,
        metadata: order.metadata
      });
    } else {
      const payment = await mollieClient.payments.get(mollieId);
      console.log("Webhook Mollie Payment:", {
        id: payment.id,
        status: payment.status,
        amount: payment.amount,
        metadata: payment.metadata
      });
    }

    res.status(200).send("ok");
  } catch (error) {
    console.error("Errore webhook:", error);
    res.status(200).send("error handled");
  }
});

// === AI CHATBOX PRODOTTI BLABLA STORE ===
// Architettura veloce:
// 1) ricerca immediata nel CSV con EAN, nome, marca e prezzo
// 2) OpenAI/web search solo se il cliente chiede scheda tecnica, caratteristiche o dettagli tecnici
// Variabili Render consigliate:
// OPENAI_API_KEY=...
// OPENAI_MODEL=gpt-4o-mini
// CATALOG_URL=https://blablastore.it/prodotti.csv

let catalogCache = { url: "", loadedAt: 0, rows: [] };

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9àèéìòù]/gi, "");
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readField(row, possibleNames) {
  for (const name of possibleNames) {
    const wanted = normalizeKey(name);
    for (const key of Object.keys(row)) {
      if (normalizeKey(key) === wanted) {
        return String(row[key] || "").trim();
      }
    }
  }
  return "";
}

function productName(row) {
  return readField(row, ["nome", "name", "titolo", "title", "prodotto", "product", "descrizione", "description"]);
}

function productEan(row) {
  return readField(row, ["ean", "codiceean", "barcode", "codiceabarre", "gtin"]);
}

function productPrice(row) {
  return readField(row, ["prezzo", "price", "prezzoiva", "amount"]);
}

function productCategory(row) {
  return readField(row, ["categoria", "category", "directory", "reparto"]);
}

function productBrand(row) {
  return readField(row, ["marca", "brand", "produttore", "manufacturer"]);
}

function productSubcategory(row) {
  return readField(row, ["sottocategoria", "subcategory", "sottocategoria2", "sottocategoria3"]);
}

function productImage(row) {
  return readField(row, ["immagine", "image", "imageurl", "foto"]);
}

function formatPrice(value) {
  const clean = String(value || "").trim();
  if (!clean) return "Non disponibile";
  return clean.includes("€") ? clean : clean + " €";
}

async function loadProductCatalog() {
  const url = process.env.CATALOG_URL || "https://blablastore.it/prodotti.csv";
  const maxAgeMs = 10 * 60 * 1000;

  if (catalogCache.url === url && catalogCache.rows.length && Date.now() - catalogCache.loadedAt < maxAgeMs) {
    return catalogCache.rows;
  }

  const response = await fetch(url, { headers: { "User-Agent": "BlablaStoreAI/1.1" } });
  if (!response.ok) {
    throw new Error("Impossibile leggere il catalogo prodotti: HTTP " + response.status);
  }

  const csv = await response.text();
  const lines = csv.split(/\r?\n/).filter((line) => line.trim());

  if (lines.length < 2) {
    throw new Error("Catalogo prodotti vuoto o non valido.");
  }

  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header || ("colonna_" + index)] = values[index] || "";
    });
    return row;
  });

  catalogCache = { url, loadedAt: Date.now(), rows };
  return rows;
}

function scoreProduct(row, query) {
  const q = normalizeText(query);
  const name = normalizeText(productName(row));
  const brand = normalizeText(productBrand(row));
  const category = normalizeText(productCategory(row));
  const subcategory = normalizeText(productSubcategory(row));
  const ean = productEan(row).replace(/\D/g, "");
  const queryDigits = String(query || "").replace(/\D/g, "");

  if (!q && !queryDigits) return 0;
  if (ean && queryDigits && ean === queryDigits) return 2000;
  if (ean && queryDigits && ean.includes(queryDigits)) return 1500;
  if (name && name === q) return 1000;
  if (name && name.includes(q)) return 800;

  const searchable = [name, brand, category, subcategory].join(" ");
  const tokens = q.split(/\s+/).filter((token) => token.length >= 2);
  let score = 0;

  for (const token of tokens) {
    if (name.includes(token)) score += 90;
    if (brand.includes(token)) score += 45;
    if (category.includes(token)) score += 15;
    if (subcategory.includes(token)) score += 15;
    if (searchable.includes(token)) score += 5;
  }

  return score;
}

function findProductMatches(rows, query, ean, limit = 5) {
  const cleanEan = String(ean || "").replace(/\D/g, "");

  if (cleanEan) {
    const exact = rows.find((row) => productEan(row).replace(/\D/g, "") === cleanEan);
    if (exact) return [exact];
  }

  return rows
    .map((row) => ({ row, score: scoreProduct(row, query || "") }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.row);
}

function findBestProduct(rows, query, ean) {
  return findProductMatches(rows, query, ean, 1)[0] || null;
}

function productToPayload(row) {
  return {
    name: productName(row),
    brand: productBrand(row),
    ean: productEan(row),
    price: productPrice(row),
    category: productCategory(row),
    subcategory: productSubcategory(row),
    image: productImage(row)
  };
}

function buildCatalogAnswer(product, matches = []) {
  const name = productName(product);
  const brand = productBrand(product);
  const ean = productEan(product);
  const price = productPrice(product);
  const category = productCategory(product);
  const subcategory = productSubcategory(product);

  let answer =
    "Ho trovato questo prodotto nel catalogo Blabla Store:\n\n" +
    "📦 " + (name || "Nome non disponibile") + "\n" +
    "🏷️ Marca: " + (brand || "Non disponibile") + "\n" +
    "🔢 EAN: " + (ean || "Non disponibile") + "\n" +
    "💶 Prezzo: " + formatPrice(price) + "\n" +
    "📂 Categoria: " + (category || "Non disponibile") +
    (subcategory ? " / " + subcategory : "") + "\n\n";

  if (matches.length > 1) {
    answer += "Ho trovato anche prodotti simili. Se vuoi, posso aiutarti a scegliere quello giusto.\n\n";
  }

  answer += "Vuoi che cerchi anche la scheda tecnica ufficiale?";
  return answer;
}

function wantsTechnicalSheet(message) {
  const q = normalizeText(message);
  const technicalWords = [
    "scheda tecnica",
    "caratteristiche",
    "specifiche",
    "specifica",
    "dettagli tecnici",
    "dimensioni",
    "compatibilita",
    "memoria",
    "ram",
    "display",
    "batteria",
    "processore",
    "fotocamera",
    "risoluzione",
    "peso",
    "garanzia",
    "manuale",
    "datasheet",
    "tecnica",
    "confronta",
    "confronto"
  ];
  return technicalWords.some((word) => q.includes(word));
}

function extractResponseText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const chunks = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && content?.text) {
        chunks.push(content.text);
      }
      if (content?.text && typeof content.text === "string") {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join("\n").trim();
}

async function askOpenAiForProduct({ userMessage, product }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return "Chat AI non ancora configurata: manca OPENAI_API_KEY su Render.";
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const name = productName(product);
  const ean = productEan(product);
  const price = productPrice(product);
  const category = productCategory(product);
  const brand = productBrand(product);
  const subcategory = productSubcategory(product);

  const searchInstruction = ean
    ? "Cerca sul web la scheda tecnica usando prima l'EAN " + ean + ", poi marca e nome prodotto. Dai priorità assoluta al sito ufficiale del produttore. Se non trovi una fonte ufficiale, puoi usare fonti tecniche affidabili, ma devi dirlo chiaramente."
    : "Non è disponibile un EAN: usa solo marca e nome prodotto e indica chiaramente che l'identificazione è meno certa.";

  const input = [
    {
      role: "system",
      content:
        "Sei l'assistente AI prodotti di Blabla Store. Rispondi sempre in italiano. " +
        "Usa il catalogo Blabla Store per nome, prezzo, categoria ed EAN. " +
        "Per le schede tecniche devi cercare informazioni tramite EAN, privilegiando il sito ufficiale del produttore. " +
        "Non inventare mai specifiche tecniche, compatibilità, memoria, display, batteria, dimensioni, garanzia o disponibilità. " +
        "Se un dato non è confermato da una fonte affidabile, scrivi 'dato non disponibile'. " +
        "Non dire che il prodotto è disponibile se il catalogo non lo indica. " +
        "Formato risposta: nome prodotto, prezzo Blabla Store, EAN, scheda tecnica confermata, fonte usata, domanda finale commerciale."
    },
    {
      role: "user",
      content:
        "Domanda cliente: " + (userMessage || "") + "\n\n" +
        "Prodotto trovato nel catalogo Blabla Store:\n" +
        "- Nome: " + (name || "non disponibile") + "\n" +
        "- Marca: " + (brand || "non disponibile") + "\n" +
        "- EAN: " + (ean || "non disponibile") + "\n" +
        "- Categoria: " + (category || "non disponibile") + "\n" +
        "- Sottocategoria: " + (subcategory || "non disponibile") + "\n" +
        "- Prezzo Blabla Store: " + (price || "non disponibile") + "\n\n" +
        searchInstruction + "\n\n" +
        "Rispondi senza inventare. Se trovi la scheda tecnica, riassumila in punti semplici. Se non la trovi, scrivi: 'Scheda tecnica ufficiale non trovata'."
    }
  ];

  async function callResponses(payload) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.error?.message || ("Errore OpenAI HTTP " + response.status);
      throw new Error(message);
    }
    return extractResponseText(data);
  }

  const basePayload = { model, input, temperature: 0.1 };

  // Primo tentativo: web search per cercare scheda tecnica tramite EAN.
  // Se non supportato dall'account/modello, fallback automatico senza ricerca web.
  try {
    if (ean || brand || name) {
      const text = await callResponses({
        ...basePayload,
        tools: [{ type: "web_search_preview" }]
      });
      if (text) return text;
    }
  } catch (error) {
    console.warn("OpenAI web search non disponibile, fallback senza web search:", error.message);
  }

  const fallbackText = await callResponses(basePayload);
  return fallbackText || "Non sono riuscito a generare una risposta per questo prodotto.";
}

// Endpoint velocissimo: solo CSV, nessuna chiamata OpenAI.
app.post("/api/product-search", async (req, res) => {
  try {
    const { message, product, productName: requestedProductName, ean } = req.body || {};
    const query = String(message || product || requestedProductName || ean || "").trim();

    if (!query) {
      return res.status(400).json({ ok: false, error: "Scrivi il nome del prodotto o l'EAN." });
    }

    const rows = await loadProductCatalog();
    const matches = findProductMatches(rows, query, ean, 5);
    const matchedProduct = matches[0];

    if (!matchedProduct) {
      return res.json({
        ok: true,
        found: false,
        answer: "Non ho trovato questo prodotto nel catalogo Blabla Store. Scrivi nome esatto o EAN."
      });
    }

    res.json({
      ok: true,
      found: true,
      answer: buildCatalogAnswer(matchedProduct, matches),
      product: productToPayload(matchedProduct),
      matches: matches.map(productToPayload)
    });
  } catch (error) {
    console.error("Errore /api/product-search:", error);
    res.status(500).json({ ok: false, error: error.message || "Errore ricerca prodotto" });
  }
});

// Endpoint compatibile col frontend attuale.
// Se il messaggio è normale, risponde subito dal CSV.
// Se il messaggio chiede scheda tecnica/caratteristiche, usa OpenAI + ricerca web.
app.post("/api/product-ai", async (req, res) => {
  try {
    const { message, product, productName: requestedProductName, ean } = req.body || {};
    const query = String(message || product || requestedProductName || ean || "").trim();

    if (!query) {
      return res.status(400).json({ ok: false, error: "Scrivi il nome del prodotto o l'EAN." });
    }

    const rows = await loadProductCatalog();
    const matches = findProductMatches(rows, query, ean, 5);
    const matchedProduct = matches[0];

    if (!matchedProduct) {
      return res.json({
        ok: true,
        found: false,
        answer: "Non ho trovato questo prodotto nel catalogo Blabla Store. Scrivimi il nome esatto o l'EAN e riprovo."
      });
    }

    if (!wantsTechnicalSheet(query)) {
      return res.json({
        ok: true,
        found: true,
        mode: "catalog",
        answer: buildCatalogAnswer(matchedProduct, matches),
        product: productToPayload(matchedProduct),
        matches: matches.map(productToPayload)
      });
    }

    const answer = await askOpenAiForProduct({ userMessage: query, product: matchedProduct });
    res.json({
      ok: true,
      found: true,
      mode: "technical-ai",
      answer,
      product: productToPayload(matchedProduct)
    });
  } catch (error) {
    console.error("Errore /api/product-ai:", error);
    res.status(500).json({ ok: false, error: error.message || "Errore durante la risposta AI prodotto" });
  }
});

app.listen(PORT, () => {
  console.log("Blabla Store Mollie backend online sulla porta " + PORT);
});
