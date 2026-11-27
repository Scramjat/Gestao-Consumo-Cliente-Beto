/* =========================================================
   Rotas da API e o nível de acesso de cada uma
     publico  ninguém precisa entrar
     dono     dono da plataforma
     equipe   estabelecimento logado (qualquer aparelho dele)
     gerencia estabelecimento logado + PIN do gerente

   Nas ações da operação, o aparelho manda em `garcomId` quem
   está atendendo.
   ========================================================= */

const V = require('./validar.js');

/* Máximo de erros a cada 10 minutos */
const MAX_PER_DEVICE_AND_LOGIN = 8;
const MAX_PER_DEVICE = 30;
const MAX_PER_LOGIN = 50;
const MAX_PIN = 5;
const MAX_OWNER_PER_DEVICE = 5;
const MAX_OWNER_TOTAL = 30;

const TOO_MANY = 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';

function createRoutes({ establishments, operation, owner, limiter }) {
  const wait = () => new Promise((r) => setTimeout(r, 400));

  /** Confere uma senha ou PIN respeitando o limite de erros. */
  async function guarded(rules, wrongMessage, check) {
    if (limiter.blocked(rules)) V.fail(429, TOO_MANY);
    limiter.hit(rules);
    let result;
    try {
      result = await check();
    } catch (e) {
      // Acesso suspenso (a senha está certa) ou falha do servidor: não conta como senha errada
      limiter.forgive(rules);
      throw e;
    }
    if (!result) {
      await wait();
      V.fail(401, wrongMessage);
    }
    limiter.forgive(rules);
    return result;
  }

  const routes = [];
  const route = (method, path, access, handler) => {
    const pattern = new RegExp(`^${path.replace(/:(\w+)/g, '(?<$1>[A-Za-z0-9_-]{1,64})')}$`);
    routes.push({ method, pattern, access, handler });
  };

  /* ---------- Público ---------- */
  route('GET', '/api/saude', 'publico', () => ({ ok: true }));

  route('POST', '/api/login', 'publico', ({ body, ip }) => {
    const login = String(body.usuario || '').trim().toLowerCase().slice(0, 40);
    const pair = `par:${ip}:${login}`;
    return guarded(
      [[pair, MAX_PER_DEVICE_AND_LOGIN], [`ip:${ip}`, MAX_PER_DEVICE], [`login:${login}`, MAX_PER_LOGIN]],
      'Usuário ou senha incorretos.',
      () => establishments.login(login, body.senha)
    );
  });

  route('POST', '/api/plataforma/login', 'publico', ({ body, ip }) => {
    if (!owner) V.fail(503, 'O painel está desligado: defina PLATAFORMA_SENHA no servidor.');
    return guarded(
      [[`dono:${ip}`, MAX_OWNER_PER_DEVICE], ['dono', MAX_OWNER_TOTAL]],
      'Usuário ou senha incorretos.',
      () => owner.login(body.usuario, body.senha)
    );
  });

  /* ---------- Dono da plataforma ---------- */
  route('GET', '/api/plataforma/estabelecimentos', 'dono', async () => ({
    estabelecimentos: await establishments.list(),
    ultimaCopia: await establishments.lastCopy()
  }));
  route('POST', '/api/plataforma/estabelecimentos', 'dono', ({ body }) => establishments.create(body));
  route('PATCH', '/api/plataforma/estabelecimentos/:id', 'dono', async ({ params, body }) => ({
    estabelecimento: await establishments.update(params.id, body)
  }));
  route('POST', '/api/plataforma/estabelecimentos/:id/redefinir-senha', 'dono',
    ({ params }) => establishments.resetPassword(params.id));
  route('POST', '/api/plataforma/estabelecimentos/:id/redefinir-pin', 'dono',
    ({ params }) => establishments.resetPin(params.id));

  /* ---------- Equipe ---------- */
  route('GET', '/api/sessao', 'equipe', ({ est }) => ({ estabelecimento: establishments.publicInfo(est) }));

  route('GET', '/api/dados', 'equipe', ({ est, query }) => {
    const since = query.get('revisao');
    return operation.data(est.id, /^\d{1,15}$/.test(since || '') ? Number(since) : null);
  });

  route('POST', '/api/gerencia', 'equipe', ({ est, body }) => guarded(
    [[`pin:${est.id}`, MAX_PIN]],
    'PIN incorreto.',
    () => establishments.unlockManager(est, body.pin)
  ));

  route('POST', '/api/comandas', 'equipe', ({ est, body }) => operation.openTab(est.id, body));
  route('PATCH', '/api/comandas/:id', 'equipe', ({ est, params, body }) => operation.updateTab(est.id, params.id, body));
  route('DELETE', '/api/comandas/:id', 'equipe', ({ est, params, body }) => operation.removeTab(est.id, params.id, body));
  route('POST', '/api/comandas/:id/pedidos', 'equipe',
    ({ est, params, body }) => operation.addOrder(est.id, params.id, body));
  route('POST', '/api/comandas/:id/pedidos/:pedido/cancelar', 'equipe',
    ({ est, params, body }) => operation.cancelOrder(est.id, params.id, params.pedido, body));
  route('POST', '/api/comandas/:id/encerrar', 'equipe',
    ({ est, params, body }) => operation.closeTab(est.id, params.id, body));
  route('POST', '/api/comandas/:id/reabrir', 'equipe',
    ({ est, params, body }) => operation.reopenTab(est.id, params.id, body));

  /* ---------- Gerência ---------- */
  route('POST', '/api/funcionarios', 'gerencia', ({ est, body }) => operation.addEmployee(est.id, body));
  route('PATCH', '/api/funcionarios/:id', 'gerencia',
    ({ est, params, body }) => operation.updateEmployee(est.id, params.id, body));

  route('POST', '/api/produtos', 'gerencia', ({ est, body }) => operation.addProduct(est.id, body));
  route('PATCH', '/api/produtos/:id', 'gerencia',
    ({ est, params, body }) => operation.updateProduct(est.id, params.id, body));
  route('DELETE', '/api/produtos/:id', 'gerencia', ({ est, params }) => operation.removeProduct(est.id, params.id));

  route('GET', '/api/gerencia/historico', 'gerencia',
    ({ est, query }) => operation.history(est.id, query.get('de'), query.get('ate'), query.get('abertas') === '1'));
  route('PUT', '/api/gerencia/senha', 'gerencia', ({ est, body }) => establishments.setPassword(est.id, body.senha));
  route('PUT', '/api/gerencia/pin', 'gerencia', ({ est, body }) => {
    limiter.clear(`pin:${est.id}`);
    return establishments.setPin(est.id, body.pin);
  });

  return routes;
}

module.exports = { createRoutes };
