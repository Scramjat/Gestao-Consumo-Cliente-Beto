/* =========================================================
   Segurança: senhas, sessão e limite de tentativas
   Senhas e PINs são guardados só como HASH (scrypt), que não dá
   para desfazer. Ninguém consegue ver uma senha: só criar outra.
   ========================================================= */

const crypto = require('crypto');

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

/* ---------- Senhas geradas ---------- */
// Sem letras e números que se confundem (0/o, 1/l/i)
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const randomPassword = (length = 12) =>
  Array.from({ length }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');

/** PIN de 6 números que não seja uma sequência óbvia. */
const isWeakPin = (pin) => /^(\d)\1{5}$/.test(pin) || '01234567890'.includes(pin) || '09876543210'.includes(pin);

function randomPin() {
  let pin;
  do pin = String(crypto.randomInt(1000000)).padStart(6, '0'); while (isWeakPin(pin));
  return pin;
}

/* ---------- Sessão (token assinado) ---------- */
const sign = (payload, secret) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

/** `tipo` separa os acessos: um token de um tipo nunca vale no lugar de outro. */
function createToken(tipo, data, ttlMs, secret) {
  const payload = Buffer.from(JSON.stringify({ ...data, t: tipo, exp: Date.now() + ttlMs })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

function verifyToken(tipo, token, secret) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload, secret));
  const received = Buffer.from(signature);
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.t === tipo && data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

/* ---------- Limite de tentativas ---------- */
/**
 * Conta erros por chave (aparelho, login...). Cada chave tem o seu limite, assim
 * os erros de um estabelecimento não bloqueiam os outros.
 */
function createLimiter({ windowMs = 10 * 60 * 1000 } = {}) {
  const entries = new Map();
  const current = (key) => {
    const entry = entries.get(key);
    if (entry && entry.resetAt > Date.now()) return entry;
    entries.delete(key);
    return null;
  };
  const sweep = setInterval(() => { for (const key of entries.keys()) current(key); }, windowMs);
  sweep.unref();

  return {
    /** rules: [[chave, máximo de erros], ...] */
    blocked: (rules) => rules.some(([key, max]) => (current(key)?.count || 0) >= max),
    /** Conta a tentativa antes de conferir a senha, para pedidos simultâneos não furarem o limite. */
    hit(rules) {
      for (const [key] of rules) {
        const entry = current(key);
        if (entry) entry.count += 1;
        else entries.set(key, { count: 1, resetAt: Date.now() + windowMs });
      }
    },
    /** A senha estava certa: esta tentativa não conta como erro. */
    forgive(rules) {
      for (const [key] of rules) {
        const entry = current(key);
        if (entry) entry.count -= 1;
      }
    },
    clear: (key) => { entries.delete(key); }
  };
}

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

module.exports = {
  hashPassword, verifyPassword, randomPassword, randomPin, isWeakPin,
  createToken, verifyToken, createLimiter, safeEqual
};
