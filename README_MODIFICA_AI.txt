MODIFICA ASSISTENTE AI BLABLA STORE

File modificato:
- server.js

Cosa cambia:
1. Aggiunto endpoint veloce POST /api/product-search
   - legge solo prodotti.csv
   - cerca per nome/EAN/marca/categoria
   - risponde subito con nome, marca, EAN, prezzo e categoria
   - non usa OpenAI

2. Modificato endpoint esistente POST /api/product-ai
   - resta compatibile col frontend già online
   - se il cliente chiede solo un prodotto, risponde dal CSV senza OpenAI
   - se il cliente chiede scheda tecnica/caratteristiche/specifiche, usa OpenAI e web search
   - dà priorità a EAN e sito ufficiale produttore
   - istruito a non inventare dati tecnici

Non modificato:
- checkout Klarna
- Mollie Orders API
- webhook Mollie
- frontend catalogo

Variabili Render consigliate:
- CATALOG_URL=https://blablastore.it/prodotti.csv
- OPENAI_API_KEY=la tua chiave
- OPENAI_MODEL=gpt-4o-mini

Test dopo deploy Render:
curl -X POST https://blablastore-mollie-backend.onrender.com/api/product-ai \
-H "Content-Type: application/json" \
-d "{\"message\":\"iphone\"}"

Test scheda tecnica:
curl -X POST https://blablastore-mollie-backend.onrender.com/api/product-ai \
-H "Content-Type: application/json" \
-d "{\"message\":\"scheda tecnica iphone\"}"
