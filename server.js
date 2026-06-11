import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Mollie from "@mollie/api-client";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 3000;
const SITE_URL = process.env.SITE_URL || "https://blablastore.it";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://blablastore.it";
const MOLLIE_API_KEY = process.env.MOLLIE_API_KEY;

if (!MOLLIE_API_KEY) {
  console.warn("ATTENZIONE: MOLLIE_API_KEY non impostata.");
}

const mollieClient = new Mollie({
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

function normalizeCartItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Carrello vuoto");
  }

  return items.map((item) => {
    const name = String(item.name || item.title || "Prodotto").slice(0, 255);
    const quantity = Math.max(1, parseInt(item.quantity || item.qty || 1, 10));
    const unitPrice = Number(item.price);

    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      throw new Error(`Prezzo non valido per ${name}`);
    }

    return {
      name,
      quantity,
      unitPrice,
      total: unitPrice * quantity
    };
  });
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Blabla Store Mollie Backend",
    status: "online"
  });
});

app.post("/api/create-payment", async (req, res) => {
  try {
    const { items, customer } = req.body;

    const normalizedItems = normalizeCartItems(items);
    const total = normalizedItems.reduce((sum, item) => sum + item.total, 0);

    const description = normalizedItems.length === 1
      ? normalizedItems[0].name
      : `Ordine Blabla Store - ${normalizedItems.length} prodotti`;

    const metadata = {
      source: "blablastore.it",
      customer: customer || {},
      items: normalizedItems
    };

    const payment = await mollieClient.payments.create({
      amount: {
        currency: "EUR",
        value: euroToMollieAmount(total)
      },
      description: description.slice(0, 255),
      redirectUrl: `${SITE_URL}/?payment=return`,
      webhookUrl: process.env.WEBHOOK_URL || undefined,
      metadata
    });

    res.json({
      ok: true,
      paymentId: payment.id,
      checkoutUrl: payment.getCheckoutUrl()
    });
  } catch (error) {
    console.error("Errore create-payment:", error);
    res.status(400).json({
      ok: false,
      error: error.message || "Errore durante la creazione del pagamento"
    });
  }
});

app.post("/api/webhook", express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const paymentId = req.body.id;
    if (!paymentId) {
      return res.status(200).send("missing id");
    }

    const payment = await mollieClient.payments.get(paymentId);

    console.log("Webhook Mollie:", {
      id: payment.id,
      status: payment.status,
      amount: payment.amount,
      metadata: payment.metadata
    });

    res.status(200).send("ok");
  } catch (error) {
    console.error("Errore webhook:", error);
    res.status(200).send("error handled");
  }
});

app.listen(PORT, () => {
  console.log(`Blabla Store Mollie backend online sulla porta ${PORT}`);
});
