require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { createMollieClient } = require('@mollie/api-client');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://blablastore.it';
const CATALOG_URL = process.env.CATALOG_URL || `${FRONTEND_URL}/prodotti.csv`;
const MOLLIE_API_KEY = process.env.MOLLIE_API_KEY;

function moneyValue(value) {
  const n = Number(String(value ?? '0').replace(',', '.').replace(/[^0-9.-]/g, ''));
  return (Number.isFinite(n) && n > 0 ? n : 0).toFixed(2);
}

function parsePrice(value) {
  return Number(moneyValue(value));
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(value) {
  return normalizeText(value).replace(/\s+/g, '');
}

function csvSplitLine(line) {
  const out = [];
  let cur = '';
  let quote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"' && quote && next === '"') { cur += '"'; i++; continue; }
    if (ch === '"') { quote = !quote; continue; }
    if (ch === ',' && !quote) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const headers = csvSplitLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = csvSplitLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = (cells[i] || '').trim(); });
    return row;
  });
}

let catalogCache = { at: 0, rows: [] };
async function loadProductCatalog() {
  const now = Date.now();
  if (catalogCache.rows.length && now - catalogCache.at < 5 * 60 * 1000) return catalogCache.rows;
  const res = await fetch(CATALOG_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Catalogo non disponibile (${res.status})`);
  const text = await res.text();
  const rows = parseCsv(text).filter(r => productName(r) || productEan(r));
  catalogCache = { at: now, rows };
  return rows;
}

function pick(row, names) {
  for (const n of names) {
    if (row[n] != null && String(row[n]).trim()) return String(row[n]).trim();
  }
  return '';
}

function productName(row) { return pick(row, ['Nome', 'nome', 'Product', 'Titolo']); }
function productBrand(row) { return pick(row, ['Marca', 'marca', 'Brand']); }
function productEan(row) { return pick(row, ['EAN', 'ean', 'Ean', 'Barcode']); }
function productPrice(row) { return pick(row, ['Prezzo', 'prezzo', 'Price']); }
function productImage(row) { return pick(row, ['Immagine', 'immagine', 'Image']); }
function productCategory(row) {
  return ['Categoria','Sottocategoria','Sottocategoria2','Sottocategoria3','Sottocategoria4','Sottocategoria5']
    .map(k => pick(row, [k])).filter(Boolean).join(' > ');
}

function scoreProduct(row, query) {
  const q = normalizeText(query);
  const qc = compactText(query);
  const name = productName(row);
  const brand = productBrand(row);
  const ean = productEan(row).replace(/\D/g, '');
  const nameN = normalizeText(name);
  const brandN = normalizeText(brand);
  const fullN = normalizeText(`${brand} ${name} ${productCategory(row)} ${ean}`);
  const nameC = compactText(name);
  const fullC = compactText(`${brand} ${name}`);
  const qDigits = String(query || '').replace(/\D/g, '');

  if (qDigits.length >= 8 && ean === qDigits) return 10000;
  if (nameN === q) return 9000;
  if (normalizeText(`${brand} ${name}`) === q) return 8800;
  if (nameC === qc || fullC === qc) return 8500;
  if (nameN.includes(q)) return 7600 + q.length;
  if (nameC.includes(qc)) return 7400 + qc.length;
  if (fullN.includes(q)) return 6500 + q.length;
  if (fullC.includes(qc)) return 6300 + qc.length;

  const tokens = q.split(' ').filter(t => t.length > 1);
  if (!tokens.length) return 0;
  const matched = tokens.filter(t => fullN.includes(t) || fullC.includes(t)).length;
  const allImportantMatched = matched === tokens.length;
  if (allImportantMatched) return 5200 + matched * 100;
  if (matched > 0) return matched * 350;
  return 0;
}

function findProducts(rows, query, ean) {
  const search = ean || query;
  const scored = rows.map(row => ({ row, score: scoreProduct(row, search) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || parsePrice(a.row.Prezzo) - parsePrice(b.row.Prezzo));
  return scored;
}

function formatProduct(row) {
  return {
    name: productName(row),
    brand: productBrand(row),
    ean: productEan(row),
    price: productPrice(row),
    category: productCategory(row),
    image: productImage(row)
  };
}

function answerForProduct(row) {
  const p = formatProduct(row);
  return `Ho trovato questo prodotto nel catalogo Blabla Store:\n\n` +
    `📦 ${p.name || 'Nome non disponibile'}\n` +
    `🏷️ Marca: ${p.brand || 'Non disponibile'}\n` +
    `🔢 EAN: ${p.ean || 'Non disponibile'}\n` +
    `💶 Prezzo: ${p.price || 'Non disponibile'}\n` +
    `📂 Categoria: ${p.category || 'Non disponibile'}`;
}

app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'Blabla Store Mollie Backend',
    status: 'online',
    checkout: 'Mollie Orders API - Klarna + PayPal',
    ai: 'disabilitato'
  });
});

app.post('/api/product-search', async (req, res) => {
  try {
    const { message, product, productName: productNameInput, ean } = req.body || {};
    const query = String(ean || message || product || productNameInput || '').trim();
    if (!query) return res.status(400).json({ ok: false, error: 'Scrivi nome prodotto o EAN.' });

    const rows = await loadProductCatalog();
    const matches = findProducts(rows, query, ean);
    if (!matches.length || matches[0].score < 500) {
      return res.json({ ok: true, found: false, answer: 'Non ho trovato questo prodotto nel catalogo Blabla Store. Scrivi nome più preciso o EAN.' });
    }

    const best = matches[0];
    const close = matches.filter(x => x.score >= best.score - 150 && x.score >= 5000).slice(0, 5);
    if (close.length > 1 && best.score < 8500) {
      const list = close.map((x, i) => `${i + 1}. ${productName(x.row)}${productEan(x.row) ? ' - EAN ' + productEan(x.row) : ''}${productPrice(x.row) ? ' - € ' + productPrice(x.row) : ''}`).join('\n');
      return res.json({ ok: true, found: true, ambiguous: true, products: close.map(x => formatProduct(x.row)), answer: `Ho trovato più prodotti simili. Scrivi il nome più preciso o l'EAN:\n\n${list}` });
    }

    return res.json({ ok: true, found: true, product: formatProduct(best.row), answer: answerForProduct(best.row) });
  } catch (err) {
    console.error('Errore /api/product-search:', err);
    res.status(500).json({ ok: false, error: err.message || 'Errore ricerca prodotto' });
  }
});

function buildCustomer(customer = {}) {
  const firstName = customer.firstName || customer.nome || customer.givenName || 'Cliente';
  const lastName = customer.lastName || customer.cognome || customer.familyName || 'Blabla';
  const email = customer.email || 'clienti@blablastore.it';
  const street = customer.address || customer.indirizzo || customer.streetAndNumber || 'Via non indicata 1';
  const postal = customer.postalCode || customer.cap || '00000';
  const city = customer.city || customer.citta || 'Italia';
  const country = (customer.country || customer.paese || 'IT').toUpperCase();
  const phone = customer.phone || customer.telefono || undefined;
  return { givenName: firstName, familyName: lastName, email, streetAndNumber: street, postalCode: postal, city, country, phone };
}

app.post('/api/create-payment', async (req, res) => {
  try {
    if (!MOLLIE_API_KEY) throw new Error('MOLLIE_API_KEY mancante su Render');
    const mollie = createMollieClient({ apiKey: MOLLIE_API_KEY });
    const { items = [], customer = {}, method = 'klarna' } = req.body || {};
    const paymentMethod = String(method || 'klarna').toLowerCase();
    const allowedMethods = ['klarna', 'paypal'];
    if (!allowedMethods.includes(paymentMethod)) {
      return res.status(400).json({ ok: false, error: 'Metodo di pagamento non valido' });
    }
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ ok: false, error: 'Carrello vuoto' });

    const lines = items.map((item, idx) => {
      const quantity = Math.max(1, Number(item.quantity || item.qty || 1));
      const unit = parsePrice(item.price);
      const total = unit * quantity;
      return {
        type: 'physical',
        sku: String(item.ean || item.sku || `BLABLA-${idx + 1}`),
        name: String(item.name || item.title || 'Prodotto Blabla Store').slice(0, 255),
        quantity,
        unitPrice: { currency: 'EUR', value: moneyValue(unit) },
        totalAmount: { currency: 'EUR', value: moneyValue(total) },
        vatRate: '22.00',
        vatAmount: { currency: 'EUR', value: moneyValue(total - total / 1.22) }
      };
    });
    const total = lines.reduce((s, l) => s + parsePrice(l.totalAmount.value), 0);
    const addr = buildCustomer(customer);
    const order = await mollie.orders.create({
      amount: { currency: 'EUR', value: moneyValue(total) },
      orderNumber: `BLABLA-${Date.now()}`,
      method: paymentMethod,
      lines,
      billingAddress: addr,
      shippingAddress: addr,
      redirectUrl: `${FRONTEND_URL}/?ordine=ok`,
      webhookUrl: process.env.MOLLIE_WEBHOOK_URL || undefined,
      locale: 'it_IT',
      metadata: { source: 'blablastore.it' }
    });
    res.json({ ok: true, checkoutUrl: order.getCheckoutUrl ? order.getCheckoutUrl() : (order._links && order._links.checkout && order._links.checkout.href), orderId: order.id });
  } catch (err) {
    console.error('Errore /api/create-payment:', err);
    res.status(500).json({ ok: false, error: err.message || 'Errore creazione pagamento' });
  }
});

app.post('/api/webhook', (req, res) => res.status(200).send('ok'));
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Blabla Store backend online sulla porta ${PORT}`));
