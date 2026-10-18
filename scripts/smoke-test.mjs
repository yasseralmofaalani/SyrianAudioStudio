import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = 'http://127.0.0.1:3847';
const wav = path.join(root, 'test-tone.wav');

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
  });
}

async function main() {
  await run(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ac', '1', wav]);

  const health = await fetch(`${base}/api/health`).then((r) => r.json());
  console.log('health', health.ok, 'ffmpeg', health.ffmpeg);
  if (!health.ffmpeg) throw new Error('ffmpeg unavailable');

  const job = await fetch(`${base}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }).then((r) => r.json());
  console.log('job', job.id);

  const fd = new FormData();
  fd.append('files', new Blob([fs.readFileSync(wav)], { type: 'audio/wav' }), 'نغمة اختبار.wav');

  const up = await fetch(`${base}/api/jobs/${job.id}/upload`, { method: 'POST', body: fd }).then((r) => r.json());
  if (up.error) throw new Error(up.error);
  console.log('uploaded', up.added, up.job.files[0]?.status, up.job.files[0]?.originalName);

  const conv = await fetch(`${base}/api/jobs/${job.id}/convert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ onlySelected: false }),
  }).then((r) => r.json());
  if (conv.error) throw new Error(conv.error);
  console.log('started', conv.started);

  let final;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    final = await fetch(`${base}/api/jobs/${job.id}`).then((r) => r.json());
    const st = final.files[0]?.status;
    process.stdout.write(`status=${st} progress=${final.files[0]?.progress}\n`);
    if (st === 'done' || st === 'failed') break;
  }

  if (final.files[0]?.status !== 'done') {
    throw new Error(`conversion failed: ${final.files[0]?.error}`);
  }
  console.log('OK output', final.files[0].outputName, final.files[0].outputSize);
  try { fs.unlinkSync(wav); } catch { /* ignore */ }
}

main().catch((err) => {
  console.error('FAIL', err.message);
  process.exit(1);
});
