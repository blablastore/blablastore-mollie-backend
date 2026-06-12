# Blabla Store Backend - AI Chatbox prodotti

Modifica aggiunta:
- endpoint `POST /api/product-ai`
- ricerca prodotto nel catalogo CSV tramite nome o EAN
- risposta AI basata sul catalogo e, quando disponibile, ricerca tecnica tramite EAN
- fallback automatico se la web search OpenAI non è disponibile

## Variabili ambiente da aggiungere su Render

```env
OPENAI_API_KEY=la_tua_chiave_openai
OPENAI_MODEL=gpt-4o-mini
CATALOG_URL=https://blablastore.it/prodotti.csv
```

## Test rapido

Dopo il deploy su Render, prova con:

```bash
curl -X POST https://blablastore-mollie-backend.onrender.com/api/product-ai \
  -H "Content-Type: application/json" \
  -d '{"message":"descrivi un prodotto presente nel catalogo"}'
```

Nota: il checkout Mollie/Klarna esistente non è stato rimosso.
