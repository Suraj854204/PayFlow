"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceLang = "en-IN" | "hi-IN";

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult:
    | ((e: {
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type Ctor = new () => RecognitionLike;

const ctor = (): Ctor | null =>
  typeof window === "undefined"
    ? null
    : ((window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor })
        .SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: Ctor }).webkitSpeechRecognition ??
      null);

const ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access was blocked. Allow it in your browser to use voice.",
  "service-not-allowed": "Voice input is not allowed in this browser.",
  "no-speech": "I did not hear anything. Try again.",
  "audio-capture": "No microphone was found.",
  network: "Voice recognition needs an internet connection.",
};

/** Speech-to-text with the browser's Web Speech API. `supported` is false where it does not exist. */
export function useVoice(
  onText: (text: string, final: boolean) => void,
  onError: (m: string) => void,
) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const rec = useRef<RecognitionLike | null>(null);
  useEffect(() => setSupported(ctor() !== null), []);

  const stop = useCallback(() => rec.current?.stop(), []);
  const start = useCallback(
    (lang: VoiceLang) => {
      const C = ctor();
      if (!C) return;
      const r = new C();
      r.lang = lang;
      r.interimResults = true;
      r.continuous = false;
      r.onresult = (e) => {
        let text = "";
        let final = false;
        for (let i = 0; i < e.results.length; i++) {
          text += e.results[i][0].transcript;
          final = e.results[i].isFinal;
        }
        onText(text.trim(), final);
      };
      r.onerror = (e) => onError(ERRORS[e.error] ?? "Voice input stopped unexpectedly.");
      r.onend = () => setListening(false);
      rec.current = r;
      try {
        r.start();
        setListening(true);
      } catch {
        onError("Voice input could not start. Try again.");
      }
    },
    [onText, onError],
  );
  useEffect(() => () => rec.current?.stop(), []);
  return { supported, listening, start, stop };
}

/** Reads text aloud with the browser's voices, preferring one that matches the language. */
export function speak(text: string, lang: VoiceLang): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const plain = text
    .replace(/[*_`>#|-]+/g, " ")
    .replace(/\[(\d+)\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(plain.slice(0, 1200));
  u.lang = lang;
  const v = window.speechSynthesis
    .getVoices()
    .find((x) => x.lang.toLowerCase().startsWith(lang.slice(0, 2)));
  if (v) u.voice = v;
  window.speechSynthesis.speak(u);
  return true;
}
export const stopSpeaking = () =>
  typeof window !== "undefined" && "speechSynthesis" in window && window.speechSynthesis.cancel();
