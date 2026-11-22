/* =========================================================
   Recursos prontos que estão DESLIGADOS
   Para ligar um recurso, troque false por true e publique.
   ========================================================= */

const Features = {
  // Campo "Atendente" em cada ficha de cliente (quem atendeu).
  // Quando ligado: aparece no cadastro, no cartão, na busca e na planilha do Excel.
  // O campo já é gravado nos dados (vazio) mesmo desligado.
  attendant: false
};

if (typeof module !== 'undefined') module.exports = Features;
