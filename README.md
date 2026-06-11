# Blabla Store - Backend Mollie/Klarna

Backend Node.js per collegare il carrello Blabla Store a Mollie/Klarna.

## Variabili ambiente su Render

Impostare:

- `MOLLIE_API_KEY`
- `SITE_URL`
- `ALLOWED_ORIGIN`
- `WEBHOOK_URL`

## Comandi Render

Build Command:

```bash
npm install
```

Start Command:

```bash
npm start
```

## Endpoint

Test:

```text
GET /
```

Pagamento:

```text
POST /api/create-payment
```
