/* =========================================================
   Funções utilitárias (formatação, validação, texto)
   ========================================================= */

const Utils = {
  onlyDigits(value) {
    return String(value || '').replace(/\D/g, '');
  },

  /** Aplica a máscara 000.000.000-00 progressivamente enquanto digita. */
  formatCPF(value) {
    const d = Utils.onlyDigits(value).slice(0, 11);
    return d
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  },

  /** Valida os dígitos verificadores do CPF. */
  isValidCPF(value) {
    const d = Utils.onlyDigits(value);
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    const calc = (len) => {
      let sum = 0;
      for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
      const rest = (sum * 10) % 11;
      return rest === 10 ? 0 : rest;
    };
    return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
  },

  formatTime(iso) {
    // Com segundos, para conferir exatamente quando foi cada pedido
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  },

  /** "segunda-feira, 02/11/2026" */
  formatToday() {
    return new Date().toLocaleDateString('pt-BR', {
      weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric'
    });
  },

  isToday(iso) {
    return new Date(iso).toDateString() === new Date().toDateString();
  },

  /** Hoje: "21:04". Outro dia: "01/11 21:04". */
  formatWhen(iso) {
    const time = Utils.formatTime(iso);
    if (Utils.isToday(iso)) return time;
    const date = new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return `${date} ${time}`;
  },

  /** "02/11/2026 às 21:04" */
  formatFull(iso) {
    return `${new Date(iso).toLocaleDateString('pt-BR')} às ${Utils.formatTime(iso)}`;
  },

  timeAgo(iso) {
    const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    const h = Math.floor(min / 60);
    if (h >= 24) return Utils.plural(Math.floor(h / 24), 'dia', 'dias').replace(/^/, 'há ');
    const rest = min % 60;
    return rest ? `há ${h}h${String(rest).padStart(2, '0')}` : `há ${h}h`;
  },

  initials(name) {
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0] || '?';
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase();
  },

  /** Cor estável por nome (matiz de 0 a 359). */
  hue(text) {
    let h = 0;
    for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  },

  /** Minúsculas e sem acentos, para busca. */
  normalize(text) {
    return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  },

  escapeHTML(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  },

  debounce(fn, wait) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  },

  plural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
  }
};
