/* =========================================================
   Servidor da Comanda
   - Entrega o site (index.html, css, js)
   - Guarda os dados (e as notas do Obsidian) na pasta do banco
   - Login do administrador (quando ADMIN_PASSWORD está definida)
   Sem dependências: só precisa do Node.js.

   No computador (sem ADMIN_PASSWORD): só aceita conexões da própria
   máquina e não pede senha. Na internet (Render): ADMIN_PASSWORD é
   obrigatória; sem ela o servidor se recusa a iniciar.
   ========================================================= */

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const Markdown = require('../assets/js/markdown.js');

const ROOT = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));

// COMANDA_COFRE / COMANDA_PORTA permitem mudar a pasta e a porta sem mexer no config (testes)
const VAULT = path.resolve(ROOT, process.env.COMANDA_COFRE || config.pastaCofre || './BD');
const PORT = Number(process.env.COMANDA_PORTA || process.env.PORT || config.porta || 3210);
// O Render define PORT e precisa ouvir em todas as interfaces; no computador, só em localhost
const HOST = process.env.HOST || (process.env.PORT && !process.env.COMANDA_PORTA ? '0.0.0.0' : '127.0.0.1');
const DATA_DIR = path.join(VAULT, 'Comanda');
const DAYS_DIR = path.join(DATA_DIR, 'Dias');
const BACKUP_DIR = path.join(DATA_DIR, 'backup');
const DATA_FILE = path.join(DATA_DIR, 'dados.json');
const MAX_BODY = 5 * 1024 * 1024;

/* ---------- Login ---------- */
const ADMIN_USER = process.env.ADMIN_USER || 'Admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const AUTH_ON = ADMIN_PASSWORD.length > 0;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;

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

/** Os erros vão para server/erros.log (e para o log do Render). */
function log(message) {
  const line = `${new Date().toLocaleString('pt-BR')}  ${message}\n`;
  console.error(line.trim());
  try { fs.appendFileSync(path.join(__dirname, 'erros.log'), line); } catch { /* ignora */ }
}

/* ---------- Sessão (token assinado, sem guardar nada no servidor) ---------- */
const digest = (text) => crypto.createHash('sha256').update(String(text)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));
const sign = (payload) => crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');

function createToken(user) {
  const payload = Buffer.from(JSON.stringify({ u: user, exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

function session(req) {
  if (!AUTH_ON) return { u: ADMIN_USER };
  const m = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
  return m ? verifyToken(m[1]) : null;
}

/* Limite de tentativas de senha: por endereço e no total */
const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_IP = 8;
const MAX_TOTAL = 60;
let totalFails = { count: 0, resetAt: 0 };

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'desconhecido';
}

function blocked(ip) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (a && a.resetAt > now && a.count >= MAX_PER_IP) return true;
  return totalFails.resetAt > now && totalFails.count >= MAX_TOTAL;
}

function registerFail(ip) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || a.resetAt <= now) attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  else a.count += 1;
  if (totalFails.resetAt <= now) totalFails = { count: 0, resetAt: now + WINDOW_MS };
  totalFails.count += 1;
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
  return s && typeof s === 'object' && Array.isArray(s.clients)
    && (s.products === undefined || Array.isArray(s.products));
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
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer'
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Corpo muito grande')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleLogin(req, res) {
  const ip = clientIp(req);
  if (blocked(ip)) return send(res, 429, { erro: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });

  let body = {};
  try { body = JSON.parse(await readBody(req, 4096)); } catch { /* corpo inválido */ }

  // As duas comparações sempre rodam, para não revelar qual campo errou
  const userOk = String(body.usuario || '').trim().toLowerCase() === ADMIN_USER.toLowerCase();
  const passOk = safeEqual(body.senha || '', ADMIN_PASSWORD);

  if (!AUTH_ON || !userOk || !passOk) {
    registerFail(ip);
    await new Promise((r) => setTimeout(r, 400));
    return send(res, 401, { erro: 'Usuário ou senha incorretos.' });
  }
  attempts.delete(ip);
  return send(res, 200, { token: createToken(ADMIN_USER), usuario: ADMIN_USER });
}

async function handleApi(req, res, pathname) {
  // Público: saber se o servidor está no ar e se pede senha
  if (pathname === '/api/saude' && req.method === 'GET') {
    return send(res, 200, AUTH_ON
      ? { ok: true, auth: true }
      : { ok: true, auth: false, cofre: path.basename(VAULT), pasta: DATA_DIR });
  }

  if (pathname === '/api/login' && req.method === 'POST') return handleLogin(req, res);

  // Daqui para baixo, só com login
  const user = session(req);
  if (!user) return send(res, 401, { erro: 'Faça login para continuar.' });

  if (pathname === '/api/sessao' && req.method === 'GET') {
    return send(res, 200, { ok: true, usuario: user.u });
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
  const { pathname } = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (pathname.startsWith('/api/')) await handleApi(req, res, pathname);
    else await serveStatic(res, pathname);
  } catch (e) {
    log(`Erro em ${req.method} ${pathname}: ${e.message}`);
    send(res, 500, { erro: 'Erro no servidor' });
  }
});

server.on('error', (e) => {
  // Já existe um servidor rodando: este sai em silêncio
  if (e.code === 'EADDRINUSE') process.exit(0);
  log(`Falha ao iniciar: ${e.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (e) => log(`Erro inesperado: ${e && e.message}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));

// Aberto para a internet sem senha: nunca
if (HOST !== '127.0.0.1' && !AUTH_ON) {
  log('Recusado: para aceitar conexões da internet defina a variável ADMIN_PASSWORD.');
  process.exit(1);
}

fs.mkdirSync(DAYS_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

server.listen(PORT, HOST, () => {
  console.log(`Comanda rodando em http://localhost:${PORT} · login ${AUTH_ON ? 'ativado' : 'desativado (só neste computador)'} · banco em ${DATA_DIR}`);
});
