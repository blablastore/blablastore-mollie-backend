# Blabla Store AI - Schede tecniche tramite EAN

Questo backend usa l'endpoint:

POST /api/product-ai

Flusso:
1. Il frontend invia una domanda del cliente.
2. Il backend legge il catalogo da `CATALOG_URL`.
3. Trova il prodotto per nome o EAN.
4. Passa a OpenAI nome, marca, categoria, prezzo ed EAN.
5. L'assistente cerca la scheda tecnica tramite EAN, dando priorità al sito ufficiale del produttore.
6. Se non trova una fonte affidabile, deve rispondere: `Scheda tecnica ufficiale non trovata`.

Variabili Render richieste:

OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
CATALOG_URL=https://blablastore.it/prodotti.csv

Note:
- Il CSV deve contenere una colonna `EAN`.
- La colonna `Marca` migliora molto il riconoscimento del prodotto.
- Il modello non deve inventare specifiche tecniche.
