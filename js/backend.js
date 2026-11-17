// Accesso ai dati: Firebase (reale) oppure "demo" in memoria per provare l'interfaccia (?demo).

import { firebaseConfig } from './config.js';
import { encryptString, deriveKey, randomBytes, b64, ITERATIONS, CHECK_TEXT } from './crypto.js';
import { newNote, toJson, uid as newId } from './model.js';

const FB = 'https://www.gstatic.com/firebasejs/10.14.1';

export function isConfigured() {
  return firebaseConfig && firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('INSERISCI');
}

export async function createBackend() {
  const demo = new URLSearchParams(location.search).has('demo') || !isConfigured();
  return demo ? new DemoBackend() : FirebaseBackend.create();
}

class FirebaseBackend {
  static async create() {
    const [{ initializeApp }, A, F] = await Promise.all([
      import(`${FB}/firebase-app.js`),
      import(`${FB}/firebase-auth.js`),
      import(`${FB}/firebase-firestore.js`),
    ]);
    const b = new FirebaseBackend();
    b.A = A; b.F = F;
    const app = initializeApp(firebaseConfig);
    b.auth = A.getAuth(app);
    try {
      // cache locale: dentro ci sono solo dati cifrati
      b.db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
    } catch (e) {
      b.db = F.getFirestore(app);
    }
    b.unsubs = [];
    return b;
  }

  get demo() { return false; }

  onAuth(cb) {
    this.A.onAuthStateChanged(this.auth, (u) => { this.user = u; cb(u ? { uid: u.uid, email: u.email, name: u.displayName, photo: u.photoURL } : null); });
  }

  async signIn() {
    const provider = new this.A.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await this.A.signInWithPopup(this.auth, provider);
  }

  async signOut() {
    this.stop();
    await this.A.signOut(this.auth);
  }

  userRef() { return this.F.doc(this.db, 'users', this.user.uid); }

  async getAccount() {
    const s = await this.F.getDoc(this.userRef());
    return s.exists() ? s.data() : null;
  }

  async setAccount(data) { await this.F.setDoc(this.userRef(), data); }

  listenNotes(cb, onError) {
    const col = this.F.collection(this.db, 'users', this.user.uid, 'notes');
    this.unsubs.push(this.F.onSnapshot(col, { includeMetadataChanges: true }, (snap) => {
      const docs = snap.docChanges().map((ch) => ({ id: ch.doc.id, ...ch.doc.data() }));
      cb(docs, snap.metadata.fromCache);
    }, onError));
  }

  listenSettings(cb) {
    const ref = this.F.doc(this.db, 'users', this.user.uid, 'meta', 'settings');
    this.unsubs.push(this.F.onSnapshot(ref, (s) => cb(s.exists() ? s.data() : null)));
  }

  async write(ops, settings) {
    const F = this.F;
    const chunks = [];
    for (let i = 0; i < ops.length; i += 400) chunks.push(ops.slice(i, i + 400));
    if (!chunks.length) chunks.push([]);
    for (const [i, chunk] of chunks.entries()) {
      const batch = F.writeBatch(this.db);
      for (const { id, data } of chunk) batch.set(F.doc(this.db, 'users', this.user.uid, 'notes', id), data);
      if (i === 0 && settings) batch.set(F.doc(this.db, 'users', this.user.uid, 'meta', 'settings'), settings);
      await batch.commit();
    }
  }

  stop() { this.unsubs.forEach((u) => u()); this.unsubs = []; }
}

/** Server finto in memoria, con note di esempio cifrate davvero (passphrase: "demo demo demo"). */
class DemoBackend {
  get demo() { return true; }
  constructor() { this.account = null; this.docs = new Map(); this.settings = null; this.cbs = []; }

  onAuth(cb) { this.authCb = cb; setTimeout(() => cb(null), 0); }

  async signIn() {
    if (!this.account) await this.seed();
    this.authCb({ uid: 'demo', email: 'demo@example.com', name: 'Demo' });
  }

  async signOut() { this.stop(); this.authCb(null); }

  async seed() {
    const salt = randomBytes(16);
    const key = await deriveKey('demo demo demo', salt, 1000);
    this.account = { salt: b64(salt), iter: 1000, check: await encryptString(key, CHECK_TEXT), v: 1 };
    const h = 3600e3, now = Date.now();
    const notes = [
      { ...newNote(), title: 'Benvenuto in reKeep', text: 'Le note sono cifrate end-to-end.\nSul server arriva solo testo illeggibile.', pinned: true, color: 3 },
      { ...newNote({ checklist: true }), title: 'Spesa', items: [{ id: newId(), t: 'Latte', c: false }, { id: newId(), t: 'Pane', c: false }, { id: newId(), t: 'Caffè', c: true }], reminder: { type: 'place', lat: 45.6339, lon: 9.2009, radius: 200, place: 'Famila, Nova Milanese', trigger: 'ENTER', repeat: false, done: false }, labels: ['Casa'] },
      { ...newNote(), title: 'Chiamare il meccanico', text: 'Tagliando e gomme invernali', reminder: { type: 'time', at: now + 20 * h, repeat: 'NONE', done: false }, color: 6 },
      { ...newNote(), title: '', text: 'Idea: widget con le note fissate sulla home', labels: ['Idee'], color: 4 },
      { ...newNote(), title: 'Palestra', text: 'Spalle con manubri, 3x12', reminder: { type: 'time', at: now + 2 * h, repeat: 'WEEKLY', done: false } },
    ];
    for (const n of notes) this.docs.set(n.id, { c: n.changedAt, d: false, e: await encryptString(key, JSON.stringify(toJson(n))) });
    this.settings = { c: now, e: await encryptString(key, JSON.stringify({ labels: ['Casa', 'Idee', 'Lavoro'], places: [{ id: newId(), name: 'Casa', lat: 45.629, lon: 9.205, address: 'Nova Milanese', radius: 200 }] })) };
  }

  async getAccount() { return this.account; }
  async setAccount(d) { this.account = d; }

  listenNotes(cb) {
    this.notesCb = cb;
    setTimeout(() => cb([...this.docs].map(([id, d]) => ({ id, ...d })), false), 150);
  }

  listenSettings(cb) { this.settingsCb = cb; setTimeout(() => cb(this.settings), 100); }

  async write(ops, settings) {
    await new Promise((r) => setTimeout(r, 120));
    for (const { id, data } of ops) this.docs.set(id, data);
    if (settings) this.settings = settings;
    this.notesCb?.(ops.map(({ id, data }) => ({ id, ...data })), false);
  }

  stop() { this.notesCb = null; this.settingsCb = null; }
}
