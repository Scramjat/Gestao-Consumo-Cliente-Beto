/* =========================================================
   Servidor local da Comanda
   - Entrega o site (index.html, css, js)
   - Grava os dados direto na pasta do cofre do Obsidian
   Sem dependências: só precisa do Node.js instalado.
   ========================================================= */

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const Markdown = require('../assets/js/markdown.js');

const ROOT = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));

// COMANDA_COFRE permite apontar para outra pasta sem mexer no config (útil para testes)
const VAULT = path.resolve(ROOT, process.env.COMANDA_COFRE || config.pastaCofre || './BD');
const PORT = Number(process.env.COMANDA_PORTA || config.porta || 3210);
const DATA_DIR = path.join(VAULT, 'Comanda');
const DAYS_DIR = path.join(DATA_DIR, 'Dias');
const BACKUP_DIR = path.join(DATA_DIR, 'backup');
const DATA_FILE = path.join(DATA_DIR, 'dados.json');
const MAX_BODY = 5 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

/** O servidor roda sem janela, então os erros vão para server/erros.log */
function log(message) {
  const line = `${new Date().toLocaleString('pt-BR')}  ${message}\n`;
  console.error(line.trim());
  try { fs.appendFileSync(path.join(__dirname, 'erros.log'), line); } catch { /* ignora */ }
}

/* ---------- Arquivos ---------- */

/** Grava num arquivo temporário e troca pelo definitivo, para nunca deixar um arquivo pela metade. */
async function writeAtomic(file, content) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, content, 'utf8');
  try {
    await fsp.rename(tmp, file);
  } catch (e) {
    // No Windows o Obsidian às vezes segura o arquivo por um instante; tenta de novo
    await new Promise((r) => setTimeout(r, 150));
    await fsp.rename(tmp, file);
  }
}

function isValidState(s) {
  return s && typeof s === 'object' && Array.isArray(s.clients);
}

async function readState() {
  try {
    return JSON.parse(await fsp.readFile(DATA_FILE, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

// Conteúdo já gravado de cada nota: só regrava o que mudou
const written = new Map();

async function writeIfChanged(file, content) {
  if (written.get(file) === content) return;
  await writeAtomic(file, content);
  written.set(file, content);
}

// Uma gravação por vez, para nunca misturar duas versões
let saving = Promise.resolve();

function saveState(state) {
  saving = saving.catch(() => {}).then(async () => {
    const json = JSON.stringify(state, null, 2);
    const today = Markdown.dayKey(new Date().toISOString());
    await writeAtomic(DATA_FILE, json);
    // Cópia de segurança diária: guarda como os dados estavam em cada dia
    await writeAtomic(path.join(BACKUP_DIR, `dados ${today}.json`), json);
    await writeIfChanged(path.join(DATA_DIR, 'Contas abertas.md'), Markdown.openAccountsNote(state));
    const notes = Markdown.dayNotes(state);
    // Dias que ficaram sem nenhum registro (ex.: cliente excluído) também são atualizados
    for (const file of written.keys()) {
      const day = path.basename(file, '.md');
      if (path.dirname(file) === DAYS_DIR && !notes[day]) notes[day] = Markdown.singleDayNote(state, day);
    }
    for (const [day, content] of Object.entries(notes)) {
      await writeIfChanged(path.join(DAYS_DIR, `${day}.md`), content);
    }
  });
  return saving;
}

/* ---------- HTTP ---------- */

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Corpo muito grande')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleApi(req, res, pathname) {
  if (pathname === '/api/saude' && req.method === 'GET') {
    return send(res, 200, { ok: true, cofre: path.basename(VAULT), pasta: DATA_DIR });
  }

  if (pathname === '/api/estado' && req.method === 'GET') {
    return send(res, 200, { estado: await readState() });
  }

  // PUT normal; POST para o envio de emergência ao fechar a página
  if (pathname === '/api/estado' && (req.method === 'PUT' || req.method === 'POST')) {
    const body = JSON.parse(await readBody(req));
    if (!isValidState(body.estado)) return send(res, 400, { erro: 'Dados inválidos' });
    await saveState(body.estado);
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { erro: 'Rota não encontrada' });
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(ROOT, rel);
  // Só entrega o site: nada fora da pasta, nem o servidor, config ou o próprio banco
  const rootFiles = ['index.html', 'sw.js', 'manifest.webmanifest'].map((f) => path.join(ROOT, f));
  const allowed = rootFiles.includes(file) || file.startsWith(path.join(ROOT, 'assets') + path.sep);
  if (!allowed) return send(res, 404, 'Não encontrado', 'text/plain; charset=utf-8');
  try {
    const data = await fsp.readFile(file);
    send(res, 200, data, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  } catch {
    send(res, 404, 'Não encontrado', 'text/plain; charset=utf-8');
  }
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (pathname.startsWith('/api/')) await handleApi(req, res, pathname);
    else await serveStatic(res, pathname);
  } catch (e) {
    log(`Erro em ${req.method} ${pathname}: ${e.message}`);
    send(res, 500, { erro: e.message });
  }
});

server.on('error', (e) => {
  // Já existe um servidor rodando: este sai em silêncio
  if (e.code === 'EADDRINUSE') process.exit(0);
  log(`Falha ao iniciar: ${e.message}`);
  process.exit(1);
});

fs.mkdirSync(DAYS_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

// Só aceita conexões deste computador
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Comanda rodando em http://localhost:${PORT} · banco em ${DATA_DIR}`);
});
