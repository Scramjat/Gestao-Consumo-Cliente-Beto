/* =========================================================
   Arquivo de cópia criptografado
   A cópia tem nomes, CPFs e os hashes das senhas, então nunca
   é gravada aberta no disco.

   Formato: marca (8) + sal (16) + iv (12) + dados + selo (16)
   AES-256-GCM, com a chave tirada da senha por scrypt. O selo
   acusa senha errada, arquivo cortado ou alterado.
   ========================================================= */

const crypto = require('crypto');
const fs = require('fs');
const { Writable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

const MAGIC = Buffer.from('COMBKP01');
const SALT = 16;
const IV = 12;
const TAG = 16;
const HEADER = MAGIC.length + SALT + IV;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const deriveKey = (password, salt) => crypto.scryptSync(password, salt, 32, SCRYPT);

/** Criptografa o que vier de `source` para o arquivo `target` (que não pode existir). */
async function encryptToFile(source, target, password) {
  const salt = crypto.randomBytes(SALT);
  const iv = crypto.randomBytes(IV);
  const header = Buffer.concat([MAGIC, salt, iv]);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(password, salt), iv);
  cipher.setAAD(header);

  let started = false;
  const frame = new Transform({
    transform(chunk, encoding, done) {
      if (!started) { this.push(header); started = true; }
      done(null, chunk);
    },
    flush(done) {
      if (!started) this.push(header);
      done(null, cipher.getAuthTag());
    }
  });
  await pipeline(source, cipher, frame, fs.createWriteStream(target, { flags: 'wx', mode: 0o600 }));
}

function readSlice(file, position, length) {
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, buffer, 0, length, position);
  } finally {
    fs.closeSync(fd);
  }
  return buffer;
}

function opener(file, password) {
  const { size } = fs.statSync(file);
  if (size <= HEADER + TAG) throw new Error('O arquivo não é uma cópia da Comanda ou está incompleto.');
  const header = readSlice(file, 0, HEADER);
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('O arquivo não é uma cópia da Comanda.');
  const salt = header.subarray(MAGIC.length, MAGIC.length + SALT);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(password, salt), header.subarray(MAGIC.length + SALT));
  decipher.setAAD(header);
  decipher.setAuthTag(readSlice(file, size - TAG, TAG));
  return { decipher, body: () => fs.createReadStream(file, { start: HEADER, end: size - TAG - 1 }) };
}

const WRONG = 'Senha de backup errada, ou o arquivo foi alterado ou está incompleto.';

/** Descriptografa para `destination`. O selo só é conferido no final: veja checkFile. */
async function decryptTo(file, password, destination) {
  const { decipher, body } = opener(file, password);
  await pipeline(body(), decipher, destination);
}

/** Confere o arquivo inteiro sem gravar nada. Use antes de entregar os dados a alguém. */
async function checkFile(file, password) {
  const nowhere = new Writable({ write(chunk, encoding, done) { done(); } });
  try {
    await decryptTo(file, password, nowhere);
  } catch (e) {
    if (/unable to authenticate/i.test(e.message)) throw new Error(WRONG);
    throw e;
  }
}

module.exports = { encryptToFile, decryptTo, checkFile };
