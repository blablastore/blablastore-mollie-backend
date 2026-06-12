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
  MOLLIE_API_KEY.startsWith("live_") ? "live" : MOLLIE_API_KEY.startsWith("test_") ? "test" : "unknown"
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
      "Per mostrare solo Klarna servono questi dati cliente: " + missing.join(", ") +
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
    checkout: "Mollie Orders API - solo Klarna"
  });
});

app.get("/api/debug-mollie-key", (req, res) => {
  res.json({
    ok: true,
    prefix: MOLLIE_API_KEY.substring(0, 10),
    length: MOLLIE_API_KEY.length,
    mode: MOLLIE_API_KEY.startsWith("live_") ? "live" : MOLLIE_API_KEY.startsWith("test_") ? "test" : "unknown"
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
      unitPrice: {
        currency: "EUR",
        value: euroToMollieAmount(item.unitPrice)
      },
      totalAmount: {
        currency: "EUR",
        value: euroToMollieAmount(item.total)
      },
      vatRate: "22.00",
      vatAmount: {
        currency: "EUR",
        value: calculateVatAmount(item.total, 22)
      },
      productUrl: item.productUrl,
      imageUrl: item.imageUrl
    }));

    const order = await mollieClient.orders.create({
      orderNumber,
      amount: {
        currency: "EUR",
        value: euroToMollieAmount(total)
      },
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

    res.json({
      ok: true,
      orderId: order.id,
      orderNumber,
      checkoutUrl
    });
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
// Endpoint usato dal frontend: POST /api/product-ai
// Variabili Render consigliate:
// OPENAI_API_KEY=...
// OPENAI_MODEL=gpt-4o-mini
// CATALOG_URL=https://blablastore.it/prodotti.csv

let catalogCache = {
  url: "",
  loadedAt: 0,
  rows: []
};

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
    .replace(/[\u0300-\u036f]/g, "");
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

async function loadProductCatalog() {
  const url = process.env.CATALOG_URL || "https://blablastore.it/prodotti.csv";
  const maxAgeMs = 10 * 60 * 1000;

  if (catalogCache.url === url && catalogCache.rows.length && Date.now() - catalogCache.loadedAt < maxAgeMs) {
    return catalogCache.rows;
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": "BlablaStoreAI/1.0"
    }
  });

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

  catalogCache = {
    url,
    loadedAt: Date.now(),
    rows
  };

  return rows;
}

function scoreProduct(row, query) {
  const q = normalizeText(query);
  const name = normalizeText(productName(row));
  const category = normalizeText(productCategory(row));
  const ean = productEan(row);

  if (!q) return 0;
  if (ean && q.includes(ean)) return 1000;
  if (name && name === q) return 900;
  if (name && name.includes(q)) return 700;

  const tokens = q.split(/\s+/).filter((token) => token.length >= 3);
  let score = 0;
  for (const token of tokens) {
    if (name.includes(token)) score += 60;
    if (category.includes(token)) score += 10;
  }
  return score;
}

function findBestProduct(rows, query, ean) {
  const cleanEan = String(ean || "").replace(/\D/g, "");

  if (cleanEan) {
    const exact = rows.find((row) => productEan(row).replace(/\D/g, "") === cleanEan);
    if (exact) return exact;
  }

  const scored = rows
    .map((row) => ({ row, score: scoreProduct(row, query || "") }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.row || null;
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

  const input = [
    {
      role: "system",
      content:
        "Sei l'assistente prodotti di Blabla Store. Rispondi in italiano, in modo chiaro e commerciale. " +
        "Usa i dati del catalogo come fonte principale. Se trovi informazioni tecniche tramite EAN, riassumile. " +
        "Non inventare specifiche. Se un dato tecnico non è certo, scrivi che non è disponibile o che va verificato. " +
        "Non promettere disponibilità se non è indicata nel catalogo."
    },
    {
      role: "user",
      content:
        "Domanda cliente: " + (userMessage || "") + "\n\n" +
        "Prodotto catalogo Blabla Store:\n" +
        "- Nome: " + (name || "non disponibile") + "\n" +
        "- EAN: " + (ean || "non disponibile") + "\n" +
        "- Categoria: " + (category || "non disponibile") + "\n" +
        "- Prezzo: " + (price || "non disponibile") + "\n\n" +
        "Rispondi con descrizione prodotto, eventuali caratteristiche tecniche trovate tramite EAN, prezzo Blabla Store e una breve domanda finale utile alla vendita."
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

  const basePayload = {
    model,
    input,
    temperature: 0.2
  };

  // Primo tentativo: con web search, utile per cercare schede tecniche tramite EAN.
  // Se il modello/account non supporta lo strumento, il codice fa fallback automatico senza web search.
  try {
    if (ean) {
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

app.post("/api/product-ai", async (req, res) => {
  try {
    const { message, product, productName: requestedProductName, ean } = req.body || {};
    const query = String(message || product || requestedProductName || ean || "").trim();

    if (!query) {
      return res.status(400).json({
        ok: false,
        error: "Scrivi il nome del prodotto o l'EAN."
      });
    }

    const rows = await loadProductCatalog();
    const matchedProduct = findBestProduct(rows, query, ean);

    if (!matchedProduct) {
      return res.json({
        ok: true,
        answer:
          "Non ho trovato questo prodotto nel catalogo Blabla Store. Scrivimi il nome esatto o l'EAN e riprovo."
      });
    }

    const answer = await askOpenAiForProduct({
      userMessage: query,
      product: matchedProduct
    });

    res.json({
      ok: true,
      answer,
      product: {
        name: productName(matchedProduct),
        ean: productEan(matchedProduct),
        price: productPrice(matchedProduct),
        category: productCategory(matchedProduct)
      }
    });
  } catch (error) {
    console.error("Errore /api/product-ai:", error);
    res.status(500).json({
      ok: false,
      error: error.message || "Errore durante la risposta AI prodotto"
    });
  }
});


app.listen(PORT, () => {
  console.log("Blabla Store Mollie backend online sulla porta " + PORT);
});
