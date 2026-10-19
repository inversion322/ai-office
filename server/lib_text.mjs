// Чистое краткое резюме из markdown-отчёта монтажёра для сообщения Нику (без #, **, обратных кавычек и перечней файлов).
export function cleanReport(md, max = 420) {
  const t = String(md || '').replace(/\r/g, '').replace(/^#{1,6}\s*/gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]*)`/g, '$1');
  const paras = t.split(/\n\s*\n/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const body = paras.filter((p, i) => !(i === 0 && p.length < 100 && !/[.:!?]$/.test(p)));      // первая короткая строка это заголовок отчёта
  let s = (body[0] || '').replace(/^[-•*]\s*/, '');
  if (s.length > max) {
    const cut = s.slice(0, max), at = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
    s = at > max * 0.5 ? cut.slice(0, at + 1) : cut.replace(/\s+\S*$/, '') + '…';
  }
  return s;
}
