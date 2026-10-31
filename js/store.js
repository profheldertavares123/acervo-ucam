import { uid, svgPlaceholder, verificationCode, todayISO, toISODate } from './utils.js';

const DB_NAME = 'acervo-ucam';
const DB_VERSION = 1;
const DEMO_VERSION = 2;

export const DEFAULT_SETTINGS = {
  institution: 'Universidade Candido Mendes',
  unit: 'Unidade Centro — Rio de Janeiro',
  director: {
    name: '',
    role: 'Diretor(a) da Unidade'
  },
  coordinatorName: 'Coordenação Acadêmica',
  units: [
    'Unidade Centro — Rio de Janeiro',
    'Unidade Ipanema',
    'Unidade Méier',
    'Unidade Niterói',
    'Unidade Campos dos Goytacazes'
  ],
  courses: [
    'Administração',
    'Arquitetura e Urbanismo',
    'Ciências Contábeis',
    'Direito',
    'Educação Física',
    'Enfermagem',
    'Fisioterapia',
    'Nutrição',
    'Pedagogia'
  ],
  reportFooter: 'Documento consolidado pelo Acervo UCM — Núcleo de Registros Acadêmicos.'
};

let dbPromise = null;
const memory = { events: [], files: new Map(), meta: new Map() };
let useMemory = false;

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      useMemory = true;
      reject(new Error('IndexedDB indisponível'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  }).catch(error => {
    useMemory = true;
    console.warn('Acervo UCM: usando armazenamento local em memória.', error);
    return null;
  });
  return dbPromise;
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transação cancelada'));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbGetAll(storeName) {
  const db = await openDatabase();
  if (!db || useMemory) return storeName === 'events' ? [...memory.events] : [];
  const tx = db.transaction(storeName, 'readonly');
  return requestResult(tx.objectStore(storeName).getAll());
}

async function dbGet(storeName, key) {
  const db = await openDatabase();
  if (!db || useMemory) {
    if (storeName === 'events') return memory.events.find(e => e.id === key);
    if (storeName === 'files') return memory.files.get(key);
    if (storeName === 'meta') return memory.meta.get(key);
    return null;
  }
  const tx = db.transaction(storeName, 'readonly');
  return requestResult(tx.objectStore(storeName).get(key));
}

async function dbPut(storeName, value) {
  const db = await openDatabase();
  if (!db || useMemory) {
    if (storeName === 'events') {
      const idx = memory.events.findIndex(e => e.id === value.id);
      if (idx >= 0) memory.events[idx] = value; else memory.events.push(value);
    } else if (storeName === 'files') {
      memory.files.set(value.id, value);
    } else if (storeName === 'meta') {
      memory.meta.set(value.key, value);
    }
    return;
  }
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value);
  await txDone(tx);
}

async function dbDelete(storeName, key) {
  const db = await openDatabase();
  if (!db || useMemory) {
    if (storeName === 'events') memory.events = memory.events.filter(e => e.id !== key);
    if (storeName === 'files') memory.files.delete(key);
    if (storeName === 'meta') memory.meta.delete(key);
    return;
  }
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(key);
  await txDone(tx);
}

async function dbClear(storeName) {
  const db = await openDatabase();
  if (!db || useMemory) {
    if (storeName === 'events') memory.events = [];
    if (storeName === 'files') memory.files.clear();
    return;
  }
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).clear();
  await txDone(tx);
}

export async function getMeta(key, fallback = null) {
  const row = await dbGet('meta', key);
  return row ? row.value : fallback;
}

export async function setMeta(key, value) {
  await dbPut('meta', { key, value });
}

export async function loadSettings() {
  const stored = await getMeta('settings', null);
  if (!stored) return structuredClone(DEFAULT_SETTINGS);
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    ...stored,
    director: { ...DEFAULT_SETTINGS.director, ...(stored.director || {}) },
    units: Array.isArray(stored.units) ? stored.units : DEFAULT_SETTINGS.units,
    courses: Array.isArray(stored.courses) ? stored.courses : DEFAULT_SETTINGS.courses
  };
}

export async function saveSettings(settings) {
  await setMeta('settings', settings);
}

export function normalizeEvent(event) {
  const students = Array.isArray(event.students)
    ? event.students.filter(Boolean)
    : String(event.students || '').split(/[\n;,]/).map(name => name.trim()).filter(Boolean);
  return {
    ...event,
    discipline: typeof event.discipline === 'string' ? event.discipline : '',
    structure: event.structure || 'pratica',
    students
  };
}

function needsEventNormalization(event) {
  return typeof event.discipline !== 'string'
    || !event.structure
    || !Array.isArray(event.students);
}

export async function loadEvents() {
  const events = await dbGetAll('events');
  const normalized = events.map(normalizeEvent);
  const pending = events.filter(needsEventNormalization);
  for (const event of pending) await dbPut('events', normalizeEvent(event));
  return normalized.sort((a, b) => `${b.date || ''}T${b.start || ''}`.localeCompare(`${a.date || ''}T${a.start || ''}`));
}

export async function saveEvent(event) {
  await dbPut('events', event);
}

export async function deleteEvent(event) {
  const fileIds = (event.attachments || []).map(a => a.id).filter(Boolean);
  if (fileIds.length) await deleteFiles(fileIds);
  await dbDelete('events', event.id);
}

export async function putFile(record) {
  await dbPut('files', record);
}

export async function putFiles(records) {
  for (const record of records) await dbPut('files', record);
}

export async function getFileBlob(id) {
  if (!id) return null;
  const record = await dbGet('files', id);
  return record?.blob || null;
}

export async function getFileRecord(id) {
  return dbGet('files', id);
}

export async function deleteFiles(ids) {
  for (const id of ids) await dbDelete('files', id);
}

export async function clearDemoEvents(events) {
  const demoEvents = events.filter(e => e.demo);
  for (const event of demoEvents) await deleteEvent(event);
  return demoEvents;
}

export async function clearAllEvents() {
  const events = await loadEvents();
  const fileIds = events.flatMap(e => (e.attachments || []).map(a => a.id)).filter(Boolean);
  if (fileIds.length) await deleteFiles(fileIds);
  await dbClear('events');
  await dbClear('files');
}

export async function initializeStore() {
  await openDatabase();
  let settings = await loadSettings();
  if (!(await getMeta('settings', null))) await saveSettings(settings);
  let events = await loadEvents();
  const seeded = await getMeta('demoSeeded', false);
  const demoVersion = Number(await getMeta('demoVersion', 0)) || 0;
  if (!events.length && !seeded) {
    events = await seedDemoData(settings);
    await setMeta('demoSeeded', true);
    await setMeta('demoVersion', DEMO_VERSION);
  } else if (seeded && demoVersion < DEMO_VERSION) {
    const staleDemo = events.filter(e => e.demo);
    if (staleDemo.length) {
      const staleFiles = staleDemo.flatMap(e => (e.attachments || []).map(a => a.id));
      for (const evt of staleDemo) await deleteEvent(evt);
      if (staleFiles.length) await deleteFiles(staleFiles);
    }
    const demo = await seedDemoData(settings);
    events = [...events.filter(e => !e.demo), ...demo];
    await setMeta('demoVersion', DEMO_VERSION);
  }
  return { events, settings, demoSeeded: seeded || events.some(e => e.demo) };
}

/* ------------------------------------------------------------------
   Demonstração institucional
   ------------------------------------------------------------------ */

function dateOffset(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return toISODate(date);
}

function demoId(name) { return `demo_${name}`; }

function makePdf(title, subtitle) {
  const clean = (text) => String(text)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[()\\]/g, ' ')
    .replace(/[^\x20-\x7E]/g, ' ');
  const lines = [
    { text: clean(title).slice(0, 62), size: 18, y: 755, font: 'F1' },
    { text: clean(subtitle).slice(0, 78), size: 10, y: 727, font: 'F2' },
    { text: 'UNIVERSIDADE CANDIDO MENDES', size: 9, y: 790, font: 'F1' },
    { text: 'Registro academico institucional', size: 9, y: 670, font: 'F2' },
    { text: 'Este documento integra o acervo de comprovacao das atividades academicas.', size: 9, y: 646, font: 'F2' },
    { text: 'Documento demonstrativo gerado pelo aplicativo Acervo UCM.', size: 8, y: 624, font: 'F2' }
  ];
  const content = lines.map(l => `BT /${l.font} ${l.size} Tf 58 ${l.y} Td (${l.text}) Tj ET`).join('\n')
    + '\n0.49 0.12 0.18 RG 2 w 58 780 m 537 780 l S'
    + '\n0.72 0.60 0.45 RG 0.7 w 58 610 m 537 610 l S';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${new TextEncoder().encode(content).length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return new Blob([bytes], { type: 'application/pdf' });
}

async function makeDemoImage({ title, subtitle, tone = 0, variant = 0 }) {
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 700;
  const ctx = canvas.getContext('2d');
  const palettes = [
    ['#e9dcc9', '#b98f67', '#6b1624'],
    ['#dfe6df', '#96ad9b', '#355b4c'],
    ['#e7dfd1', '#bda57f', '#7a633c'],
    ['#e2dfe8', '#a69bb2', '#4f435c']
  ];
  const [bg, mid, accent] = palettes[tone % palettes.length];
  const grad = ctx.createLinearGradient(0, 0, 1000, 700);
  grad.addColorStop(0, bg);
  grad.addColorStop(1, mid);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1000, 700);

  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 8; i++) {
    ctx.fillRect(60 + i * 120, 0, 1, 700);
    ctx.fillRect(0, 90 + i * 82, 1000, 1);
  }
  ctx.globalAlpha = 1;

  // Architecture silhouette
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.88;
  ctx.fillRect(300, 320, 400, 240);
  ctx.beginPath();
  ctx.arc(500, 320, 143, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(438, 200, 124, 130);
  ctx.beginPath();
  ctx.moveTo(445, 200);
  ctx.lineTo(500, 110);
  ctx.lineTo(555, 200);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(500, 435, 52, Math.PI, 0);
  ctx.lineTo(552, 560);
  ctx.lineTo(448, 560);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(470, 480, 60, 80);

  // Side walls / steps
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(118, 445, 182, 115);
  ctx.fillRect(700, 445, 182, 115);
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < 5; i++) {
    ctx.fillRect(350 - i * 12, 560 + i * 18, 300 + i * 24, 10);
  }
  ctx.globalAlpha = 1;

  // Warm light
  const sun = ctx.createRadialGradient(820, 120, 10, 820, 120, 250);
  sun.addColorStop(0, 'rgba(255,245,210,.68)');
  sun.addColorStop(1, 'rgba(255,245,210,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, 1000, 700);

  // Overlay
  const shade = ctx.createLinearGradient(0, 380, 0, 700);
  shade.addColorStop(0, 'rgba(32,18,15,0)');
  shade.addColorStop(1, 'rgba(32,18,15,.68)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, 1000, 700);

  ctx.fillStyle = 'rgba(255,255,255,.72)';
  ctx.font = '700 13px Arial, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillText('ACERVO UCM  ·  REGISTRO FOTOGRÁFICO', 58, 610);
  ctx.fillStyle = '#fff';
  ctx.font = '34px Georgia, serif';
  const cleanTitle = String(title || '').slice(0, 42);
  ctx.fillText(cleanTitle, 58, 651);
  ctx.fillStyle = 'rgba(255,255,255,.68)';
  ctx.font = '15px Arial, sans-serif';
  ctx.fillText(String(subtitle || '').slice(0, 68), 58, 675);
  ctx.fillStyle = 'rgba(255,255,255,.38)';
  ctx.font = '11px Arial, sans-serif';
  ctx.fillText(`Comprovação ${String(variant + 1).padStart(2, '0')} • imagem ilustrativa de demonstração`, 58, 52);
  ctx.strokeStyle = 'rgba(255,255,255,.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(38, 30, 924, 640);

  return new Promise(resolve => canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.86));
}

function demoEventBase({ slug, title, type, discipline, structure, offset, start, end, location, baseUnit, courses, description, students, professors, coordinators, directorName, images, docs, signatures }) {
  const date = dateOffset(offset);
  const evt = {
    id: demoId(slug),
    title,
    type,
    discipline: discipline || '',
    structure: structure || 'pratica',
    date,
    start,
    end,
    location,
    baseUnit,
    courses,
    description,
    students: students || [],
    professors: professors.map((p, i) => ({ id: `prof_${slug}_${i}`, name: p.name, email: p.email || '' })),
    coordinators: coordinators.map((c, i) => ({ id: `coord_${slug}_${i}`, name: c.name, course: c.course })),
    director: { name: directorName, role: 'Diretor(a) da Unidade' },
    attachments: [],
    signatures: {},
    createdAt: new Date(`${date}T12:00:00`).toISOString(),
    updatedAt: new Date(`${date}T12:00:00`).toISOString(),
    demo: true,
    _images: images || 2,
    _docs: docs || 1,
    _signatures: signatures || {}
  };
  return evt;
}

async function seedDemoData(settings) {
  const directorName = settings.director?.name || 'Prof. Dr. Antônio Carlos de Mello';
  const baseUnit = settings.unit || DEFAULT_SETTINGS.unit;
  const defs = [
    demoEventBase({
      slug: 'pratica-avaliacao',
      title: 'Avaliação funcional e mobilidade na prática clínica',
      type: 'aula-pratica',
      discipline: 'Cinesiologia e Biomecânica',
      structure: 'pratica',
      offset: -18,
      start: '08:00',
      end: '11:30',
      location: 'Laboratório de Cinesiologia e Movimento',
      baseUnit,
      courses: ['Fisioterapia'],
      description: 'Aula prática supervisionada com estações de avaliação funcional, análise de marcha e discussão de casos clínicos. Participação dos estudantes do 5º período, organizados em pequenos grupos com rodízio entre as estações.',
      students: ['Ana Beatriz Ferreira', 'Bruno Carvalho Lima', 'Camila Souza Nunes', 'Diego Martins Rocha', 'Eduarda Alves Pinto', 'Felipe Ramos Costa'],
      professors: [{ name: 'Prof.ª Dr.ª Helena Duarte', email: 'helena.duarte@ucam.edu.br' }],
      coordinators: [{ name: 'Prof.ª Dr.ª Renata Lopes', course: 'Fisioterapia' }],
      directorName,
      images: 3,
      docs: 2,
      signatures: { all: true }
    }),
    demoEventBase({
      slug: 'extensao-horta',
      title: 'Horta comunitária Viva Bem: educação alimentar e cultivo urbano',
      type: 'extensao',
      discipline: 'Nutrição e Saúde Coletiva',
      structure: 'pratica',
      offset: -10,
      start: '13:00',
      end: '17:00',
      location: 'Comunidade São José — Espaço Viva Bem',
      baseUnit,
      courses: ['Nutrição', 'Enfermagem'],
      description: 'Ação extensionista com oficina de educação alimentar, implantação de canteiros e orientações sobre aproveitamento integral dos alimentos. A atividade envolveu moradores da comunidade e estudantes de dois cursos.',
      students: ['Gabriel Nunes', 'Helena Prado', 'Igor Salles', 'Joana Ribeiro'],
      professors: [{ name: 'Prof. Dr. Marcos Vinícius Andrade', email: 'marcos.andrade@ucam.edu.br' }, { name: 'Prof.ª Ma. Cláudia Nascimento', email: 'claudia.nascimento@ucam.edu.br' }],
      coordinators: [{ name: 'Prof.ª Dr.ª Laura Fernandes', course: 'Nutrição' }, { name: 'Prof.ª Ma. Simone Teixeira', course: 'Enfermagem' }],
      directorName,
      images: 2,
      docs: 1,
      signatures: { professorFirst: true }
    }),
    demoEventBase({
      slug: 'visita-mar',
      title: 'Visita programada ao Museu de Arte do Rio',
      type: 'visita',
      discipline: 'Arquitetura e Patrimônio Cultural',
      structure: 'pratica',
      offset: -3,
      start: '14:00',
      end: '17:30',
      location: 'Museu de Arte do Rio — Praça Mauá',
      baseUnit,
      courses: ['Arquitetura e Urbanismo'],
      description: 'Visita técnica orientada com foco em mediação cultural, acessibilidade e soluções arquitetônicas do equipamento. Os estudantes produziram registros analíticos e participarão de seminário de sistematização.',
      students: ['Larissa Campos', 'Marcelo Duarte', 'Natália Freitas'],
      professors: [{ name: 'Prof.ª Ma. Beatriz Coelho', email: 'beatriz.coelho@ucam.edu.br' }],
      coordinators: [{ name: 'Prof. Dr. Eduardo Paiva', course: 'Arquitetura e Urbanismo' }],
      directorName,
      images: 2,
      docs: 1,
      signatures: { professorFirst: true }
    }),
    demoEventBase({
      slug: 'oficina-governanca',
      title: 'Oficina de governança, integridade e gestão no esporte',
      type: 'oficina',
      discipline: 'Gestão e Governança Esportiva',
      structure: 'teorico-pratica',
      offset: 6,
      start: '19:00',
      end: '21:30',
      location: 'Auditório Professor Alberto Figueiredo',
      baseUnit,
      courses: ['Administração', 'Educação Física'],
      description: 'Oficina aplicada sobre estruturas de governança, compliance e integridade em organizações esportivas. Estudo de casos e construção coletiva de uma matriz de riscos.',
      students: ['Otávio Mendes', 'Paula Vasconcelos', 'Rafael Torres', 'Sofia Almeida', 'Tiago Barros'],
      professors: [{ name: 'Prof. Dr. Daniel Azevedo', email: 'daniel.azevedo@ucam.edu.br' }],
      coordinators: [{ name: 'Prof. Dr. Paulo Henrique Salles', course: 'Administração' }],
      directorName,
      images: 1,
      docs: 1,
      signatures: {}
    })
  ];

  const events = [];
  const files = [];

  for (const evt of defs) {
    const imageCount = evt._images;
    const docCount = evt._docs;
    const sigConfig = evt._signatures;
    const signers = [
      ...evt.professors.map(p => `prof:${p.id}`),
      ...evt.coordinators.map(c => `coord:${c.id}`),
      'director'
    ];

    for (let i = 0; i < imageCount; i++) {
      const blob = await makeDemoImage({
        title: evt.title,
        subtitle: `${evt.location} · ${evt.date.split('-').reverse().slice(0, 2).join('/')}`,
        tone: defs.indexOf(evt),
        variant: i
      });
      const id = `file_${evt.id}_img_${i}`;
      files.push({ id, blob, name: `registro_fotografico_${String(i + 1).padStart(2, '0')}.jpg`, type: blob.type, size: blob.size });
      evt.attachments.push({
        id, name: `registro_fotografico_${String(i + 1).padStart(2, '0')}.jpg`,
        size: blob.size, type: blob.type, kind: 'image', addedAt: evt.createdAt
      });
    }
    for (let i = 0; i < docCount; i++) {
      const names = ['relatorio_tecnico', 'plano_de_atividade', 'lista_de_presenca'];
      const name = `${names[i] || 'documento'}_${evt.id.slice(-6)}.pdf`;
      const blob = makePdf(evt.title, `${evt.date.split('-').reverse().join('/')} · ${evt.location}`);
      const id = `file_${evt.id}_doc_${i}`;
      files.push({ id, blob, name, type: blob.type, size: blob.size });
      evt.attachments.push({ id, name, size: blob.size, type: blob.type, kind: 'document', addedAt: evt.createdAt });
    }

    if (sigConfig.all) {
      signers.forEach((key, index) => {
        evt.signatures[key] = {
          status: 'assinado',
          method: 'gov.br',
          signedAt: new Date(`${evt.date}T${index === 0 ? '11:42' : '15:10'}:00`).toISOString(),
          code: verificationCode(evt.id + key),
          signerName: key.startsWith('prof:') ? evt.professors[0].name : key.startsWith('coord:') ? evt.coordinators[0].name : evt.director.name,
          cpfMasked: '***.***.***-**'
        };
      });
    } else if (sigConfig.professorFirst) {
      const key = `prof:${evt.professors[0].id}`;
      evt.signatures[key] = {
        status: 'assinado',
        method: 'gov.br',
        signedAt: new Date(`${evt.date}T16:20:00`).toISOString(),
        code: verificationCode(evt.id + key),
        signerName: evt.professors[0].name,
        cpfMasked: '***.***.***-**'
      };
    }

    delete evt._images;
    delete evt._docs;
    delete evt._signatures;
    await saveEvent(evt);
    events.push(evt);
  }

  await putFiles(files);
  return events;
}

export function createBlankEvent(settings) {
  const now = new Date().toISOString();
  return {
    id: uid('evt'),
    title: '',
    type: 'aula-pratica',
    discipline: '',
    structure: 'pratica',
    date: todayISO(),
    start: '08:00',
    end: '12:00',
    location: '',
    baseUnit: settings.unit || '',
    courses: [],
    description: '',
    students: [],
    professors: [{ id: uid('prof'), name: '', email: '' }],
    coordinators: [{ id: uid('coord'), name: '', course: settings.courses?.[0] || '' }],
    director: { name: settings.director?.name || '', role: settings.director?.role || 'Diretor(a) da Unidade' },
    attachments: [],
    signatures: {},
    createdAt: now,
    updatedAt: now
  };
}

export async function demoPlaceholderFile(name = 'comprovacao.svg') {
  const blob = svgPlaceholder('Comprovação');
  return { id: uid('file'), name, type: 'image/svg+xml', size: blob.size, kind: 'image', blob };
}
