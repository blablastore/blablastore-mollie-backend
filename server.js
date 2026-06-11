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

app.listen(PORT, () => {
  console.log("Blabla Store Mollie backend online sulla porta " + PORT);
});
