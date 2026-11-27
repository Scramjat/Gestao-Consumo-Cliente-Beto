/* =========================================================
   Servidor da Comanda (SaaS)
   - API por ação, com login por estabelecimento e PIN do gerente
   - Painel do dono da plataforma em /plataforma
   - Dados no Postgres

   Variáveis de ambiente:
     DATABASE_URL      (obrigatória) endereço do banco Postgres
     SESSION_SECRET    (obrigatória) assina as sessões, 32 caracteres ou mais
     PLATAFORMA_SENHA  senha do painel do dono, 12 caracteres ou mais.
                       Sem ela o painel fica desligado.
     PLATAFORMA_LOGIN  login do painel do dono (padrão: "dono")
     PGSSL=disable     só para um Postgres local, sem SSL
     PROXY_SALTOS      quantos proxies há na frente (padrão: 1 no Render, 0 fora)
     PORT, HOST        onde o servidor ouve
   ========================================================= */

const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const Auth = require('./auth.js');
const V = require('./validar.js');
const { createDb, createPool } = require('./db.js');
const { createEstablishments } = require('./estabelecimentos.js');
const { createOperation } = require('./operacao.js');
const { createRoutes } = require('./rotas.js');

const ROOT = path.resolve(__dirname, '..');
const MAX_BODY = 64 * 1024;
const MIN_SECRET = 32;
const MIN_OWNER_PASSWORD = 12;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

/* Só estes arquivos são entregues: nada do servidor, dos testes ou da configuração */
const ASSETS = [
  ...['theme', 'index', 'metrics', 'billing', 'animations', 'app', 'plataforma'].map((n) => `assets/css/${n}.css`),
  ...[
    'theme', 'utils', 'icons', 'billing', 'waiter-stats', 'excel', 'metrics', 'api', 'store', 'ui', 'waiter',
    'prices', 'manage', 'reports', 'app', 'plataforma'
  ].map((n) => `assets/js/${n}.js`),
  ...['favicon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']
    .map((n) => `assets/img/${n}`),
  'index.html', 'manifest.webmanifest', 'sw.js'
];

const PAGES = {
  ...Object.fromEntries(ASSETS.map((file) => [`/${file}`, file])),
  '/': 'index.html',
  '/plataforma': 'plataforma.html'
};

// Os cards usam o atributo style (cor de cada cliente), por isso style-src aceita estilo na linha
const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
    + "base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

/** Corpo da requisição: sempre um objeto JSON (ou vazio). */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY) chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > MAX_BODY) return reject(new V.HttpError(413, 'Dados grandes demais.'));
      if (!size) return resolve({});
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (body && typeof body === 'object' && !Array.isArray(body)) return resolve(body);
      } catch { /* cai no erro abaixo */ }
      return reject(new V.HttpError(400, 'Dados inválidos.'));
    });
    req.on('error', reject);
  });
}

/**
 * Endereço de quem chamou, usado no limite de tentativas. Atrás de um proxy, o
 * começo do X-Forwarded-For é escrito por quem chama, então conta-se do fim.
 */
function clientIp(req, proxyHops) {
  if (proxyHops > 0) {
    const chain = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    const ip = chain[Math.max(chain.length - proxyHops, 0)];
    if (ip) return ip.slice(0, 64);
  }
  return req.socket.remoteAddress || 'desconhecido';
}

const bearer = (req) => (String(req.headers.authorization || '').match(/^Bearer (.+)$/) || [])[1] || '';

/** Monta o servidor (sem abrir a porta). */
async function createApp({ pool, secret, ownerLogin = 'dono', ownerPassword = '', proxyHops = 0, log = () => {} }) {
  if (String(secret || '').length < MIN_SECRET) {
    throw new Error(`SESSION_SECRET é obrigatória e precisa ter ${MIN_SECRET} caracteres ou mais.`);
  }
  const db = createDb({ pool, log });
  await db.init();

  const establishments = createEstablishments({ db, secret, log });
  const operation = createOperation({ db });
  let owner = null;
  if (ownerPassword.length >= MIN_OWNER_PASSWORD) {
    owner = establishments.platform({ login: ownerLogin, password: ownerPassword });
  } else {
    log(`Painel do dono desligado: defina PLATAFORMA_SENHA com ${MIN_OWNER_PASSWORD} caracteres ou mais.`);
  }
  const routes = createRoutes({ establishments, operation, owner, limiter: Auth.createLimiter() });

  /** Confere o acesso que a rota exige e devolve o estabelecimento logado. */
  async function authorize(req, access) {
    if (access === 'publico') return null;
    if (access === 'dono') {
      if (!owner || !owner.isOwner(bearer(req))) V.fail(401, 'Faça login para continuar.');
      return null;
    }
    const est = (await establishments.fromToken(bearer(req))) || V.fail(401, 'Faça login para continuar.');
    if (access === 'gerencia' && !establishments.isManager(est, String(req.headers['x-gerencia'] || ''))) {
      V.fail(403, 'Digite o PIN do gerente para continuar.');
    }
    return est;
  }

  async function handleApi(req, res, url) {
    const matches = routes.filter((r) => r.pattern.test(url.pathname));
    const found = matches.find((r) => r.method === req.method);
    if (!found) return send(res, matches.length ? 405 : 404, { erro: 'Rota não encontrada.' });

    const est = await authorize(req, found.access);
    const body = req.method === 'GET' ? {} : await readBody(req);
    const result = await found.handler({
      est,
      body,
      query: url.searchParams,
      params: { ...url.pathname.match(found.pattern).groups },
      ip: clientIp(req, proxyHops)
    });
    return send(res, 200, result);
  }

  async function handlePage(req, res, pathname) {
    const text = 'text/plain; charset=utf-8';
    if (!Object.hasOwn(PAGES, pathname)) return send(res, 404, 'Não encontrado', text);
    const file = path.join(ROOT, PAGES[pathname]);
    return send(res, 200, await fs.readFile(file), MIME[path.extname(file)]);
  }

  const server = http.createServer(async (req, res) => {
    let pathname = req.url;
    try {
      const url = new URL(req.url, 'http://localhost');
      pathname = url.pathname;
      if (pathname.startsWith('/api/')) await handleApi(req, res, url);
      else await handlePage(req, res, pathname);
    } catch (e) {
      if (e instanceof V.HttpError) return send(res, e.status, { erro: e.message });
      log(`Erro em ${req.method} ${pathname}: ${e.stack || e.message}`);
      return send(res, 500, { erro: 'Erro no servidor' });
    }
  });

  return {
    server,
    async close() {
      await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
      await db.close();
    }
  };
}

async function main() {
  const log = (message) => console.error(`${new Date().toLocaleString('pt-BR')}  ${message}`);
  const databaseUrl = process.env.DATABASE_URL || '';
  if (!databaseUrl) throw new Error('DATABASE_URL é obrigatória (endereço do banco Postgres).');

  const app = await createApp({
    pool: createPool(databaseUrl),
    secret: process.env.SESSION_SECRET || '',
    ownerLogin: (process.env.PLATAFORMA_LOGIN || '').trim() || 'dono',
    ownerPassword: process.env.PLATAFORMA_SENHA || '',
    proxyHops: Number(process.env.PROXY_SALTOS || (process.env.RENDER ? 1 : 0)),
    log
  });

  const port = Number(process.env.PORT || 3210);
  // O Render define PORT e precisa ouvir em todas as interfaces; no computador, só em localhost
  const host = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
  app.server.listen(port, host, () => console.log(`Comanda rodando em http://localhost:${port}`));

  process.on('unhandledRejection', (e) => log(`Erro inesperado: ${e && e.message}`));
  process.on('SIGTERM', async () => { await app.close().catch(() => {}); process.exit(0); });
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`Falha ao iniciar: ${e.message}`);
    process.exit(1);
  });
}

module.exports = { createApp };
