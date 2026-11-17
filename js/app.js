import { createBackend } from './backend.js';
import { Store } from './store.js';
import * as M from './model.js';
import { loadKey, saveKey, forgetKey } from './crypto.js';
import { openMapPicker } from './mapdialog.js';
import { BACKGROUNDS, bgById } from './backgrounds.js';

const $ = (id) => document.getElementById(id);
const darkMq = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => darkMq.matches;
const MIN_PASS = 10;

let backend, store, user;
let passMode = 'enter';
const ui = {
  section: 'notes',
  label: null,
  query: '',
  list: (() => { try { return localStorage.getItem('rekeep.view') === 'list'; } catch (e) { return false; } })(),
  collapsed: false,
};

// ---------- Avvio ----------

function show(name) {
  for (const s of ['loading', 'login', 'pass', 'app']) $(`screen-${s}`).hidden = s !== name;
}

async function main() {
  try {
    backend = await createBackend();
  } catch (e) {
    show('login');
    $('login-error').hidden = false;
    $('login-error').textContent = 'Impossibile caricare Firebase: ' + e.message;
    return;
  }
  store = new Store(backend);
  store.onChange(scheduleRender);
  $('demo-hint').hidden = !backend.demo;

  backend.onAuth(async (u) => {
    user = u;
    if (!u) { show('login'); return; }
    show('loading');
    const key = backend.demo ? null : await loadKey(u.uid);
    if (key) { startApp(key); return; }
    try {
      showPass((await store.accountHasPassphrase()) ? 'enter' : 'new');
    } catch (e) {
      showPass('enter', 'Impossibile contattare il server: ' + e.message);
    }
  });
}

$('btn-signin').onclick = async () => {
  $('login-error').hidden = true;
  try { await backend.signIn(); } catch (e) {
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
    $('login-error').hidden = false;
    $('login-error').textContent = 'Accesso non riuscito: ' + (e.message || e);
  }
};

function showPass(mode, error) {
  passMode = mode;
  show('pass');
  const isNew = mode === 'new';
  $('pass-title').textContent = isNew ? 'Scegli una passphrase' : 'Sblocca le note';
  $('pass-desc').textContent = isNew
    ? `Accesso come ${user.email}. Le note vengono cifrate con questa passphrase prima di lasciare il dispositivo: sul server nessuno le può leggere.`
    : `Accesso come ${user.email}. Inserisci la passphrase scelta per reKeep.`;
  $('pass-warn').hidden = !isNew;
  $('pass2-wrap').hidden = !isNew;
  $('pass1').value = ''; $('pass2').value = '';
  $('pass1').autocomplete = isNew ? 'new-password' : 'current-password';
  $('pass-submit').textContent = isNew ? 'Crea passphrase' : 'Sblocca';
  $('pass-submit').disabled = false;
  $('pass-remember').parentElement.hidden = backend.demo;
  setPassError(error);
  setTimeout(() => $('pass1').focus(), 50);
}

function setPassError(msg) {
  $('pass-error').hidden = !msg;
  $('pass-error').textContent = msg || '';
}

$('pass-form').onsubmit = async (e) => {
  e.preventDefault();
  const p1 = $('pass1').value;
  if (passMode === 'new') {
    if (p1.length < MIN_PASS) return setPassError(`Usa almeno ${MIN_PASS} caratteri.`);
    if (p1 !== $('pass2').value) return setPassError('Le due passphrase non coincidono.');
  }
  setPassError();
  const btn = $('pass-submit');
  btn.disabled = true;
  btn.textContent = 'Attendi…';
  try {
    const key = passMode === 'new' ? await store.createPassphrase(p1) : await store.checkPassphrase(p1);
    if (!key) { setPassError('Passphrase errata.'); return; }
    if ($('pass-remember').checked && !backend.demo) await saveKey(user.uid, key);
    startApp(key);
  } catch (err) {
    setPassError('Operazione non riuscita: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = passMode === 'new' ? 'Crea passphrase' : 'Sblocca';
  }
};

$('pass-signout').onclick = () => backend.signOut();

function startApp(key) {
  store.start(key);
  show('app');
  renderAccount();
  render();
}

// ---------- Account ----------

function renderAccount() {
  const initial = (user.name || user.email || '?').trim()[0].toUpperCase();
  for (const el of [$('btn-account'), $('account-avatar')]) {
    el.textContent = user.photo ? '' : initial;
    el.style.backgroundImage = user.photo ? `url("${user.photo}")` : '';
  }
  $('account-name').textContent = user.name || 'reKeep';
  $('account-email').textContent = user.email || '';
}

$('btn-account').onclick = (e) => {
  e.stopPropagation();
  $('account-menu').hidden = !$('account-menu').hidden;
};
document.addEventListener('click', (e) => {
  if (!$('account-menu').hidden && !$('account-menu').contains(e.target)) $('account-menu').hidden = true;
});
$('btn-lock').onclick = async () => {
  $('account-menu').hidden = true;
  await forgetKey(user.uid);
  store.stop();
  showPass('enter');
};
$('btn-signout').onclick = async () => {
  $('account-menu').hidden = true;
  await forgetKey(user.uid);
  store.stop();
  await backend.signOut();
};

// ---------- Barra e menu ----------

const isPhone = () => innerWidth <= 760;

$('btn-menu').onclick = () => {
  if (isPhone()) { $('sidebar').classList.add('open'); $('scrim').classList.add('open'); }
  else { ui.collapsed = !ui.collapsed; $('sidebar').classList.toggle('collapsed', ui.collapsed); render(); }
};
$('scrim').onclick = closeDrawer;
function closeDrawer() { $('sidebar').classList.remove('open'); $('scrim').classList.remove('open'); }

$('search').addEventListener('input', (e) => {
  ui.query = e.target.value;
  $('search-clear').hidden = !ui.query;
  if (ui.query && ui.section === 'trash') ui.section = 'notes';
  render();
});
$('search-clear').onclick = () => { $('search').value = ''; ui.query = ''; $('search-clear').hidden = true; render(); };

$('btn-view').onclick = () => {
  ui.list = !ui.list;
  try { localStorage.setItem('rekeep.view', ui.list ? 'list' : 'grid'); } catch (e) { /* niente */ }
  render();
};

$('composer-new').onclick = () => openNew(false);
$('composer-list').onclick = () => openNew(true);

$('btn-empty-trash').onclick = async () => {
  const ids = store.all().filter(M.inTrash).map((n) => n.id);
  if (await confirmDialog('Svuotare il cestino?', 'Tutte le note nel cestino verranno eliminate definitivamente.')) store.remove(ids);
};

addEventListener('resize', () => scheduleRender());

// ---------- Elenco note ----------

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

function allLabels() {
  const set = new Set(store.settings.labels);
  for (const n of store.all()) if (!M.inTrash(n)) n.labels.forEach((l) => set.add(l));
  return [...set].sort((a, b) => a.localeCompare(b, 'it'));
}

function visibleNotes() {
  const q = ui.query.trim();
  const all = store.all();
  let list;
  if (q) list = all.filter((n) => !M.inTrash(n) && M.matches(n, q));
  else if (ui.section === 'notes') list = all.filter((n) => !M.inTrash(n) && !n.archived);
  else if (ui.section === 'reminders') list = all.filter((n) => M.activeReminder(n));
  else if (ui.section === 'archive') list = all.filter((n) => !M.inTrash(n) && n.archived);
  else if (ui.section === 'trash') list = all.filter(M.inTrash);
  else list = all.filter((n) => !M.inTrash(n) && !n.archived && n.labels.includes(ui.label));
  list.sort((a, b) => b.updatedAt - a.updatedAt);
  if (ui.section === 'reminders' && !q) {
    list.sort((a, b) => (a.reminder.type === 'time' ? a.reminder.at : Infinity) - (b.reminder.type === 'time' ? b.reminder.at : Infinity));
  }
  return list;
}

function render() {
  if (!store || $('screen-app').hidden) return;
  renderSidebar();
  renderSync();
  $('btn-view').innerHTML = `<span class="ms">${ui.list ? 'grid_view' : 'view_agenda'}</span>`;
  $('btn-view').title = ui.list ? 'Vista griglia' : 'Vista elenco';

  const searching = !!ui.query.trim();
  const notes = visibleNotes();
  $('composer').hidden = searching || !['notes', 'label'].includes(ui.section);
  $('trash-info').hidden = ui.section !== 'trash' || !notes.length || searching;

  const usePinned = !searching && ['notes', 'label'].includes(ui.section);
  const pinned = usePinned ? notes.filter((n) => n.pinned) : [];
  const others = usePinned ? notes.filter((n) => !n.pinned) : notes;

  const box = $('sections');
  box.innerHTML = '';
  if (pinned.length) {
    box.append(sectionTitle('Fissate'));
    box.append(grid(pinned));
    if (others.length) box.append(sectionTitle('Altre'));
  }
  if (others.length) box.append(grid(others));

  const empty = !notes.length && store.ready;
  $('empty').hidden = !empty;
  if (empty) {
    const [icon, text] = searching ? ['search_off', 'Nessuna nota trovata']
      : ui.section === 'notes' ? ['lightbulb', 'Le note che aggiungi appaiono qui']
      : ui.section === 'reminders' ? ['notifications', 'Le note con promemoria appaiono qui']
      : ui.section === 'archive' ? ['archive', 'Le note archiviate appaiono qui']
      : ui.section === 'trash' ? ['delete', 'Nessuna nota nel cestino']
      : ['label', 'Nessuna nota con questa etichetta'];
    $('empty-icon').textContent = icon;
    $('empty-text').textContent = text;
  }
  if (!store.ready && !notes.length) box.innerHTML = '<div class="center" style="padding:60px"><div class="spinner"></div></div>';
}

function sectionTitle(t) {
  const el = document.createElement('div');
  el.className = 'section-title';
  el.textContent = t;
  return el;
}

function grid(notes) {
  const g = document.createElement('div');
  g.className = 'grid' + (ui.list ? ' list' : '');
  const width = $('main').clientWidth - (isPhone() ? 24 : 48);
  const cols = ui.list ? 1 : Math.max(isPhone() ? 2 : 1, Math.min(6, Math.floor((width + 14) / (240 + 14))));
  const columns = Array.from({ length: cols }, () => {
    const c = document.createElement('div');
    c.className = 'col';
    g.append(c);
    return c;
  });
  const heights = new Array(cols).fill(0);
  for (const n of notes) {
    const el = card(n);
    let i = 0;
    for (let k = 1; k < cols; k++) if (heights[k] < heights[i]) i = k;
    columns[i].append(el);
    heights[i] += estimateHeight(n);
  }
  return g;
}

function estimateHeight(n) {
  let h = 40;
  if (n.title) h += 24 * Math.min(2, Math.ceil(n.title.length / 26));
  if (n.checklist) h += 24 * Math.min(9, n.items.filter((i) => !i.c && i.t.trim()).length) + (n.items.some((i) => i.c) ? 22 : 0);
  else if (n.text) h += 21 * Math.min(12, n.text.split('\n').reduce((s, l) => s + Math.max(1, Math.ceil(l.length / 30)), 0));
  if (n.reminder || n.labels.length) h += 34;
  const imgs = n.images ?? [];
  if (imgs.length === 1) h += 240 / Math.min(2.2, Math.max(0.6, (imgs[0].w || 4) / (imgs[0].h || 3)));
  else if (imgs.length) h += 85;
  return h;
}

function reminderIcon(r) {
  if (r.type === 'place') return 'location_on';
  return M.isRepeating(r) ? 'repeat' : 'schedule';
}

function chip(icon, text, { done = false, onRemove = null, onClick = null } = {}) {
  const el = document.createElement(onClick ? 'button' : 'span');
  el.className = 'chip' + (done ? ' done' : '');
  if (icon) el.insertAdjacentHTML('beforeend', `<span class="ms">${icon}</span>`);
  const t = document.createElement('span');
  t.className = 't';
  t.textContent = text;
  el.append(t);
  if (onClick) el.onclick = (e) => { e.stopPropagation(); onClick(); };
  if (onRemove) {
    const x = document.createElement('span');
    x.className = 'ms x';
    x.textContent = 'close';
    x.title = 'Rimuovi';
    x.onclick = (e) => { e.stopPropagation(); onRemove(); };
    el.append(x);
  }
  return el;
}

/** Colore o sfondo a tema della nota (lo sfondo prevale sul colore). */
function applyCardColor(el, n) {
  const bg = bgById(n.bg);
  const c = bg ? (isDark() ? bg.dark : bg.light) : M.noteColor(n.color, isDark());
  el.style.setProperty('--card', c ?? 'var(--surface)');
  el.classList.toggle('colored', !!c);
  el.classList.toggle('themed', !!bg);
  let art = [...el.children].find((ch) => ch.classList?.contains('bgart'));
  if (!bg) { art?.remove(); return; }
  if (!art || art.dataset.bg !== bg.id) {
    art?.remove();
    art = document.createElement('div');
    art.className = 'bgart';
    art.dataset.bg = bg.id;
    art.innerHTML = `<svg viewBox="0 0 200 200" aria-hidden="true">${bg.svg}</svg>`;
    el.prepend(art);
  }
}

/** Schede delle anteprime dei link. */
function linkCards(n, { compact = false, onHide = null } = {}) {
  const links = M.visibleLinks(n);
  if (!links.length) return null;
  const box = document.createElement('div');
  box.className = compact ? 'links compact' : 'links';
  for (const l of links.slice(0, compact ? 2 : 5)) {
    const a = document.createElement('a');
    a.className = 'link';
    a.href = l.u;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.onclick = (e) => e.stopPropagation();
    const th = document.createElement('div');
    th.className = 'lthumb';
    th.innerHTML = '<span class="ms">link</span>';
    if (l.i) {
      const img = document.createElement('img');
      img.referrerPolicy = 'no-referrer';
      img.alt = '';
      img.onload = () => th.querySelector('.ms')?.remove();
      img.onerror = () => img.remove();
      img.src = l.i;
      th.append(img);
    }
    const tx = document.createElement('div');
    tx.className = 'ltext';
    const t = document.createElement('b');
    t.textContent = l.t || l.u.replace(/^https?:\/\/(www\.)?/, '');
    const s = document.createElement('span');
    s.textContent = l.s || M.hostOf(l.u);
    tx.append(t, s);
    a.append(th, tx);
    if (onHide) {
      const x = document.createElement('button');
      x.className = 'icon-btn small lhide';
      x.title = 'Rimuovi anteprima';
      x.innerHTML = '<span class="ms">link_off</span>';
      x.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onHide(l); };
      a.append(x);
    }
    box.append(a);
  }
  return box;
}

// ---------- Immagini ----------

/** Griglia di immagini (una a tutta larghezza, altrimenti 2-3 per riga). */
function imageGrid(images, { max = 30, onClick = null, onRemove = null } = {}) {
  const shown = images.slice(0, max);
  const g = document.createElement('div');
  const n = shown.length;
  g.className = 'imgs ' + (n === 1 ? 'n1' : n === 2 ? 'n2' : n === 3 ? 'n3' : n === 4 ? 'n4' : 'nmany');
  shown.forEach((img, i) => {
    const box = document.createElement('div');
    box.className = 'im';
    if (n === 1 && img.w && img.h) box.style.setProperty('--ar', Math.min(2.2, Math.max(0.6, img.w / img.h)));
    const wait = document.createElement('div');
    wait.className = 'wait';
    wait.innerHTML = '<span class="ms">image</span>';
    const el = document.createElement('img');
    el.alt = '';
    el.loading = 'lazy';
    box.append(wait, el);
    store.imageUrl(img).then((url) => { el.src = url; el.onload = () => { el.classList.add('ok'); wait.remove(); }; })
      .catch(() => { wait.innerHTML = '<span class="ms" title="Immagine non ancora disponibile">cloud_download</span>'; });
    if (onClick) box.onclick = (e) => { e.stopPropagation(); onClick(i); };
    if (onRemove) {
      const x = document.createElement('button');
      x.className = 'x'; x.title = 'Elimina immagine';
      x.innerHTML = '<span class="ms">close</span>';
      x.onclick = (e) => { e.stopPropagation(); onRemove(img); };
      box.append(x);
    }
    if (i === n - 1 && images.length > n) box.insertAdjacentHTML('beforeend', `<span class="more-n">+${images.length - n}</span>`);
    g.append(box);
  });
  return g;
}

/** Riduce la foto a 1600 px sul lato lungo (con la rotazione corretta) e la converte in JPEG. */
async function prepareImage(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h };
}

let uploading = 0;
async function addImages(files) {
  const id = ed.id;
  uploading += files.length;
  refreshEditorChrome();
  let failed = 0;
  for (const f of files) {
    try {
      const { bytes, w, h } = await prepareImage(f);
      const img = await store.uploadImage(bytes, w, h);
      if (ed.id === id) edit((x) => ({ ...x, images: [...(x.images ?? []), img] }));
      else store.update(id, (x) => ({ ...x, images: [...(x.images ?? []), img] }));
    } catch (e) {
      console.warn(e);
      failed++;
    } finally {
      uploading--;
      if (ed.id === id) refreshEditorChrome();
    }
  }
  if (failed) toast(`Impossibile aggiungere ${failed === 1 ? "un'immagine" : `${failed} immagini`}`);
}

$('ed-image').onclick = () => $('ed-file').click();
$('ed-file').onchange = (e) => {
  const files = [...e.target.files].filter((f) => f.type.startsWith('image/'));
  e.target.value = '';
  if (files.length) addImages(files);
};

const lb = { images: [], index: 0, onDelete: null };
function openLightbox(images, index, onDelete) {
  Object.assign(lb, { images, index, onDelete });
  if (!$('lightbox').open) $('lightbox').showModal();
  showLightbox();
}
function showLightbox() {
  const img = lb.images[lb.index];
  if (!img) { $('lightbox').close(); return; }
  $('lb-img').removeAttribute('src');
  store.imageUrl(img).then((url) => { if (lb.images[lb.index] === img) $('lb-img').src = url; }).catch(() => {});
  $('lb-count').textContent = lb.images.length > 1 ? `${lb.index + 1} / ${lb.images.length}` : '';
  $('lb-prev').hidden = $('lb-next').hidden = lb.images.length < 2;
  $('lb-delete').hidden = !lb.onDelete;
}
$('lb-close').onclick = () => $('lightbox').close();
$('lb-prev').onclick = () => { lb.index = (lb.index - 1 + lb.images.length) % lb.images.length; showLightbox(); };
$('lb-next').onclick = () => { lb.index = (lb.index + 1) % lb.images.length; showLightbox(); };
$('lb-delete').onclick = () => {
  const img = lb.images[lb.index];
  lb.onDelete?.(img);
  lb.images = lb.images.filter((x) => x !== img);
  lb.index = Math.min(lb.index, lb.images.length - 1);
  showLightbox();
};
$('lightbox').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') $('lb-prev').click();
  else if (e.key === 'ArrowRight') $('lb-next').click();
});

function removeImage(img) {
  edit((x) => ({ ...x, images: (x.images ?? []).filter((i) => i.id !== img.id) }));
  store.deleteImages([img]);
}

function card(n) {
  const el = document.createElement('article');
  el.className = 'card';
  applyCardColor(el, n);
  el.tabIndex = 0;
  el.onclick = () => openEditor(n.id);
  el.onkeydown = (e) => { if (e.key === 'Enter') openEditor(n.id); };

  const imgs = n.images ?? [];
  const hasText = n.title.trim() || n.text.trim() || n.items.some((i) => i.t.trim());
  if (imgs.length) {
    el.classList.add('has-imgs');
    if (!hasText && !n.reminder && !n.labels.length) el.classList.add('only-imgs');
    el.append(imageGrid(imgs, { max: 3 }));
  }

  if (n.title.trim()) {
    const h = document.createElement('h3');
    h.textContent = n.title;
    el.append(h);
  }
  if (n.checklist) {
    const open = n.items.filter((i) => !i.c && i.t.trim());
    const done = n.items.filter((i) => i.c && i.t.trim()).length;
    for (const i of open.slice(0, 8)) {
      const row = document.createElement('div');
      row.className = 'ci';
      row.innerHTML = '<span class="ms">check_box_outline_blank</span><span></span>';
      row.lastChild.textContent = i.t;
      el.append(row);
    }
    if (open.length > 8) el.insertAdjacentHTML('beforeend', '<div class="more">…</div>');
    if (done) el.insertAdjacentHTML('beforeend', `<div class="more">+ ${done === 1 ? '1 elemento spuntato' : `${done} elementi spuntati`}</div>`);
  } else if (n.text.trim()) {
    const p = document.createElement('div');
    p.className = 'text' + (n.title.trim() ? '' : ' only');
    p.textContent = n.text;
    el.append(p);
  }
  if (!hasText && !imgs.length) {
    el.classList.add('empty-note');
    el.insertAdjacentHTML('beforeend', '<div class="text">Nota vuota</div>');
  }
  if (n.reminder || n.labels.length) {
    const chips = document.createElement('div');
    chips.className = 'chips';
    if (n.reminder) chips.append(chip(reminderIcon(n.reminder), M.formatReminder(n.reminder), { done: n.reminder.done }));
    n.labels.forEach((l) => chips.append(chip(null, l)));
    el.append(chips);
  }
  const lc = linkCards(n, { compact: true });
  if (lc) el.append(lc);

  if (!M.inTrash(n)) {
    const pin = iconButton('keep', n.pinned ? 'Sblocca' : 'Fissa', () => {
      store.update(n.id, (x) => ({ ...x, pinned: !x.pinned, archived: false }), { edited: false });
    });
    pin.classList.add('pin');
    if (n.pinned) pin.classList.add('on');
    el.append(pin);
  }

  const acts = document.createElement('div');
  acts.className = 'acts';
  if (M.inTrash(n)) {
    acts.append(iconButton('restore_from_trash', 'Ripristina', () => store.update(n.id, (x) => ({ ...x, trashedAt: null }))));
    acts.append(iconButton('delete_forever', 'Elimina definitivamente', async () => {
      if (await confirmDialog('Eliminare la nota?', "L'operazione non si può annullare.")) store.remove([n.id]);
    }));
  } else {
    acts.append(iconButton('add_alert', 'Promemoria', () => openReminder(n.id)));
    acts.append(iconButton(n.archived ? 'unarchive' : 'archive', n.archived ? "Estrai dall'archivio" : 'Archivia', () => archive(n.id)));
    acts.append(iconButton('delete', 'Elimina', () => trash(n.id)));
  }
  el.append(acts);
  return el;
}

function iconButton(icon, title, onClick) {
  const b = document.createElement('button');
  b.className = 'icon-btn';
  b.title = title;
  b.innerHTML = `<span class="ms">${icon}</span>`;
  b.onclick = (e) => { e.stopPropagation(); onClick(); };
  return b;
}

function archive(id) {
  const before = structuredClone(store.get(id));
  const nowArchived = !before.archived;
  store.update(id, (x) => ({ ...x, archived: nowArchived, pinned: nowArchived ? false : x.pinned }), { edited: false });
  toast(nowArchived ? 'Nota archiviata' : "Nota estratta dall'archivio", () => store.put(before, { edited: false }));
}

function trash(id) {
  const before = structuredClone(store.get(id));
  store.update(id, (x) => ({ ...x, trashedAt: Date.now(), pinned: false }), { edited: false });
  toast('Nota spostata nel cestino', () => store.put(before, { edited: false }));
}

// ---------- Menu laterale ----------

function renderSidebar() {
  const nav = $('sidebar');
  nav.innerHTML = '';
  const item = (icon, label, on, onClick) => {
    const b = document.createElement('button');
    b.className = 'nav-item' + (on ? ' on' : '');
    b.innerHTML = `<span class="ms">${icon}</span><span class="nav-label"></span>`;
    b.querySelector('.nav-label').textContent = label;
    b.title = label;
    b.onclick = () => { onClick(); closeDrawer(); };
    nav.append(b);
  };
  const go = (section, label = null) => () => {
    ui.section = section; ui.label = label; ui.query = ''; $('search').value = ''; $('search-clear').hidden = true;
    render(); scrollTo(0, 0);
  };
  const q = !!ui.query.trim();
  item('lightbulb', 'Note', !q && ui.section === 'notes', go('notes'));
  item('notifications', 'Promemoria', !q && ui.section === 'reminders', go('reminders'));
  const labels = allLabels();
  if (labels.length) {
    nav.insertAdjacentHTML('beforeend', '<div class="nav-head">Etichette</div>');
    labels.forEach((l) => item('label', l, !q && ui.section === 'label' && ui.label === l, go('label', l)));
  }
  item('edit', labels.length ? 'Modifica etichette' : 'Crea etichetta', false, openEditLabels);
  item('archive', 'Archivio', !q && ui.section === 'archive', go('archive'));
  item('delete', 'Cestino', !q && ui.section === 'trash', go('trash'));
}

function renderSync() {
  const s = store.status;
  const el = $('sync-state');
  el.classList.toggle('busy', s.syncing || s.pending > 0);
  el.classList.toggle('err', !!s.error);
  let icon = 'cloud_done', title = 'Sincronizzato · cifrato end-to-end';
  if (s.error) { icon = 'cloud_off'; title = s.error; }
  else if (s.syncing || s.pending > 0) { icon = 'sync'; title = 'Sincronizzazione…'; }
  else if (s.lastSync) title += ` · ${M.hm(s.lastSync)}`;
  el.innerHTML = `<span class="ms">${icon}</span>`;
  el.title = title;
  $('account-sync').textContent = title;
}

// ---------- Editor ----------

const ed = { id: null, draft: null, showDone: true };
const cur = () => ed.draft ?? store.get(ed.id);

function openNew(checklist) {
  const n = M.newNote({ checklist, label: ui.section === 'label' ? ui.label : null });
  ed.id = n.id;
  ed.draft = n;
  openEditorDialog(true);
}

function openEditor(id) {
  ed.id = id;
  ed.draft = null;
  openEditorDialog(false);
}

/** Modifica la nota aperta. La bozza diventa una nota vera appena ha un contenuto. */
function edit(fn, { edited = true } = {}) {
  if (ed.draft) {
    ed.draft = fn(structuredClone(ed.draft));
    if (!M.isBlank(ed.draft)) { store.put(ed.draft, { edited }); ed.draft = null; }
  } else {
    store.update(ed.id, fn, { edited });
  }
  refreshEditorChrome();
}

function openEditorDialog(isNew) {
  const n = cur();
  if (!n) return;
  $('ed-title').value = n.title;
  $('ed-text').value = n.text;
  $('ed-palette').hidden = true;
  renderEditorBody();
  refreshEditorChrome();
  $('dlg-editor').showModal();
  autosize($('ed-text'));
  if (isNew) (n.checklist ? $('ed-list').querySelector('input[type=text]') : $('ed-text'))?.focus();
  else $('ed-title').blur();
}

function refreshEditorChrome() {
  const n = cur();
  if (!n) return;
  const dlg = $('dlg-editor');
  applyCardColor(dlg, n);
  const trashMode = M.inTrash(n);
  $('ed-tools').hidden = trashMode;
  $('ed-trash-tools').hidden = !trashMode;
  $('ed-title').readOnly = $('ed-text').readOnly = trashMode;
  $('ed-pin').hidden = trashMode;
  $('ed-pin').classList.toggle('on', n.pinned);
  $('ed-pin').title = n.pinned ? 'Sblocca' : 'Fissa';
  $('ed-archive').innerHTML = `<span class="ms">${n.archived ? 'unarchive' : 'archive'}</span>`;
  $('ed-archive').title = n.archived ? "Estrai dall'archivio" : 'Archivia';
  $('ed-toggle-list').innerHTML = `<span class="ms">${n.checklist ? 'notes' : 'check_box'}</span>`;
  $('ed-toggle-list').title = n.checklist ? 'Trasforma in testo' : 'Trasforma in elenco';
  $('ed-edited').textContent = uploading ? 'Caricamento immagini…' : ed.draft ? '' : M.formatEdited(n.updatedAt);

  const linksBox = $('ed-links');
  const lkey = JSON.stringify(M.visibleLinks(n)) + trashMode;
  if (linksBox.dataset.key !== lkey) {
    linksBox.dataset.key = lkey;
    linksBox.innerHTML = '';
    const lc = linkCards(n, {
      onHide: trashMode ? null : (l) => edit((x) => {
        const links = (x.links ?? []).filter((y) => y.u !== l.u);
        links.push({ u: l.u, t: l.t, s: l.s, i: l.i, x: true });
        return { ...x, links };
      }),
    });
    if (lc) linksBox.append(...lc.childNodes);
  }

  const imgBox = $('ed-images');
  const imgs = n.images ?? [];
  const key = imgs.map((i) => i.id).join(',') + (trashMode ? 't' : '');
  if (imgBox.dataset.key !== key) {
    imgBox.dataset.key = key;
    imgBox.innerHTML = '';
    if (imgs.length) {
      const g = imageGrid(imgs, {
        onClick: (i) => openLightbox(imgs, i, trashMode ? null : removeImage),
        onRemove: trashMode ? null : removeImage,
      });
      imgBox.className = g.className + ' editor-imgs';
      imgBox.append(...g.childNodes);
    }
  }
  imgBox.hidden = !imgs.length;

  const chips = $('ed-chips');
  chips.innerHTML = '';
  if (n.reminder) {
    chips.append(chip(reminderIcon(n.reminder), M.formatReminder(n.reminder), {
      done: n.reminder.done,
      onClick: trashMode ? null : () => openReminder(ed.id),
      onRemove: trashMode ? null : () => edit((x) => ({ ...x, reminder: null })),
    }));
  }
  n.labels.forEach((l) => chips.append(chip(null, l, {
    onRemove: trashMode ? null : () => edit((x) => ({ ...x, labels: x.labels.filter((y) => y !== l) })),
  })));
}

function renderEditorBody() {
  const n = cur();
  $('ed-text').hidden = n.checklist;
  $('ed-list').hidden = !n.checklist;
  if (n.checklist) renderChecklist();
}

function renderChecklist(focusId = null, caretEnd = true) {
  const n = cur();
  const box = $('ed-list');
  const ro = M.inTrash(n);
  box.innerHTML = '';
  const open = n.items.filter((i) => !i.c);
  const done = n.items.filter((i) => i.c);
  const row = (it) => {
    const r = document.createElement('div');
    r.className = 'row' + (it.c ? ' done' : '');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = it.c; cb.disabled = ro;
    cb.onchange = () => { edit((x) => ({ ...x, items: x.items.map((y) => (y.id === it.id ? { ...y, c: cb.checked } : y)) })); renderChecklist(); };
    const inp = document.createElement('input');
    inp.type = 'text'; inp.value = it.t; inp.readOnly = ro; inp.dataset.id = it.id;
    inp.placeholder = it.c ? '' : 'Elemento elenco';
    inp.oninput = () => edit((x) => ({ ...x, items: x.items.map((y) => (y.id === it.id ? { ...y, t: inp.value } : y)) }));
    inp.onkeydown = (e) => {
      if (ro) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        const before = inp.value.slice(0, inp.selectionStart);
        const after = inp.value.slice(inp.selectionEnd);
        const nid = M.uid();
        edit((x) => {
          const items = x.items.map((y) => (y.id === it.id ? { ...y, t: before } : y));
          const idx = items.findIndex((y) => y.id === it.id);
          items.splice(idx + 1, 0, { id: nid, t: after, c: it.c });
          return { ...x, items };
        });
        renderChecklist(nid, false);
      } else if (e.key === 'Backspace' && inp.selectionStart === 0 && inp.selectionEnd === 0) {
        const items = cur().items;
        const idx = items.findIndex((y) => y.id === it.id);
        const prev = items.slice(0, idx).reverse().find((y) => y.c === it.c);
        if (!prev && inp.value) return;
        e.preventDefault();
        edit((x) => ({
          ...x,
          items: x.items.filter((y) => y.id !== it.id).map((y) => (prev && y.id === prev.id ? { ...y, t: y.t + inp.value } : y)),
        }));
        renderChecklist(prev?.id ?? null, true);
      }
    };
    const del = iconButton('close', 'Elimina elemento', () => {
      edit((x) => ({ ...x, items: x.items.filter((y) => y.id !== it.id) }));
      renderChecklist();
    });
    del.classList.add('small');
    r.append(cb, inp);
    if (!ro) r.append(del);
    return r;
  };
  open.forEach((it) => box.append(row(it)));
  if (!ro) {
    const add = document.createElement('button');
    add.className = 'add';
    add.innerHTML = '<span class="ms">add</span><span>Elemento elenco</span>';
    add.onclick = () => {
      const nid = M.uid();
      edit((x) => {
        const items = [...x.items];
        const lastOpen = items.map((y) => y.c).lastIndexOf(false);
        items.splice(lastOpen + 1, 0, { id: nid, t: '', c: false });
        return { ...x, items };
      });
      renderChecklist(nid);
    };
    box.append(add);
  }
  if (done.length) {
    const head = document.createElement('button');
    head.className = 'done-head';
    head.innerHTML = `<span class="ms">${ed.showDone ? 'expand_less' : 'expand_more'}</span>${done.length === 1 ? '1 elemento spuntato' : `${done.length} elementi spuntati`}`;
    head.onclick = () => { ed.showDone = !ed.showDone; renderChecklist(); };
    box.append(head);
    if (ed.showDone) done.forEach((it) => box.append(row(it)));
  }
  if (focusId) {
    const inp = box.querySelector(`input[data-id="${focusId}"]`);
    if (inp) {
      inp.focus();
      const p = caretEnd ? inp.value.length : 0;
      inp.setSelectionRange(p, p);
    }
  }
}

function autosize(t) {
  t.style.height = 'auto';
  t.style.height = t.scrollHeight + 'px';
}

$('ed-title').oninput = (e) => edit((x) => ({ ...x, title: e.target.value }));
$('ed-text').oninput = (e) => { autosize(e.target); edit((x) => ({ ...x, text: e.target.value })); };
$('ed-pin').onclick = () => edit((x) => ({ ...x, pinned: !x.pinned, archived: false }), { edited: false });
$('ed-close').onclick = () => $('dlg-editor').close();
$('ed-reminder').onclick = () => openReminder(ed.id);
$('ed-labels').onclick = () => openNoteLabels();

$('ed-color').onclick = () => {
  const pal = $('ed-palette');
  pal.hidden = !pal.hidden;
  if (pal.hidden) return;
  renderPalette();
};

function renderPalette() {
  const pal = $('ed-palette');
  const n = cur();
  pal.innerHTML = '';
  const row1 = document.createElement('div');
  row1.className = 'pal-row';
  M.COLOR_NAMES.forEach((name, i) => {
    const s = document.createElement('button');
    s.className = 'swatch' + (!n.bg && n.color === i ? ' on' : '');
    s.title = name;
    s.style.background = M.noteColor(i, isDark()) ?? 'var(--surface)';
    if (i === 0) s.innerHTML = '<span class="ms">format_color_reset</span>';
    s.onclick = () => { edit((x) => ({ ...x, color: i, bg: '' }), { edited: false }); renderPalette(); };
    row1.append(s);
  });
  const row2 = document.createElement('div');
  row2.className = 'pal-row';
  const none = document.createElement('button');
  none.className = 'swatch bgsw' + (!n.bg ? ' on' : '');
  none.title = 'Nessuno sfondo';
  none.innerHTML = '<span class="ms">hide_image</span>';
  none.onclick = () => { edit((x) => ({ ...x, bg: '' }), { edited: false }); renderPalette(); };
  row2.append(none);
  for (const b of BACKGROUNDS) {
    const s = document.createElement('button');
    s.className = 'swatch bgsw' + (n.bg === b.id ? ' on' : '');
    s.title = b.name;
    s.style.background = isDark() ? b.dark : b.light;
    s.innerHTML = `<svg viewBox="0 0 200 200">${b.svg}</svg>`;
    s.onclick = () => { edit((x) => ({ ...x, bg: b.id }), { edited: false }); renderPalette(); };
    row2.append(s);
  }
  pal.append(Object.assign(document.createElement('div'), { className: 'pal-title', textContent: 'Colore' }), row1,
    Object.assign(document.createElement('div'), { className: 'pal-title', textContent: 'Sfondo' }), row2);
}

$('ed-toggle-list').onclick = () => {
  edit((x) => x.checklist
    ? { ...x, checklist: false, text: x.items.filter((i) => i.t.trim()).map((i) => i.t).join('\n'), items: [] }
    : {
        ...x, checklist: true, text: '',
        items: x.text.split('\n').filter((l) => l.trim()).map((l) => ({ id: M.uid(), t: l.trim(), c: false })),
      });
  const n = cur();
  if (n.checklist && !n.items.length) edit((x) => ({ ...x, items: [{ id: M.uid(), t: '', c: false }] }));
  $('ed-text').value = cur().text;
  renderEditorBody();
  autosize($('ed-text'));
};

$('ed-archive').onclick = () => {
  const n = cur();
  if (ed.draft) { $('dlg-editor').close(); return; }
  if (n.archived) { edit((x) => ({ ...x, archived: false })); return; }
  const id = ed.id;
  $('dlg-editor').close();
  archive(id);
};

$('ed-delete').onclick = () => {
  const id = ed.id;
  const draft = !!ed.draft;
  $('dlg-editor').close();
  if (draft || !store.get(id)) return;
  if (M.isBlank(store.get(id))) { store.remove([id]); return; }
  trash(id);
};

$('ed-copy').onclick = async () => {
  const n = cur();
  if (ed.draft) return;
  const now = Date.now();
  $('dlg-editor').close();
  let images = [];
  if (n.images?.length) {
    toast('Copia delle immagini…');
    images = (await Promise.all(n.images.map((i) => store.duplicateImage(i).catch(() => null)))).filter(Boolean);
  }
  const copy = { ...structuredClone(n), id: M.uid(), items: n.items.map((i) => ({ ...i, id: M.uid() })), images, reminder: null, pinned: false, createdAt: now };
  store.put(copy);
  openEditor(copy.id);
};

$('ed-restore').onclick = () => { edit((x) => ({ ...x, trashedAt: null })); renderEditorBody(); };
$('ed-destroy').onclick = async () => {
  const id = ed.id;
  if (await confirmDialog('Eliminare definitivamente?', 'La nota non si potrà recuperare.')) {
    $('dlg-editor').close();
    store.remove([id]);
  }
};

$('dlg-editor').addEventListener('close', () => {
  $('ed-images').dataset.key = '';
  $('ed-links').dataset.key = '';
  const n = store.get(ed.id);
  if (n && M.isBlank(n) && !M.inTrash(n)) store.remove([n.id]);
  ed.id = null;
  ed.draft = null;
  render();
});

// ---------- Promemoria ----------

const rem = { id: null, tab: 'time', trigger: 'ENTER' };

function toLocalInput(t) {
  const d = new Date(t);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function quickTimes() {
  const now = new Date();
  const at = (days, hour) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d.getTime(); };
  const list = [];
  const h = now.getHours();
  if (h < 17) list.push(['wb_twilight', 'Più tardi oggi', at(0, 18)]);
  else if (h < 19) list.push(['wb_twilight', 'Stasera', at(0, 20)]);
  list.push(['wb_sunny', 'Domani mattina', at(1, 8)]);
  const toMonday = ((1 - now.getDay() + 7) % 7) || 7;
  if (toMonday > 1) list.push(['date_range', 'Lunedì prossimo', at(toMonday, 8)]);
  return list;
}

function openReminder(id) {
  rem.id = id;
  const n = id === ed.id ? cur() : store.get(id);
  const r = n?.reminder;
  rem.tab = r?.type === 'place' ? 'place' : 'time';
  rem.trigger = r?.type === 'place' ? r.trigger : 'ENTER';
  const quick = $('rem-quick');
  quick.innerHTML = '';
  for (const [icon, label, at] of quickTimes()) {
    const b = document.createElement('button');
    b.innerHTML = `<span class="ms">${icon}</span><span>${label}</span><span class="when">${M.formatTime(at)}</span>`;
    b.onclick = () => { applyReminder({ type: 'time', at, repeat: 'NONE', done: false }); $('dlg-reminder').close(); };
    quick.append(b);
  }
  const def = new Date(); def.setHours(def.getHours() + 1, 0, 0, 0);
  $('rem-at').value = toLocalInput(r?.type === 'time' ? r.at : def.getTime());
  $('rem-repeat').value = r?.type === 'time' ? r.repeat ?? 'NONE' : 'NONE';
  $('rem-past').hidden = true;
  $('rem-remove').hidden = !r;
  renderReminderTabs();
  $('dlg-reminder').showModal();
}

/** Imposta il promemoria sulla nota giusta (quella aperta nell'editor o una della griglia). */
function applyReminder(r) {
  if (r?.type === 'time' && r.repeat !== 'NONE') r.at = M.nextOccurrence(r.at, r.repeat);
  if (rem.id === ed.id) edit((x) => ({ ...x, reminder: r }));
  else store.update(rem.id, (x) => ({ ...x, reminder: r }));
  render();
}

function renderReminderTabs() {
  document.querySelectorAll('#dlg-reminder [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === rem.tab));
  $('rem-time').hidden = rem.tab !== 'time';
  $('rem-place').hidden = rem.tab !== 'place';
  document.querySelectorAll('#rem-place [data-trigger]').forEach((b) => b.classList.toggle('on', b.dataset.trigger === rem.trigger));

  const n = rem.id === ed.id ? cur() : store.get(rem.id);
  const r = n?.reminder;
  const curBox = $('rem-current');
  curBox.hidden = r?.type !== 'place';
  if (r?.type === 'place') {
    curBox.innerHTML = '<span class="ms accent">location_on</span><span style="flex:1"><b></b><br><span class="muted tiny"></span></span>';
    curBox.querySelector('b').textContent = M.placeLabel(r);
    curBox.querySelector('.tiny').textContent =
      `${r.trigger === 'EXIT' ? 'Quando esco' : 'Quando arrivo'} · ${M.formatRadius(r.radius)} · ${r.repeat ? 'ogni volta' : 'una volta'}`;
    const b = document.createElement('button');
    b.className = 'btn text'; b.textContent = 'Modifica';
    b.onclick = () => pickOnMap(r);
    curBox.append(b);
  }
  const box = $('rem-places');
  box.innerHTML = '';
  const places = store.settings.places;
  if (places.length) box.insertAdjacentHTML('beforeend', '<div class="nav-head" style="padding:8px 12px">Luoghi salvati</div>');
  for (const p of places) {
    const b = document.createElement('div');
    b.className = 'list-item place-item';
    b.role = 'button';
    const icon = /casa/i.test(p.name) ? 'home' : /lavoro|ufficio/i.test(p.name) ? 'work' : 'location_on';
    b.innerHTML = `<span class="ms">${icon}</span><span><b></b><br><span class="muted tiny"></span></span>`;
    b.querySelector('b').textContent = p.name;
    b.querySelector('.tiny').textContent = p.address || M.coords(p.lat, p.lon);
    b.onclick = () => {
      applyReminder({ type: 'place', lat: p.lat, lon: p.lon, radius: p.radius, place: p.name, trigger: rem.trigger, repeat: false, done: false });
      $('dlg-reminder').close();
    };
    const x = iconButton('close', 'Rimuovi dai luoghi salvati', () => {
      store.setSettings((s) => { s.places = s.places.filter((q) => q.id !== p.id); });
      renderReminderTabs();
    });
    x.classList.add('x');
    b.append(x);
    box.append(b);
  }
}

document.querySelectorAll('#dlg-reminder [data-tab]').forEach((b) => { b.onclick = () => { rem.tab = b.dataset.tab; renderReminderTabs(); }; });
document.querySelectorAll('#rem-place [data-trigger]').forEach((b) => { b.onclick = () => { rem.trigger = b.dataset.trigger; renderReminderTabs(); }; });

$('rem-set').onclick = () => {
  const at = new Date($('rem-at').value).getTime();
  const repeat = $('rem-repeat').value;
  if (Number.isNaN(at)) return;
  if (repeat === 'NONE' && at <= Date.now()) { $('rem-past').hidden = false; return; }
  applyReminder({ type: 'time', at, repeat, done: false });
  $('dlg-reminder').close();
};
$('rem-remove').onclick = () => { applyReminder(null); $('dlg-reminder').close(); };
$('rem-map').onclick = () => pickOnMap(null);

async function pickOnMap(initial) {
  $('dlg-reminder').close();
  const res = await openMapPicker({ initial, trigger: rem.trigger, dark: isDark() });
  if (!res) return;
  if (res.saveName) {
    store.setSettings((s) => {
      s.places = s.places.filter((p) => p.name.toLowerCase() !== res.saveName.toLowerCase());
      s.places.push({ id: M.uid(), name: res.saveName, lat: res.lat, lon: res.lon, address: res.address || '', radius: res.radius });
    });
  }
  applyReminder({ type: 'place', lat: res.lat, lon: res.lon, radius: res.radius, place: res.place, trigger: res.trigger, repeat: res.repeat, done: false });
}

// ---------- Etichette ----------

function addLabel(name) {
  name = name.trim();
  if (!name) return null;
  const existing = allLabels().find((l) => l.toLowerCase() === name.toLowerCase());
  if (existing) {
    if (!store.settings.labels.includes(existing)) store.setSettings((s) => { s.labels.push(existing); });
    return existing;
  }
  store.setSettings((s) => { s.labels.push(name); s.labels.sort((a, b) => a.localeCompare(b, 'it')); });
  return name;
}

function openNoteLabels() {
  $('lab-new').value = '';
  renderNoteLabels();
  $('dlg-labels').showModal();
}

function renderNoteLabels() {
  const n = cur();
  const box = $('lab-list');
  box.innerHTML = '';
  const labels = allLabels();
  if (!labels.length) box.innerHTML = '<p class="muted">Non hai ancora etichette.</p>';
  for (const l of labels) {
    const row = document.createElement('label');
    row.className = 'check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = n.labels.includes(l);
    cb.onchange = () => edit((x) => ({ ...x, labels: cb.checked ? [...x.labels, l] : x.labels.filter((y) => y !== l) }));
    row.append(cb, document.createTextNode(l));
    box.append(row);
  }
}

const addNoteLabel = () => {
  const name = addLabel($('lab-new').value);
  if (!name) return;
  if (!cur().labels.includes(name)) edit((x) => ({ ...x, labels: [...x.labels, name] }));
  $('lab-new').value = '';
  renderNoteLabels();
};
$('lab-add').onclick = addNoteLabel;
$('lab-new').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addNoteLabel(); } };

function openEditLabels() {
  $('el-new').value = '';
  renderEditLabels();
  $('dlg-edit-labels').showModal();
}

function renderEditLabels() {
  const box = $('el-list');
  box.innerHTML = '';
  for (const l of allLabels()) {
    const row = document.createElement('div');
    row.className = 'el-row';
    row.innerHTML = '<span class="ms muted">label</span>';
    const inp = document.createElement('input');
    inp.value = l;
    inp.onchange = () => { renameLabel(l, inp.value); renderEditLabels(); };
    inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); };
    row.append(inp, iconButton('delete', 'Elimina etichetta', () => { deleteLabel(l); renderEditLabels(); }));
    box.append(row);
  }
}

function renameLabel(old, name) {
  name = name.trim();
  if (!name || name === old) return;
  if (allLabels().some((l) => l !== old && l.toLowerCase() === name.toLowerCase())) return;
  store.setSettings((s) => { s.labels = [...new Set(s.labels.filter((l) => l !== old).concat(name))].sort((a, b) => a.localeCompare(b, 'it')); });
  for (const n of store.all()) {
    if (n.labels.includes(old)) store.update(n.id, (x) => ({ ...x, labels: [...new Set(x.labels.map((y) => (y === old ? name : y)))] }), { edited: false });
  }
  if (ui.section === 'label' && ui.label === old) ui.label = name;
  render();
}

function deleteLabel(l) {
  store.setSettings((s) => { s.labels = s.labels.filter((x) => x !== l); });
  for (const n of store.all()) {
    if (n.labels.includes(l)) store.update(n.id, (x) => ({ ...x, labels: x.labels.filter((y) => y !== l) }), { edited: false });
  }
  if (ui.section === 'label' && ui.label === l) ui.section = 'notes';
  render();
}

const addEditLabel = () => { addLabel($('el-new').value); $('el-new').value = ''; renderEditLabels(); render(); };
$('el-add').onclick = addEditLabel;
$('el-new').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addEditLabel(); } };

// ---------- Dialoghi comuni ----------

document.querySelectorAll('dialog [data-close]').forEach((b) => { b.onclick = () => b.closest('dialog').close(); });
// clic sullo sfondo: chiude
document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
$('dlg-labels').addEventListener('close', () => refreshEditorChrome());

function confirmDialog(title, text) {
  return new Promise((resolve) => {
    const d = $('dlg-confirm');
    $('cf-title').textContent = title;
    $('cf-text').textContent = text;
    let ok = false;
    $('cf-ok').onclick = () => { ok = true; d.close(); };
    d.addEventListener('close', () => resolve(ok), { once: true });
    d.showModal();
  });
}

let toastTimer = null;
function toast(text, undo) {
  const t = $('toast');
  $('toast-text').textContent = text;
  $('toast-action').hidden = !undo;
  $('toast-action').onclick = () => { t.hidden = true; undo?.(); };
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
}

darkMq.addEventListener('change', () => render());

main();
