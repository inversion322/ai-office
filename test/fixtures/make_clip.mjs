// Контрольные ролики для тестов конвейера: настоящие mp4 1080x1920, 30 к/с, AAC 48 кГц стерео, 12 секунд.
// kind: 'dynamic' (цветные поля по 1 с с движением, проходит измеритель динамики), 'static' (бумага с медленно движущимся блоком), 'horizontal' (1920x1080)
import { spawnSync } from 'node:child_process';
export function makeClip(ff, out, kind = 'dynamic') {
  const size = kind === 'horizontal' ? '1920x1080' : '1080x1920'; const D = 12;
  const audio = ['-f', 'lavfi', '-i', `sine=d=${D}`];
  let video, extra = [];
  if (kind === 'dynamic') {
    const cols = ['0xE8A317', '0x364FC7', '0xF5F3EE', '0xD64545', '0x1F9D63', '0xF5F3EE']; const inputs = []; let fc = '';
    for (let i = 0; i < D; i++) { inputs.push('-f', 'lavfi', '-i', `color=c=${cols[i % cols.length]}:s=${size}:r=30:d=1,drawbox=x='mod(t*1500,700)':y=500:w=380:h=300:color=black@0.35:t=fill`); fc += `[${i}]`; }
    video = inputs; extra = ['-filter_complex', `${fc}concat=n=${D}:v=1:a=0[v]`, '-map', '[v]', '-map', `${D}:a`];
  } else {
    video = ['-f', 'lavfi', '-i', `color=c=0xF5F3EE:s=${size}:r=30:d=${D},drawbox=x='100+t*5':y=800:w=300:h=200:color=white@1:t=fill`]; extra = ['-map', '0:v', '-map', '1:a'];
  }
  const r = spawnSync(ff, ['-v', 'error', '-y', ...video, ...audio, ...extra, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-shortest', out]);
  if (r.status !== 0) throw new Error('не удалось собрать контрольный ролик: ' + String(r.stderr).slice(0, 300));
  return out;
}
