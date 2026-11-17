// Cifratura end-to-end, identica all'app Android:
// chiave = PBKDF2-HMAC-SHA256(passphrase UTF-8 NFC, salt, iterazioni) → AES-256
// dati   = AES-GCM, IV casuale 12 byte, tag 128 bit, Base64(IV ‖ cifrato ‖ tag)

export const ITERATIONS = 310000;
export const CHECK_TEXT = 'rekeep-ok';

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64(bytes) {
  let s = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 0x8000) s += String.fromCharCode(...arr.subarray(i, i + 0x8000));
  return btoa(s);
}

export function unb64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** Chiave AES non estraibile: si può conservare in IndexedDB ma non esportare. */
export async function deriveKey(passphrase, salt, iterations = ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptString(key, text) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return b64(out);
}

export async function encryptBytes(key, bytes) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return b64(out);
}

export async function decryptBytes(key, data) {
  const all = unb64(data);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12) }, key, all.subarray(12)));
}

export async function decryptString(key, data) {
  const all = unb64(data);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12) }, key, all.subarray(12));
  return dec.decode(pt);
}

// ---------- Chiave ricordata su questo dispositivo (IndexedDB) ----------

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('rekeep', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('keys');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveKey(uid, key) {
  try {
    const d = await db();
    await new Promise((res, rej) => {
      const tx = d.transaction('keys', 'readwrite');
      tx.objectStore('keys').put(key, uid);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  } catch (e) { console.warn('Chiave non salvata', e); }
}

export async function loadKey(uid) {
  try {
    const d = await db();
    return await new Promise((res, rej) => {
      const req = d.transaction('keys').objectStore('keys').get(uid);
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => rej(req.error);
    });
  } catch (e) { return null; }
}

export async function forgetKey(uid) {
  try {
    const d = await db();
    await new Promise((res) => {
      const tx = d.transaction('keys', 'readwrite');
      tx.objectStore('keys').delete(uid);
      tx.oncomplete = res; tx.onerror = res;
    });
  } catch (e) { /* niente */ }
}
