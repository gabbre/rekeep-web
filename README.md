# reKeep web

Sito di [reKeep](https://github.com/gabbre/GeoMemo): note, elenchi e promemoria sincronizzati con l'app Android
e **cifrati end-to-end**.

- Pagina statica (HTML + JavaScript, nessuna compilazione), pubblicata con GitHub Pages.
- Accesso con Google tramite Firebase; i dati stanno in Firestore **solo cifrati** (AES-256-GCM, chiave derivata
  dalla passphrase con PBKDF2-HMAC-SHA256). La passphrase non lascia mai il browser.
- La chiave può essere ricordata sul dispositivo (IndexedDB, non esportabile). "Blocca" la dimentica.
- Mappa: MapLibre GL con stili OpenFreeMap; indirizzi da Nominatim (OpenStreetMap).
- `?demo` nell'indirizzo apre una versione di prova senza Firebase (passphrase `demo demo demo`).

La configurazione Firebase in `js/config.js` non è un segreto: l'accesso ai dati è protetto dalle regole
di Firestore e il contenuto delle note è comunque cifrato.
