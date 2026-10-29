import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Render text to a WAV buffer using the OS speech engine — `say` on macOS,
// SAPI via PowerShell on Windows. We synthesize on the server and let the
// browser play the result as ordinary media audio — that's what follows the
// system output route to CarPlay / Bluetooth / headphones. (The browser's
// speechSynthesis plays as *system* audio, which iOS will not route to
// CarPlay — hence doing it this way.)

const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$text = [Console]::In.ReadToEnd()
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SetOutputToWaveFile($env:CC_TTS_OUT)
$synth.Speak($text)
$synth.Dispose()
`;

export function synthesizeWav(text: string): Promise<Buffer> {
  const file = path.join(os.tmpdir(), `cc-tts-${process.pid}-${Date.now()}.wav`);

  const [cmd, args, opts]: [string, string[], object] =
    process.platform === 'darwin'
      ? [
          // -f - reads the text from stdin; LEI16 WAV plays everywhere.
          'say',
          ['-o', file, '--file-format=WAVE', '--data-format=LEI16@22050', '-f', '-'],
          {},
        ]
      : [
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT],
          { env: { ...process.env, CC_TTS_OUT: file } },
        ];

  return new Promise((resolve, reject) => {
    const ps = spawn(cmd, args, opts);
    let err = '';
    const timer = setTimeout(() => {
      try {
        ps.kill();
      } catch {}
      reject(new Error('tts timed out'));
    }, 20000);

    ps.stderr.on('data', (d) => (err += d.toString()));
    ps.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    ps.on('close', (code) => {
      clearTimeout(timer);
      try {
        const buf = fs.readFileSync(file);
        fs.unlink(file, () => {});
        if (buf.length) resolve(buf);
        else reject(new Error(err.trim() || `tts produced no audio (exit ${code})`));
      } catch (e: any) {
        reject(new Error(err.trim() || e?.message || `tts failed (exit ${code})`));
      }
    });

    ps.stdin.on('error', () => {});
    try {
      ps.stdin.write(text);
      ps.stdin.end();
    } catch {
      try {
        ps.stdin.end();
      } catch {}
    }
  });
}
