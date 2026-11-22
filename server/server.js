/* =========================================================
   Servidor da Comanda
   - Entrega o site (index.html, css, js)
   - Login das três contas (ADMIN, admin, user) e painel de senhas
   - Guarda os dados: no Postgres (Neon) quando existe DATABASE_URL,
     ou em arquivos (computador e testes)

   Variáveis de ambiente (todas opcionais no computador):
     DATABASE_URL    endereço do banco Postgres (Neon). Sem ela, usa arquivos.
     SESSION_SECRET  assina as sessões (obrigatória com banco Postgres)
     ENCRYPTION_KEY  cifra as senhas guardadas no banco (padrão: SESSION_SECRET)
     SENHA_INICIAL   senha das 3 contas na primeira vez (padrão: "beto")
   ========================================================= */

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const Roles = require('../assets/js/roles.js');
const Auth = require('./auth.js');
const { createStorage } = require('./storage.js');
const { createAccounts } = require('./accounts.js');

const ROOT = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));

// COMANDA_COFRE / COMANDA_PORTA permitem mudar a pasta e a porta sem mexer no config (testes)
const VAULT = path.resolve(ROOT, process.env.COMANDA_COFRE || config.pastaCofre || './BD');
const PORT = Number(process.env.COMANDA_PORTA || process.env.PORT || config.porta || 3210);
// O Render define PORT e precisa ouvir em todas as interfaces; no computador, só em localhost
const HOST = process.env.HOST || (process.env.PORT && !process.env.COMANDA_PORTA ? '0.0.0.0' : '127.0.0.1');
const DATA_DIR = path.join(VAULT, 'Comanda');
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

/** Os erros vão para server/erros.log (e para o log do Render). */
function log(message) {
  const line = `${new Date().toLocaleString('pt-BR')}  ${message}\n`;
  console.error(line.trim());
  try { fs.appendFileSync(path.join(__dirname, 'erros.log'), line); } catch { /* ignora */ }
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

async function readJson(req, limit) {
  try { return JSON.parse(await readBody(req, limit)); } catch { return null; }
}

const isValidState = (s) => s && typeof s === 'object' && Array.isArray(s.clients)
  && (s.products === undefined || Array.isArray(s.products));

const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'desconhecido';

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

/* ---------- Inicialização ---------- */
async function main() {
  const databaseUrl = process.env.DATABASE_URL || '';
  const storage = createStorage({ databaseUrl, dataDir: DATA_DIR, log });
  await storage.init();

  // Chaves: no Postgres vêm sempre do ambiente; em arquivo, usa uma chave local gerada uma vez
  const secret = process.env.SESSION_SECRET || await storage.secret();
  if (!secret) {
    log('Recusado: com banco Postgres é obrigatório definir SESSION_SECRET.');
    process.exit(1);
  }
  const encryptionKey = process.env.ENCRYPTION_KEY || secret;

  const accounts = createAccounts({
    storage, secret, encryptionKey, log,
    initialPassword: (process.env.SENHA_INICIAL || '').trim()
  });
  await accounts.init();

  const limiter = Auth.createLimiter();

  /* ---------- API ---------- */
  async function handleLogin(req, res) {
    const ip = clientIp(req);
    if (limiter.blocked(ip)) return send(res, 429, { erro: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });

    const body = (await readJson(req, 4096)) || {};
    const account = await accounts.login(body.usuario, body.senha);
    if (!account) {
      limiter.fail(ip);
      await new Promise((r) => setTimeout(r, 400));
      return send(res, 401, { erro: 'Usuário ou senha incorretos.' });
    }
    limiter.ok(ip);
    return send(res, 200, { token: accounts.tokenFor(account), ...accounts.publicInfo(account) });
  }

  async function handleApi(req, res, pathname) {
    // Público: saber se o servidor está no ar
    if (pathname === '/api/saude' && req.method === 'GET') {
      return send(res, 200, { ok: true, auth: true, banco: storage.name });
    }
    if (pathname === '/api/login' && req.method === 'POST') return handleLogin(req, res);

    // Daqui para baixo, só com login
    const match = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
    const me = match ? accounts.fromToken(match[1]) : null;
    if (!me) return send(res, 401, { erro: 'Faça login para continuar.' });

    if (pathname === '/api/sessao' && req.method === 'GET') {
      return send(res, 200, accounts.publicInfo(me));
    }

    /* Painel de controle: ver e trocar senhas (cada função só enxerga as suas contas) */
    if (pathname === '/api/contas' && req.method === 'GET') {
      if (!Roles.can(me.role, 'accounts.panel')) return send(res, 403, { erro: 'Sem permissão.' });
      return send(res, 200, { eu: accounts.publicInfo(me), contas: accounts.list(me), banco: storage.name });
    }
    if (pathname === '/api/contas/senha-ver' && req.method === 'POST') {
      const body = (await readJson(req, 4096)) || {};
      const r = accounts.reveal(me, String(body.login || ''));
      return send(res, r.status, r.status === 200 ? { senha: r.senha } : { erro: r.erro });
    }
    if (pathname === '/api/contas/senha' && req.method === 'PUT') {
      const body = (await readJson(req, 4096)) || {};
      const r = await accounts.changePassword(me, String(body.login || ''), body.senha);
      return send(res, r.status, r.status === 200 ? { conta: r.conta, token: r.token } : { erro: r.erro });
    }

    /* Dados do sistema */
    if (pathname === '/api/estado' && req.method === 'GET') {
      return send(res, 200, { estado: await storage.getState() });
    }
    // PUT normal; POST para o envio de emergência ao fechar a página
    if (pathname === '/api/estado' && (req.method === 'PUT' || req.method === 'POST')) {
      const body = await readJson(req);
      if (!body || !isValidState(body.estado)) return send(res, 400, { erro: 'Dados inválidos' });
      const state = body.estado;
      // Só quem pode editar produtos altera a lista de preços: para os outros, vale a que está salva
      if (!Roles.can(me.role, 'products.edit')) {
        const current = await storage.getState();
        state.products = (current && current.products) || [];
      }
      await storage.saveState(state);
      return send(res, 200, { ok: true });
    }

    return send(res, 404, { erro: 'Rota não encontrada' });
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
  process.on('SIGTERM', () => server.close(async () => { await storage.close().catch(() => {}); process.exit(0); }));

  server.listen(PORT, HOST, () => {
    console.log(`Comanda rodando em http://localhost:${PORT} · banco: ${storage.location}`);
  });
}

main().catch((e) => {
  log(`Falha ao iniciar: ${e.message}`);
  process.exit(1);
});
