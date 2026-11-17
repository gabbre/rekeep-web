// Stato delle note nel browser e sincronizzazione cifrata con Firestore.
// Stesso schema dell'app: users/{uid}, users/{uid}/notes/{id} {c,d,e}, users/{uid}/meta/settings {c,e}.
// Per ogni nota vince la versione con changedAt più alto.

import { encryptString, decryptString, deriveKey, randomBytes, b64, unb64, ITERATIONS, CHECK_TEXT } from './crypto.js';
import { fromJson, toJson, isBlank, inTrash } from './model.js';

export class Store {
  constructor(backend) {
    this.backend = backend;
    this.notes = new Map();
    this.deleted = new Map();
    this.remoteKnown = new Map();
    this.settings = { labels: [], places: [], changedAt: 0 };
    this.remoteSettingsAt = -1;
    this.key = null;
    this.ready = false;
    this.listeners = new Set();
    this.status = { syncing: false, error: null, lastSync: 0, pending: 0 };
    this.pushTimer = null;
    this.undecryptable = 0;
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(); }

  // ---------- Passphrase ----------

  async accountHasPassphrase() {
    const meta = await this.backend.getAccount();
    return !!meta?.salt;
  }

  async createPassphrase(passphrase) {
    const salt = randomBytes(16);
    const key = await deriveKey(passphrase, salt);
    await this.backend.setAccount({ salt: b64(salt), iter: ITERATIONS, check: await encryptString(key, CHECK_TEXT), v: 1 });
    return key;
  }

  async checkPassphrase(passphrase) {
    const meta = await this.backend.getAccount();
    if (!meta?.salt) throw new Error('Account senza passphrase');
    const key = await deriveKey(passphrase, unb64(meta.salt), meta.iter ?? ITERATIONS);
    try {
      if ((await decryptString(key, meta.check)) === CHECK_TEXT) return key;
    } catch (e) { /* passphrase errata */ }
    return null;
  }

  // ---------- Avvio sync ----------

  start(key) {
    this.key = key;
    this.status.syncing = true;
    this.emit();
    this.backend.listenNotes(
      (docs, fromCache) => this.receiveNotes(docs, fromCache),
      (err) => { this.status.error = 'Sync interrotto: ' + err.message; this.status.syncing = false; this.emit(); }
    );
    this.backend.listenSettings((doc) => this.receiveSettings(doc));
  }

  stop() {
    this.backend.stop();
    this.key = null;
    this.notes.clear(); this.deleted.clear(); this.remoteKnown.clear();
    this.ready = false;
  }

  async receiveNotes(docs, fromCache) {
    let changed = false;
    let failures = 0;
    for (const { id, c, d, e } of docs) {
      if (c == null) continue;
      this.remoteKnown.set(id, Math.max(this.remoteKnown.get(id) ?? -1, c));
      const local = this.notes.get(id);
      if (d) {
        if (local && local.changedAt <= c) { this.notes.delete(id); changed = true; }
        if (!local || local.changedAt <= c) {
          if ((this.deleted.get(id) ?? 0) < c) this.deleted.set(id, c);
        }
        continue;
      }
      const tomb = this.deleted.get(id);
      if (tomb != null && tomb >= c) continue;
      if (local && local.changedAt >= c) continue;
      try {
        const n = fromJson(JSON.parse(await decryptString(this.key, e)));
        n.id = id; n.changedAt = c;
        this.notes.set(id, n);
        this.deleted.delete(id);
        changed = true;
      } catch (err) { failures++; }
    }
    this.undecryptable = failures;
    if (!fromCache) {
      this.status.lastSync = Date.now();
      this.status.syncing = false;
      this.status.error = failures ? `${failures} note non si possono decifrare: passphrase diversa?` : null;
      if (!this.ready) { this.ready = true; this.schedulePush(0); }
    }
    if (changed || !fromCache) this.emit();
  }

  async receiveSettings(doc) {
    if (!doc || doc.c == null) { this.remoteSettingsAt = Math.max(this.remoteSettingsAt, 0); return; }
    this.remoteSettingsAt = Math.max(this.remoteSettingsAt, doc.c);
    if (doc.c <= this.settings.changedAt || !doc.e) return;
    try {
      const o = JSON.parse(await decryptString(this.key, doc.e));
      this.settings = { labels: o.labels ?? [], places: o.places ?? [], changedAt: doc.c };
      this.emit();
    } catch (e) { /* ignora */ }
  }

  // ---------- Modifiche locali ----------

  get(id) { return this.notes.get(id); }
  all() { return [...this.notes.values()]; }

  /** Salva una nota (nuova o modificata). `edited` aggiorna anche "Modificata il". */
  put(note, { edited = true } = {}) {
    const now = Date.now();
    const n = { ...note, changedAt: now };
    if (edited) n.updatedAt = now;
    this.notes.set(n.id, n);
    this.deleted.delete(n.id);
    this.emit();
    this.schedulePush();
    return n;
  }

  update(id, fn, opts) {
    const cur = this.notes.get(id);
    if (!cur) return null;
    return this.put(fn(structuredClone(cur)), opts);
  }

  remove(ids) {
    const now = Date.now();
    for (const id of ids) { this.notes.delete(id); this.deleted.set(id, now); }
    this.emit();
    this.schedulePush();
  }

  setSettings(fn) {
    const s = structuredClone(this.settings);
    fn(s);
    s.changedAt = Date.now();
    this.settings = s;
    this.emit();
    this.schedulePush();
  }

  // ---------- Invio ----------

  schedulePush(delay = 800) {
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.push(), delay);
  }

  async push() {
    if (!this.ready || !this.key) return;
    const ops = [];
    for (const n of this.notes.values()) {
      if (isBlank(n) && !inTrash(n)) continue;
      if (n.changedAt > (this.remoteKnown.get(n.id) ?? -1)) {
        ops.push({ id: n.id, data: { c: n.changedAt, d: false, e: await encryptString(this.key, JSON.stringify(toJson(n))) } });
      }
    }
    for (const [id, t] of this.deleted) {
      const known = this.remoteKnown.get(id);
      if (known != null && t > known) ops.push({ id, data: { c: t, d: true } });
    }
    let settings = null;
    const sc = this.settings.changedAt;
    if (this.remoteSettingsAt >= 0 && sc > this.remoteSettingsAt) {
      settings = { c: sc, e: await encryptString(this.key, JSON.stringify({ labels: this.settings.labels, places: this.settings.places })) };
    }
    if (!ops.length && !settings) return;
    for (const op of ops) this.remoteKnown.set(op.id, op.data.c);
    if (settings) this.remoteSettingsAt = settings.c;
    this.status.pending++;
    this.emit();
    try {
      await this.backend.write(ops, settings);
      this.status.lastSync = Date.now();
      this.status.error = null;
    } catch (e) {
      this.status.error = 'Salvataggio non riuscito: ' + e.message;
      // forza un nuovo tentativo
      for (const op of ops) this.remoteKnown.delete(op.id);
      if (settings) this.remoteSettingsAt = 0;
      this.schedulePush(5000);
    } finally {
      this.status.pending--;
      this.emit();
    }
  }
}
