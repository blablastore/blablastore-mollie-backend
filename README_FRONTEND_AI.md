# Patch frontend assistente AI Blabla Store

## Cosa fa

Questa patch rende la chat più veloce:

1. Per nome prodotto o EAN chiama subito:
   `https://blablastore-mollie-backend.onrender.com/api/product-search`

2. Solo se il cliente chiede scheda tecnica/caratteristiche/specifiche chiama:
   `https://blablastore-mollie-backend.onrender.com/api/product-ai`

Non modifica checkout, carrello, catalogo prodotti, Klarna o Mollie.

## File da caricare nel repo frontend

Carica questo file nella root del repository `blablastore/blablastore`:

- `blabla-ai-chat-patch.js`

## Riga da aggiungere in index.html

Apri `index.html` e aggiungi questa riga prima di `</body>`:

```html
<script src="blabla-ai-chat-patch.js?v=20260612"></script>
```

Poi fai commit e push.

## Test

Dopo il deploy GitHub Pages:

1. Apri https://blablastore.it
2. Scrivi nella chat: `iphone`
3. Deve rispondere subito dal catalogo.
4. Poi scrivi: `scheda tecnica iphone`
5. Solo in quel caso deve usare la ricerca tecnica AI.

## Nota

Questa patch intercetta il pulsante `Invia` della chat esistente e blocca la vecchia chiamata lenta.
