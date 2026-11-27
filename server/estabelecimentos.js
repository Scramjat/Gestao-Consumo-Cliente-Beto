/* =========================================================
   Estabelecimentos: login, PIN do gerente e o que o dono da
   plataforma faz (criar, suspender, redefinir acessos)
   ========================================================= */

const crypto = require('crypto');
const Auth = require('./auth.js');
const V = require('./validar.js');

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const MANAGER_TTL_MS = 15 * 60 * 1000;
const PLATFORM_TTL_MS = 12 * 3600 * 1000;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 64;

const iso = (d) => (d ? new Date(d).toISOString() : null);

/** O que a tela pode saber de um estabelecimento (nunca senha, PIN ou hash). */
const publicInfo = (r) => ({
  id: r.id,
  nome: r.nome,
  login: r.login,
  ativo: r.ativo,
  criadoEm: iso(r.criado_em),
  ultimoAcesso: iso(r.ultimo_acesso)
});

// O banco não aceita o caractere nulo
const normalizeLogin = (value) => String(value || '').replaceAll('\u0000', '').trim().toLowerCase();

function validLogin(value) {
  const login = normalizeLogin(value);
  if (!/^[a-z0-9](?:[a-z0-9._-]{1,38})[a-z0-9]$/.test(login)) {
    V.fail(400, 'Login: use de 3 a 40 letras sem acento, números, ponto, hífen ou _.');
  }
  return login;
}

function validPassword(value) {
  const password = String(value || '').trim();
  if (password.length < MIN_PASSWORD) V.fail(400, `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`);
  if (password.length > MAX_PASSWORD) V.fail(400, `A senha pode ter no máximo ${MAX_PASSWORD} caracteres.`);
  return password;
}

function validPin(value) {
  const pin = String(value || '').trim();
  if (!/^\d{6}$/.test(pin)) V.fail(400, 'O PIN precisa ter 6 números.');
  if (Auth.isWeakPin(pin)) V.fail(400, 'Escolha um PIN que não seja repetido nem em sequência.');
  return pin;
}

function createEstablishments({ db, secret, log = () => {} }) {
  let dummyHash = null;

  async function find(id) {
    const { rows } = await db.query('SELECT * FROM estabelecimentos WHERE id = $1', [id]);
    return rows[0] || null;
  }

  async function required(id) {
    return (await find(id)) || V.fail(404, 'Estabelecimento não encontrado.');
  }

  /* ---------- Login do estabelecimento ---------- */
  const sessionToken = (r) => Auth.createToken('est', { sub: r.id, v: r.versao_sessao }, SESSION_TTL_MS, secret);

  async function login(usuario, senha) {
    const { rows } = await db.query('SELECT * FROM estabelecimentos WHERE login = $1', [normalizeLogin(usuario)]);
    const found = rows[0];
    // A conta do hash sempre roda, mesmo sem conta, para o tempo de resposta não revelar nada
    dummyHash ||= await Auth.hashPassword('sem-conta');
    const ok = await Auth.verifyPassword(String(senha || '').trim(), found ? found.senha_hash : dummyHash);
    if (!found || !ok) return null;
    if (!found.ativo) V.fail(403, 'O acesso deste estabelecimento está suspenso.');
    await db.query('UPDATE estabelecimentos SET ultimo_acesso = now() WHERE id = $1', [found.id]);
    return { token: sessionToken(found), estabelecimento: publicInfo(found) };
  }

  /** Estabelecimento dono do token. Confere no banco: suspender ou trocar a senha vale na hora. */
  async function fromToken(token) {
    const data = Auth.verifyToken('est', token, secret);
    if (!data) return null;
    const found = await find(data.sub);
    if (!found || found.versao_sessao !== data.v) return null;
    if (!found.ativo) V.fail(403, 'O acesso deste estabelecimento está suspenso.');
    return found;
  }

  /* ---------- Gerência (PIN) ---------- */
  const managerToken = (r) => Auth.createToken(
    'ger', { sub: r.id, v: r.versao_pin, s: r.versao_sessao }, MANAGER_TTL_MS, secret
  );

  /** Devolve a liberação da gerência, ou null se o PIN estiver errado. */
  async function unlockManager(establishment, pin) {
    if (!(await Auth.verifyPassword(String(pin || '').trim(), establishment.pin_hash))) return null;
    return { gerencia: managerToken(establishment), expiraEmMs: MANAGER_TTL_MS };
  }

  /** A liberação só vale para o estabelecimento logado, com o PIN e a senha atuais. */
  function isManager(establishment, token) {
    const data = Auth.verifyToken('ger', token, secret);
    return !!data && data.sub === establishment.id
      && data.v === establishment.versao_pin && data.s === establishment.versao_sessao;
  }

  /** Troca a senha de entrada. Desconecta os aparelhos e devolve sessões novas para quem trocou. */
  async function setPassword(id, value) {
    const hash = await Auth.hashPassword(validPassword(value));
    await db.query(
      'UPDATE estabelecimentos SET senha_hash = $2, versao_sessao = versao_sessao + 1 WHERE id = $1', [id, hash]
    );
    const updated = await required(id);
    return { token: sessionToken(updated), gerencia: managerToken(updated) };
  }

  async function setPin(id, value) {
    const hash = await Auth.hashPassword(validPin(value));
    await db.query(
      'UPDATE estabelecimentos SET pin_hash = $2, versao_pin = versao_pin + 1 WHERE id = $1', [id, hash]
    );
    return { gerencia: managerToken(await required(id)) };
  }

  /* ---------- Dono da plataforma ---------- */
  async function list() {
    const { rows } = await db.query('SELECT * FROM estabelecimentos ORDER BY lower(nome), login');
    return rows.map(publicInfo);
  }

  /** A cópia de segurança mais recente, ou null se nunca houve uma. */
  async function lastCopy() {
    const { rows } = await db.query('SELECT criada_em, conferida FROM copias ORDER BY criada_em DESC LIMIT 1');
    return rows[0] ? { criadaEm: iso(rows[0].criada_em), conferida: rows[0].conferida } : null;
  }

  /** Cria com senha e PIN sorteados, mostrados uma única vez. */
  async function create({ nome, login: usuario }) {
    const name = V.text(nome, { field: 'Nome', min: 2, max: 80 });
    const newLogin = validLogin(usuario);
    const senha = Auth.randomPassword();
    const pin = Auth.randomPin();
    const id = V.newId();
    try {
      await db.query(
        'INSERT INTO estabelecimentos (id, nome, login, senha_hash, pin_hash) VALUES ($1, $2, $3, $4, $5)',
        [id, name, newLogin, await Auth.hashPassword(senha), await Auth.hashPassword(pin)]
      );
    } catch (e) {
      if (e.code === '23505') V.fail(409, 'Já existe um estabelecimento com esse login.');
      throw e;
    }
    log(`Estabelecimento criado: ${newLogin}`);
    return { estabelecimento: publicInfo(await required(id)), senha, pin };
  }

  async function update(id, { nome, ativo }) {
    const found = await required(id);
    const name = nome === undefined ? found.nome : V.text(nome, { field: 'Nome', min: 2, max: 80 });
    if (ativo !== undefined && typeof ativo !== 'boolean') V.fail(400, 'Situação inválida.');
    const active = ativo === undefined ? found.ativo : ativo;
    await db.query('UPDATE estabelecimentos SET nome = $2, ativo = $3 WHERE id = $1', [id, name, active]);
    if (active !== found.ativo) log(`Estabelecimento ${found.login}: ${active ? 'reativado' : 'suspenso'}`);
    return publicInfo(await required(id));
  }

  async function resetPassword(id) {
    const found = await required(id);
    const senha = Auth.randomPassword();
    await setPassword(id, senha);
    log(`Senha redefinida pelo dono da plataforma: ${found.login}`);
    return { senha };
  }

  async function resetPin(id) {
    const found = await required(id);
    const pin = Auth.randomPin();
    await setPin(id, pin);
    log(`PIN redefinido pelo dono da plataforma: ${found.login}`);
    return { pin };
  }

  /* A sessão do dono carrega uma marca da senha atual: trocar a senha encerra as sessões antigas */
  const platform = ({ login: ownerLogin, password }) => {
    const version = crypto.createHmac('sha256', secret).update(`dono:${password}`).digest('base64url');
    return {
      login(usuario, senha) {
        // As duas comparações sempre rodam
        const sameLogin = Auth.safeEqual(normalizeLogin(usuario), normalizeLogin(ownerLogin));
        const samePassword = Auth.safeEqual(String(senha || ''), password);
        return sameLogin && samePassword
          ? { token: Auth.createToken('dono', { v: version }, PLATFORM_TTL_MS, secret) }
          : null;
      },
      isOwner(token) {
        const data = Auth.verifyToken('dono', token, secret);
        return !!data && data.v === version;
      }
    };
  };

  return {
    publicInfo, login, fromToken, unlockManager, isManager, setPassword, setPin,
    list, lastCopy, create, update, resetPassword, resetPin, platform
  };
}

module.exports = { createEstablishments, MIN_PASSWORD };
