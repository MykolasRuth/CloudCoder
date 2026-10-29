// Spoken playback of assistant replies.
//
// Primary path: the server returns real speech audio (WAV); we play it through a
// shared <audio> element. Browser media audio follows the device's output route,
// so it reaches CarPlay / Bluetooth / headphones — wherever you're connected.
//
// Fallback path: if the server can't produce audio (offline, TTS error), we fall
// back to the Web Speech API. That plays as *system* audio and won't route to
// CarPlay, but it's better than silence.

let audioEl: HTMLAudioElement | null = null;
let curUrl: string | null = null;

function el(): HTMLAudioElement {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.preload = 'auto';
  }
  return audioEl;
}

function revoke() {
  if (curUrl) {
    URL.revokeObjectURL(curUrl);
    curUrl = null;
  }
}

// A tiny silent WAV used to unlock the audio element inside a user gesture.
function makeSilentWav(): Blob {
  const sampleRate = 8000;
  const samples = 400; // ~50ms
  const buffer = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buffer);
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  str(36, 'data');
  v.setUint32(40, samples * 2, true);
  // samples are already zero (silence)
  return new Blob([buffer], { type: 'audio/wav' });
}

// Call this from a user gesture (e.g. the toggle tap). iOS only allows
// programmatic playback later if the element was first played in a gesture.
export function unlockAudio() {
  try {
    const a = el();
    revoke();
    curUrl = URL.createObjectURL(makeSilentWav());
    a.src = curUrl;
    a.play().catch(() => {});
  } catch {}
}

export function stopVoice() {
  try {
    window.speechSynthesis?.cancel();
  } catch {}
  if (audioEl) {
    try {
      audioEl.pause();
    } catch {}
  }
  revoke();
}

// Play server-rendered speech audio as media (routes to the connected device).
export async function playVoiceBlob(blob: Blob): Promise<void> {
  const a = el();
  try {
    a.pause();
  } catch {}
  revoke();
  curUrl = URL.createObjectURL(blob);
  a.src = curUrl;
  a.onended = () => revoke();
  await a.play();
}

// --- Web Speech fallback (no CarPlay routing) -------------------------------

function cleanForSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ') // fenced code — never read aloud
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → just the text
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // headings
    .replace(/^\s*>\s?/gm, '') // blockquotes
    .replace(/^\s*[-*+]\s+/gm, '') // bullet markers
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
    .replace(/\*([^*]+)\*/g, '$1') // italic
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Local, instant condensing: the opening gist plus any question to the user.
function summarizeLocally(md: string): string {
  const text = cleanForSpeech(md.replace(/```[\s\S]*?```/g, ' '));
  if (!text) return '';
  if (text.length <= 200) return text;

  const sentences = (text.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) || [])
    .map((s) => s.trim())
    .filter(Boolean);
  if (!sentences.length) return '';

  const keep = new Set<number>();
  keep.add(0);
  if (sentences[1] && sentences[0].length < 80) keep.add(1);
  sentences.forEach((s, i) => {
    if (s.includes('?')) keep.add(i);
  });

  let out = [...keep]
    .sort((a, b) => a - b)
    .map((i) => sentences[i])
    .join(' ');
  if (out.length > 320) out = out.slice(0, 320).replace(/\s+\S*$/, '') + '…';
  return out;
}

function chunkForSpeech(text: string, max = 220): string[] {
  const out: string[] = [];
  const sentences = text.match(/[^.!?\n]+[.!?\n]*/g) || [text];
  let buf = '';
  for (let s of sentences) {
    while (s.length > max) {
      let cut = s.lastIndexOf(' ', max);
      if (cut <= 0) cut = max;
      out.push(s.slice(0, cut).trim());
      s = s.slice(cut);
    }
    if ((buf + s).length > max) {
      if (buf.trim()) out.push(buf.trim());
      buf = s;
    } else {
      buf += s;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

export function speakFallback(fullReply: string) {
  const synth = window.speechSynthesis;
  if (!synth) return;
  const text = summarizeLocally(fullReply);
  if (!text) return;
  synth.cancel();
  for (const chunk of chunkForSpeech(text)) {
    synth.speak(new SpeechSynthesisUtterance(chunk));
  }
}
