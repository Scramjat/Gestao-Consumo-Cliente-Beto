/* =========================================================
   Segurança: senhas, sessão e limite de tentativas
   - Login confere um HASH (scrypt) da senha, que não dá para desfazer.
   - O painel de acessos precisa MOSTRAR a senha, então ela também fica
     guardada CIFRADA (AES-256-GCM) com uma chave que só existe no
     servidor (ENCRYPTION_KEY). Quem lê só o banco não vê as senhas.
   ========================================================= */

const crypto = require('crypto');

/* ---------- Senha para o login (não reversível) ---------- */
const scrypt = (password, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(String(password), salt, 64, (err, key) => (err ? reject(err) : resolve(key)));
});

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const [alg, saltB64, keyB64] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'));
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

/* ---------- Senha para o painel (reversível, cifrada) ---------- */
const deriveKey = (secret) => crypto.createHash('sha256').update(`comanda-senhas:${secret}`).digest();

function encrypt(text, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const data = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data].map((p, i) => (i === 0 ? p : p.toString('base64'))).join(':');
}

/** Devolve o texto, ou null se a chave mudou / o dado foi alterado. */
function decrypt(blob, secret) {
  try {
    const [version, iv, tag, data] = String(blob || '').split(':');
    if (version !== 'v1') return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/* ---------- Sessão (token assinado) ---------- */
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;
const sign = (payload, secret) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

/** `v` é a versão da senha: trocar a senha invalida todas as sessões da conta. */
function createToken(login, version, secret) {
  const payload = Buffer.from(JSON.stringify({ u: login, v: version, exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

function verifyToken(token, secret) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload, secret);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

/* ---------- Limite de tentativas de login ---------- */
function createLimiter({ windowMs = 10 * 60 * 1000, maxPerIp = 8, maxTotal = 60 } = {}) {
  const byIp = new Map();
  let total = { count: 0, resetAt: 0 };
  return {
    blocked(ip) {
      const now = Date.now();
      const a = byIp.get(ip);
      if (a && a.resetAt > now && a.count >= maxPerIp) return true;
      return total.resetAt > now && total.count >= maxTotal;
    },
    fail(ip) {
      const now = Date.now();
      const a = byIp.get(ip);
      if (!a || a.resetAt <= now) byIp.set(ip, { count: 1, resetAt: now + windowMs });
      else a.count += 1;
      if (total.resetAt <= now) total = { count: 0, resetAt: now + windowMs };
      total.count += 1;
    },
    ok(ip) { byIp.delete(ip); }
  };
}

const digest = (text) => crypto.createHash('sha256').update(String(text)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

module.exports = {
  hashPassword, verifyPassword, encrypt, decrypt, createToken, verifyToken, createLimiter, safeEqual
};
