export const MONTHS_SHORT = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
export const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const WEEKDAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const WEEKDAYS_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

export const EVENT_TYPES = [
  { id: 'aula-pratica', label: 'Aula prática', icon: 'book-open', tone: 'wine' },
  { id: 'extensao', label: 'Projeto de extensão', icon: 'users', tone: 'green' },
  { id: 'visita', label: 'Visita programada', icon: 'map-pin', tone: 'blue' },
  { id: 'oficina', label: 'Oficina / seminário', icon: 'sparkles', tone: 'amber' },
  { id: 'outro', label: 'Outra atividade', icon: 'clipboard', tone: 'outline' }
];

export const CLASS_STRUCTURES = [
  { id: 'pratica', label: 'Práticas' },
  { id: 'teorica', label: 'Teóricas' },
  { id: 'teorico-pratica', label: 'Teórico-práticas' }
];

export function structureLabel(id) {
  return CLASS_STRUCTURES.find(item => item.id === id)?.label || 'Práticas';
}

export function parseStudents(value = '') {
  return [...new Set(String(value)
    .split(/[\n;,]/)
    .map(name => name.trim())
    .filter(Boolean))];
}

export const DOC_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods'];
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'webp', 'svg', 'bmp'];
export const MAX_FILE_SIZE = 30 * 1024 * 1024;

export function $(selector, root = document) { return root.querySelector(selector); }
export function $$(selector, root = document) { return Array.from(root.querySelectorAll(selector)); }

export function uid(prefix = 'id') {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}

export function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function escapeAttr(value = '') { return escapeHtml(value); }

export function parseISODate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12, 0, 0);
}

export function toISODate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayISO() { return toISODate(new Date()); }

export function formatDate(iso, style = 'long') {
  const d = parseISODate(iso);
  if (!d) return '—';
  if (style === 'short') return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  if (style === 'numeric') return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  if (style === 'long') return `${d.getDate()} de ${MONTHS_LONG[d.getMonth()]} de ${d.getFullYear()}`;
  if (style === 'full') return `${WEEKDAYS_LONG[d.getDay()]}, ${d.getDate()} de ${MONTHS_LONG[d.getMonth()]} de ${d.getFullYear()}`;
  if (style === 'month') return `${MONTHS_LONG[d.getMonth()]} de ${d.getFullYear()}`;
  return d.toLocaleDateString('pt-BR');
}

export function monthShort(iso) {
  const d = parseISODate(iso);
  return d ? MONTHS_SHORT[d.getMonth()] : '—';
}

export function weekdayShort(iso) {
  const d = parseISODate(iso);
  return d ? WEEKDAYS_SHORT[d.getDay()] : '—';
}

export function dayNumber(iso) {
  const d = parseISODate(iso);
  return d ? String(d.getDate()).padStart(2, '0') : '—';
}

export function monthKey(iso) {
  return iso ? String(iso).slice(0, 7) : '';
}

export function currentMonthKey() {
  return todayISO().slice(0, 7);
}

export function monthLabelFromKey(key) {
  if (!key) return '';
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return '';
  return `${MONTHS_LONG[m - 1]} de ${y}`;
}

export function timeLabel(value) {
  if (!value) return '—';
  return String(value).slice(0, 5);
}

export function durationMinutes(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  return mins;
}

export function formatDuration(minutes, compact = false) {
  const total = Math.max(0, Math.round(minutes || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (compact) return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  if (!h) return `${m} min`;
  return m ? `${h}h ${m}min` : `${h}h`;
}

export function eventDuration(event) { return durationMinutes(event.start, event.end); }

export function formatBytes(bytes = 0) {
  if (!bytes) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** i);
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function firstName(name = '') {
  return String(name).trim().split(/\s+/)[0] || '';
}

export function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function extname(filename = '') {
  const index = filename.lastIndexOf('.');
  return index >= 0 ? filename.slice(index + 1).toLowerCase() : '';
}

export function fileCategory(filename = '', mime = '') {
  const ext = extname(filename);
  if (mime.startsWith('image/') || IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (DOC_EXTENSIONS.includes(ext) || mime.includes('pdf') || mime.includes('word') || mime.includes('sheet') || mime.includes('presentation')) return 'document';
  return 'other';
}

export function isTiff(filename = '', mime = '') {
  return ['tif', 'tiff'].includes(extname(filename)) || mime.includes('tiff');
}

export function fileTypeLabel(filename = '') {
  const ext = extname(filename);
  if (!ext) return 'Arquivo';
  if (ext === 'pdf') return 'PDF';
  if (['doc', 'docx', 'odt'].includes(ext)) return 'Documento';
  if (['xls', 'xlsx', 'ods'].includes(ext)) return 'Planilha';
  if (['ppt', 'pptx'].includes(ext)) return 'Apresentação';
  if (IMAGE_EXTENSIONS.includes(ext)) return 'Imagem';
  return ext.toUpperCase();
}

export function titleFromFilename(filename = '') {
  let base = filename.replace(/\.[^.]+$/, '');
  base = base.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  base = base.replace(/\b(19|20)\d{2}[-_. ]?(0?[1-9]|1[0-2])[-_. ]?(0?[1-9]|[12]\d|3[01])\b/g, '');
  base = base.replace(/\b\d{1,2}[-_. ](0?[1-9]|1[0-2])[-_. ]\d{2,4}\b/g, '');
  base = base.replace(/[-–—]+/g, ' – ').replace(/\s+/g, ' ').trim();
  if (!base) return '';
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function typeMeta(typeId) {
  return EVENT_TYPES.find(t => t.id === typeId) || EVENT_TYPES[EVENT_TYPES.length - 1];
}

export function getEventSigners(event) {
  const list = [];
  (event.professors || []).forEach(p => {
    if (!p.name) return;
    list.push({
      key: `prof:${p.id || p.name}`,
      id: p.id || p.name,
      name: p.name,
      email: p.email || '',
      role: 'Professor(a) responsável',
      shortRole: 'Professor(a)',
      kind: 'professor',
      course: (event.courses || []).join(', ')
    });
  });
  (event.coordinators || []).forEach(c => {
    if (!c.name) return;
    list.push({
      key: `coord:${c.id || c.name}`,
      id: c.id || c.name,
      name: c.name,
      email: c.email || '',
      role: 'Coordenação de curso',
      shortRole: 'Coordenação',
      kind: 'coordenador',
      course: c.course || (event.courses || []).join(', ')
    });
  });
  if (event.director?.name) {
    list.push({
      key: 'director',
      id: 'director',
      name: event.director.name,
      email: event.director.email || '',
      role: 'Direção da unidade',
      shortRole: 'Direção',
      kind: 'diretor',
      course: event.baseUnit || ''
    });
  }
  return list;
}

export function getSignature(event, signerKey) {
  return event.signatures?.[signerKey] || null;
}

export function signatureStats(event) {
  const signers = getEventSigners(event);
  const signed = signers.filter(s => getSignature(event, s.key)?.status === 'assinado').length;
  return { total: signers.length, signed, pending: Math.max(0, signers.length - signed) };
}

export function allSigners(events) {
  const rows = [];
  for (const event of events) {
    for (const signer of getEventSigners(event)) {
      rows.push({ event, signer, signature: getSignature(event, signer.key) });
    }
  }
  return rows;
}

export function eventDocStats(event) {
  const docs = (event.attachments || []).filter(a => a.kind === 'document');
  const images = (event.attachments || []).filter(a => a.kind === 'image');
  return { docs, images, docsCount: docs.length, imagesCount: images.length };
}

export function eventStatus(event) {
  const { docsCount, imagesCount } = eventDocStats(event);
  const sig = signatureStats(event);
  if (!docsCount && !imagesCount) return { id: 'sem-documentos', label: 'Sem documentos', tone: 'red' };
  if (!imagesCount) return { id: 'sem-imagens', label: 'Sem comprovação', tone: 'amber' };
  if (!sig.total) return { id: 'sem-assinaturas', label: 'Sem signatários', tone: 'amber' };
  if (sig.pending > 0) return { id: 'pendente', label: `${sig.pending} assinatura${sig.pending > 1 ? 's' : ''} pendente${sig.pending > 1 ? 's' : ''}`, tone: 'amber' };
  return { id: 'completo', label: 'Completo', tone: 'green' };
}

export function isUpcoming(event) { return event.date >= todayISO(); }

export function sortEvents(events, direction = 'desc') {
  return [...events].sort((a, b) => {
    const da = `${a.date || ''}T${a.start || '00:00'}`;
    const db = `${b.date || ''}T${b.start || '00:00'}`;
    return direction === 'asc' ? da.localeCompare(db) : db.localeCompare(da);
  });
}

export function sortSigners(rows) {
  const order = { professor: 0, coordenador: 1, diretor: 2 };
  return [...rows].sort((a, b) => {
    const diff = (order[a.signer.kind] ?? 9) - (order[b.signer.kind] ?? 9);
    if (diff) return diff;
    return a.signer.name.localeCompare(b.signer.name, 'pt-BR');
  });
}

export function debounce(fn, wait = 220) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function hashText(text, length = 16) {
  try {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, length).toUpperCase();
  } catch {
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    return hash.toString(16).toUpperCase().padStart(length, '0').slice(0, length);
  }
}

export function verificationCode(seed = '') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  let out = '';
  for (let i = 0; i < 10; i++) {
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
    out += chars[Math.abs(hash) % chars.length];
  }
  return `UCM-${out.slice(0, 5)}-${out.slice(5)}`;
}

export function maskCpf(value = '') {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  return digits
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

export function cpfLastDigits(value = '') {
  const digits = value.replace(/\D/g, '');
  return digits ? `***.***.${digits.slice(-5, -2)}-${digits.slice(-2)}` : '';
}

export function relTime(isoDateTime) {
  if (!isoDateTime) return '';
  const date = new Date(isoDateTime);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `há ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `há ${hours} h`;
  return date.toLocaleDateString('pt-BR');
}

export function isDateInRange(iso, from, to) {
  if (!iso) return false;
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
}

export function reportPeriodLabel(events) {
  if (!events.length) return 'Período não informado';
  const dates = events.map(e => e.date).filter(Boolean).sort();
  if (!dates.length) return 'Período não informado';
  const first = parseISODate(dates[0]);
  const last = parseISODate(dates[dates.length - 1]);
  if (first.getFullYear() === last.getFullYear() && first.getMonth() === last.getMonth()) {
    return `${MONTHS_LONG[first.getMonth()]} de ${first.getFullYear()}`;
  }
  return `${formatDate(dates[0], 'short')} a ${formatDate(dates[dates.length - 1], 'short')}`;
}

export function groupBy(array, keyFn) {
  return array.reduce((acc, item) => {
    const key = keyFn(item);
    (acc[key] ||= []).push(item);
    return acc;
  }, {});
}

export function chunk(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) result.push(array.slice(i, i + size));
  return result;
}

export function svgPlaceholder(label = 'Comprovação') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#efe5d7"/><stop offset="1" stop-color="#d9c4ae"/></linearGradient></defs>
    <rect width="800" height="600" fill="url(#g)"/>
    <circle cx="650" cy="105" r="170" fill="#7d1f2d" opacity=".08"/>
    <path d="M0 470 230 330l150 75 170-140 250 185v150H0Z" fill="#7d1f2d" opacity=".09"/>
    <text x="400" y="300" text-anchor="middle" font-family="Georgia,serif" font-size="36" fill="#6b1624" opacity=".8">${escapeHtml(label)}</text>
    <text x="400" y="336" text-anchor="middle" font-family="Arial,sans-serif" font-size="15" letter-spacing="3" fill="#8a7771">REGISTRO INSTITUCIONAL</text>
  </svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
}

export function safeJSONParse(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}
