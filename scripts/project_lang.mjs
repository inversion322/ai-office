// Язык ролика: проект с файлом lang.json {"lang":"en"} это английская версия (локализация принятого русского ролика); без файла проект русский.
// Ворота (призыв, вердикт) читают язык отсюда, чтобы русские слова-ярлыки и русский призыв не требовались от английского ролика.
import fs from 'node:fs';
import path from 'node:path';

export function projectLang(proj) {
  try { const l = JSON.parse(fs.readFileSync(path.join(proj, 'lang.json'), 'utf8')).lang; return l === 'en' ? 'en' : 'ru'; } catch { return 'ru'; }
}
