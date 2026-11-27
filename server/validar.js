/* =========================================================
   Erros com resposta HTTP e conferência do que chega do aparelho
   ========================================================= */

const crypto = require('crypto');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const fail = (status, message) => { throw new HttpError(status, message); };

const newId = () => crypto.randomUUID();

/** Texto sem espaços sobrando, dentro do tamanho permitido. */
function text(value, { field, min = 0, max }) {
  if (value !== undefined && value !== null && typeof value !== 'string') fail(400, `${field}: valor inválido.`);
  // eslint-disable-next-line no-control-regex
  const t = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length < min) fail(400, min > 1 ? `${field}: digite pelo menos ${min} caracteres.` : `${field}: preencha este campo.`);
  if (t.length > max) fail(400, `${field}: use no máximo ${max} caracteres.`);
  return t;
}

/**
 * Identificador criado pelo aparelho. Mandar o mesmo de novo (internet caiu e
 * o aparelho repetiu o envio) não grava duas vezes.
 */
function id(value, field = 'id') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(value)) fail(400, `${field}: identificador inválido.`);
  return value;
}

function integer(value, { field, min, max }) {
  if (!Number.isInteger(value) || value < min || value > max) fail(400, `${field}: use um número inteiro de ${min} a ${max}.`);
  return value;
}

module.exports = { HttpError, fail, newId, text, id, integer };
