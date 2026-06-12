/* Blabla Store - Patch assistente AI veloce
   Versione: 2026-06-12
   Obiettivo: prima ricerca immediata da CSV (/api/product-search),
   scheda tecnica AI solo quando richiesta (/api/product-ai).
*/
(function () {
  'use strict';

  const BACKEND_BASE = 'https://blablastore-mollie-backend.onrender.com';
  const FAST_ENDPOINT = BACKEND_BASE + '/api/product-search';
  const TECH_ENDPOINT = BACKEND_BASE + '/api/product-ai';

  const TECH_WORDS = [
    'scheda tecnica', 'scheda', 'caratteristiche', 'specifiche', 'specifica',
    'dettagli tecnici', 'dettaglio tecnico', 'dimensioni', 'peso', 'display',
    'schermo', 'processore', 'ram', 'memoria', 'batteria', 'fotocamera',
    'compatibile', 'compatibilità', 'wifi', 'bluetooth', 'usb', 'hdmi',
    'risoluzione', 'hz', 'pollici', 'watt', 'consumo', 'garanzia'
  ];

  function isTechnicalRequest(text) {
    const q = String(text || '').toLowerCase();
    return TECH_WORDS.some(w => q.includes(w));
  }

  function clean(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function findAssistantRoot() {
    const candidates = Array.from(document.querySelectorAll('section, aside, div, dialog'));
    return candidates.find(el => {
      const t = clean(el.innerText || '').toLowerCase();
      return t.includes('assistente blabla store') ||
             (t.includes('assistente ai') && t.includes('invia')) ||
             (t.includes('schede tecniche') && t.includes('invia'));
    }) || document.body;
  }

  function findInput(root) {
    return root.querySelector('textarea, input[type="text"], input:not([type])');
  }

  function findSendButton(root) {
    const buttons = Array.from(root.querySelectorAll('button, input[type="submit"]'));
    return buttons.find(btn => clean(btn.innerText || btn.value || '').toLowerCase() === 'invia') || buttons[buttons.length - 1];
  }

  function ensureMessages(root) {
    let box = root.querySelector('#bb-ai-fast-messages');
    if (box) return box;

    box = document.createElement('div');
    box.id = 'bb-ai-fast-messages';
    box.style.cssText = [
      'display:flex',
      'flex-direction:column',
      'gap:8px',
      'margin:10px 0',
      'max-height:260px',
      'overflow:auto',
      'font-size:14px',
      'line-height:1.35'
    ].join(';');

    const input = findInput(root);
    const form = input && input.closest('form');
    if (form && form.parentNode) form.parentNode.insertBefore(box, form);
    else if (input && input.parentNode) input.parentNode.insertBefore(box, input);
    else root.appendChild(box);

    return box;
  }

  function addMessage(root, role, text) {
    const box = ensureMessages(root);
    const msg = document.createElement('div');
    msg.style.cssText = [
      'padding:8px 10px',
      'border-radius:12px',
      'white-space:pre-wrap',
      'border:1px solid rgba(0,0,0,.08)',
      role === 'user' ? 'align-self:flex-end;background:#f2f2f2' : 'align-self:flex-start;background:#ffffff'
    ].join(';');
    msg.textContent = text;
    box.appendChild(msg);
    box.scrollTop = box.scrollHeight;
    return msg;
  }

  async function postJson(url, payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Errore server');
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function handleSend(event) {
    const root = findAssistantRoot();
    const input = findInput(root);
    if (!input) return;

    const text = clean(input.value);
    if (!text) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();

    input.value = '';
    addMessage(root, 'user', text);

    const loading = addMessage(root, 'bot', isTechnicalRequest(text)
      ? 'Cerco la scheda tecnica ufficiale usando il catalogo e l’EAN…'
      : 'Cerco subito nel catalogo Blabla Store…');

    try {
      const url = isTechnicalRequest(text) ? TECH_ENDPOINT : FAST_ENDPOINT;
      const data = await postJson(url, { message: text });
      loading.textContent = data.answer || data.response || data.message || 'Risposta non disponibile.';
    } catch (err) {
      loading.textContent = 'Non riesco a rispondere adesso. Riprova tra poco oppure scrivi nome prodotto o EAN.';
      console.error('Errore assistente Blabla Store:', err);
    }
  }

  function install() {
    const root = findAssistantRoot();
    const input = findInput(root);
    const button = findSendButton(root);
    if (!input || !button || button.dataset.bbFastAiInstalled === '1') return false;

    button.dataset.bbFastAiInstalled = '1';

    const form = input.closest('form');
    if (form) {
      form.addEventListener('submit', handleSend, true);
    }

    button.addEventListener('click', handleSend, true);

    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        handleSend(event);
      }
    }, true);

    const rootText = clean(root.innerText || '').toLowerCase();
    if (rootText.includes('se l’ean è presente') || rootText.includes('se l\'ean è presente')) {
      // Messaggio più corretto: prima catalogo veloce, poi scheda solo su richiesta.
      const smallNodes = Array.from(root.querySelectorAll('p, div, span'));
      const intro = smallNodes.find(el => clean(el.innerText || '').includes('Ciao! Scrivi'));
      if (intro) {
        intro.textContent = 'Ciao! Scrivi il nome di un prodotto o un EAN. Ti rispondo subito dal catalogo; se vuoi, poi cerco anche la scheda tecnica ufficiale.';
      }
    }

    console.log('Blabla Store: patch assistente AI veloce attiva');
    return true;
  }

  if (!install()) {
    const observer = new MutationObserver(function () {
      if (install()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
