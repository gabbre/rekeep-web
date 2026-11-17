// Modello note, identico all'app Android (stessi campi JSON).

export const uid = () => crypto.randomUUID();

export function newNote({ checklist = false, label = null } = {}) {
  const now = Date.now();
  return {
    id: uid(),
    title: '',
    text: '',
    checklist,
    items: checklist ? [{ id: uid(), t: '', c: false }] : [],
    color: 0,
    pinned: false,
    archived: false,
    trashedAt: null,
    labels: label ? [label] : [],
    reminder: null,
    images: [],
    createdAt: now,
    updatedAt: now,
    changedAt: now,
  };
}

/** Normalizza una nota letta dal JSON (campi mancanti → valori predefiniti). */
export function fromJson(o) {
  const updatedAt = Number(o.updatedAt ?? Date.now());
  return {
    id: String(o.id),
    title: o.title ?? '',
    text: o.text ?? '',
    checklist: !!o.checklist,
    items: (o.items ?? []).map((i) => ({ id: i.id ?? uid(), t: i.t ?? '', c: !!i.c })),
    color: Number(o.color ?? 0),
    pinned: !!o.pinned,
    archived: !!o.archived,
    trashedAt: o.trashedAt == null ? null : Number(o.trashedAt),
    labels: [...(o.labels ?? [])],
    reminder: o.reminder ?? null,
    images: (o.images ?? []).map((i) => ({ id: String(i.id), w: Number(i.w ?? 0), h: Number(i.h ?? 0), p: Number(i.p ?? 1) })),
    createdAt: Number(o.createdAt ?? updatedAt),
    updatedAt,
    changedAt: Number(o.changedAt ?? updatedAt),
  };
}

export function toJson(n) {
  const o = {
    id: n.id,
    title: n.title,
    text: n.text,
    checklist: n.checklist,
    items: n.items.map((i) => ({ id: i.id, t: i.t, c: i.c })),
    color: n.color,
    pinned: n.pinned,
    archived: n.archived,
    labels: n.labels,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    changedAt: n.changedAt,
  };
  if (n.trashedAt != null) o.trashedAt = n.trashedAt;
  if (n.reminder) o.reminder = n.reminder;
  if (n.images?.length) o.images = n.images.map((i) => ({ id: i.id, w: i.w, h: i.h, p: i.p }));
  return o;
}

export const inTrash = (n) => n.trashedAt != null;
export const isBlank = (n) =>
  !n.title.trim() && !n.text.trim() && n.items.every((i) => !i.t.trim()) && !n.reminder && !n.images?.length;
export const activeReminder = (n) => (n.reminder && !n.reminder.done && !inTrash(n) ? n.reminder : null);
export const isRepeating = (r) => (r.type === 'time' ? r.repeat && r.repeat !== 'NONE' : !!r.repeat);

export function matches(n, q) {
  q = q.toLowerCase();
  return (
    n.title.toLowerCase().includes(q) ||
    n.text.toLowerCase().includes(q) ||
    n.items.some((i) => i.t.toLowerCase().includes(q)) ||
    n.labels.some((l) => l.toLowerCase().includes(q)) ||
    (n.reminder?.type === 'place' && (n.reminder.place ?? '').toLowerCase().includes(q))
  );
}

export function plainText(n) {
  return n.checklist
    ? n.items.filter((i) => i.t.trim()).map((i) => (i.c ? '☑ ' : '☐ ') + i.t).join('\n')
    : n.text;
}

/** Prossima ricorrenza dopo adesso (come l'app). */
export function nextOccurrence(at, repeat) {
  if (!repeat || repeat === 'NONE') return at;
  const d = new Date(at);
  const now = Date.now();
  let guard = 0;
  while (d.getTime() <= now && guard++ < 100000) {
    if (repeat === 'DAILY') d.setDate(d.getDate() + 1);
    else if (repeat === 'WEEKLY') d.setDate(d.getDate() + 7);
    else if (repeat === 'MONTHLY') d.setMonth(d.getMonth() + 1);
    else if (repeat === 'YEARLY') d.setFullYear(d.getFullYear() + 1);
    else break;
  }
  return d.getTime();
}

// ---------- Colori (stessi dell'app) ----------

export const COLOR_NAMES = ['Predefinito', 'Corallo', 'Pesca', 'Sabbia', 'Menta', 'Salvia', 'Nebbia', 'Tempesta', 'Crepuscolo', 'Fiore', 'Argilla', 'Gesso'];
const LIGHT = [null, '#FAAFA8', '#F39F76', '#FFF8B8', '#E2F6D3', '#B4DDD3', '#D4E4ED', '#AECCDC', '#D3BFDB', '#F6E2DD', '#E9E3D4', '#EFEFF1'];
const DARK = [null, '#77172E', '#692B17', '#7C4A03', '#264D3B', '#0C625D', '#256377', '#284255', '#472E5B', '#6C394F', '#4B443A', '#232427'];

export function noteColor(i, dark) {
  return (dark ? DARK : LIGHT)[i] ?? null;
}

// ---------- Formati ----------

const fmt = (opts) => new Intl.DateTimeFormat('it-IT', opts);
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const daysFromToday = (t) => Math.round((startOfDay(t) - startOfDay(Date.now())) / 86400000);
export const hm = (t) => fmt({ hour: '2-digit', minute: '2-digit' }).format(t);

export function formatTime(t) {
  const days = daysFromToday(t);
  if (days === 0) return `Oggi, ${hm(t)}`;
  if (days === 1) return `Domani, ${hm(t)}`;
  if (days === -1) return `Ieri, ${hm(t)}`;
  const sameYear = new Date(t).getFullYear() === new Date().getFullYear();
  return sameYear
    ? fmt({ weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(t)
    : fmt({ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(t);
}

export const REPEAT_LABELS = { NONE: 'Una volta', DAILY: 'Ogni giorno', WEEKLY: 'Ogni settimana', MONTHLY: 'Ogni mese', YEARLY: 'Ogni anno' };

export const formatRadius = (r) => (r < 1000 ? `${r} m` : `${(r / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 })} km`);
export const coords = (lat, lon) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

export function placeLabel(r) {
  return r.place?.trim() ? r.place : coords(r.lat, r.lon);
}

export function formatReminder(r) {
  if (r.type === 'time') return formatTime(r.at);
  return (r.trigger === 'EXIT' ? 'Uscita · ' : '') + placeLabel(r);
}

export function formatEdited(t) {
  return daysFromToday(t) === 0 ? `Modificata alle ${hm(t)}` : `Modificata il ${fmt({ day: 'numeric', month: 'short' }).format(t)}`;
}
