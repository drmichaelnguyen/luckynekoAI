"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Locale } from "@/lib/i18n/config";

export type VoiceChatSendResult =
  | { ok: true; speakText: string }
  | { ok: false; error: string };

export type VoiceChatMode = "off" | "listening" | "processing" | "speaking";

type UseVoiceChatOptions = {
  locale: Locale;
  /** Mic + STT only when signed in (same as chat save). */
  enabled: boolean;
  /** Same pipeline as typed send; return assistant-facing text for TTS (no JSON blocks). */
  sendSpokenText: (text: string) => Promise<VoiceChatSendResult>;
};

function pickRecognitionCtor(): (new () => SpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

function localeTag(locale: Locale) {
  return locale === "vi" ? "vi-VN" : "en-CA";
}

function voiceErrorMessage(locale: Locale, code: string): string | null {
  if (code === "aborted" || code === "no-speech") return null;
  if (locale === "vi") {
    if (code === "audio-capture") return "Không tìm thấy micro. Hãy kiểm tra quyền truy cập mic rồi thử lại.";
    if (code === "not-allowed") return "Trình duyệt đang chặn micro. Hãy cho phép quyền micro rồi thử lại.";
    if (code === "network") return "Kết nối giọng nói bị gián đoạn. Hãy thử lại.";
    return "Chat giọng nói gặp lỗi. Hãy thử nói lại hoặc dùng bàn phím.";
  }
  if (code === "audio-capture") return "I couldn't access your microphone. Check mic permissions and try again.";
  if (code === "not-allowed") return "Your browser is blocking the microphone. Allow mic access and try again.";
  if (code === "network") return "Voice recognition lost its connection. Please try again.";
  return "Voice chat hit an error. Try speaking again or use the keyboard.";
}

function pickSpeechVoice(locale: Locale, voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const desired = localeTag(locale).toLowerCase();
  return (
    voices.find((voice) => voice.lang.toLowerCase() === desired) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith(locale === "vi" ? "vi" : "en")) ??
    voices[0]
  );
}

export function useVoiceChat({ locale, enabled, sendSpokenText }: UseVoiceChatOptions) {
  const [mode, setMode] = useState<VoiceChatMode>("off");
  const [transcript, setTranscript] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const modeRef = useRef<VoiceChatMode>("off");
  const genRef = useRef(0);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const sendRef = useRef(sendSpokenText);
  sendRef.current = sendSpokenText;

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const loadVoices = () => {
      voicesRef.current = window.speechSynthesis.getVoices();
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      if (window.speechSynthesis.onvoiceschanged === loadVoices) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current != null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const stopConversation = useCallback(() => {
    genRef.current += 1;
    clearRestartTimer();
    try {
      recognitionRef.current?.abort();
    } catch {
      /* already stopped */
    }
    recognitionRef.current = null;
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* */
    }
    setTranscript("");
    setErrorMessage(null);
    setMode("off");
  }, [clearRestartTimer]);

  const speak = useCallback(
    (text: string, gen: number): Promise<void> => {
      return new Promise((resolve) => {
        if (gen !== genRef.current) {
          resolve();
          return;
        }
        const cleaned = text
          .replace(/```[\s\S]*?```/g, " ")
          .replace(/\{[\s\S]*?\}/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 8000);
        if (!cleaned || !window.speechSynthesis) {
          resolve();
          return;
        }
        try {
          window.speechSynthesis.cancel();
        } catch {
          /* */
        }
        const utterance = new SpeechSynthesisUtterance(cleaned);
        utterance.lang = localeTag(locale);
        utterance.rate = locale === "vi" ? 1 : 0.98;
        utterance.voice = pickSpeechVoice(locale, voicesRef.current) ?? null;
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        if (gen === genRef.current) {
          setMode("speaking");
        }
        window.speechSynthesis.speak(utterance);
      });
    },
    [locale],
  );

  const loopListen = useCallback(
    (gen: number) => {
      if (!enabled || gen !== genRef.current || modeRef.current === "off") return;
      const Ctor = pickRecognitionCtor();
      if (!Ctor) return;

      clearRestartTimer();
      try {
        recognitionRef.current?.abort();
      } catch {
        /* */
      }

      const rec = new Ctor();
      rec.lang = localeTag(locale);
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;

      let finalTranscript = "";
      let heardSoFar = "";

      rec.onstart = () => {
        if (gen !== genRef.current) return;
        setErrorMessage(null);
        setMode("listening");
      };

      rec.onresult = (event: SpeechRecognitionEvent) => {
        let interimTranscript = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const piece = event.results[i]?.[0]?.transcript ?? "";
          if (event.results[i]?.isFinal) {
            finalTranscript += piece ? `${piece} ` : "";
          } else {
            interimTranscript += piece ? `${piece} ` : "";
          }
        }
        heardSoFar = `${finalTranscript}${interimTranscript}`.trim();
        if (heardSoFar) {
          setTranscript(heardSoFar);
        }
      };

      rec.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (gen !== genRef.current) return;
        const code = event.error;
        if (code === "aborted") return;
        const message = voiceErrorMessage(locale, code);
        if (message) {
          setErrorMessage(message);
        }
        if (code === "no-speech" || code === "audio-capture") {
          if (modeRef.current !== "off") {
            restartTimerRef.current = window.setTimeout(() => loopListen(gen), 500);
          }
          return;
        }
        if (code === "not-allowed") {
          stopConversation();
          return;
        }
        if (modeRef.current !== "off") {
          restartTimerRef.current = window.setTimeout(() => loopListen(gen), 700);
        }
      };

      rec.onend = () => {
        if (gen !== genRef.current || modeRef.current === "off") return;
        const heard = (finalTranscript || heardSoFar).trim();
        if (!heard) {
          restartTimerRef.current = window.setTimeout(() => loopListen(gen), 400);
          return;
        }

        setTranscript(heard);

        void (async () => {
          if (gen !== genRef.current) return;
          setMode("processing");
          const result = await sendRef.current(heard);
          if (gen !== genRef.current) return;

          if (result.ok) {
            setErrorMessage(null);
            await speak(result.speakText, gen);
          } else {
            setErrorMessage(result.error);
            await speak(result.error, gen);
          }

          if (gen !== genRef.current || modeRef.current === "off") return;
          setTranscript("");
          setMode("listening");
          restartTimerRef.current = window.setTimeout(() => loopListen(gen), 650);
        })();
      };

      recognitionRef.current = rec;
      try {
        rec.start();
      } catch {
        if (gen === genRef.current) {
          restartTimerRef.current = window.setTimeout(() => loopListen(gen), 650);
        }
      }
    },
    [clearRestartTimer, enabled, locale, speak, stopConversation],
  );

  const startVoice = useCallback(() => {
    if (!enabled || !pickRecognitionCtor()) return;
    clearRestartTimer();
    try {
      recognitionRef.current?.abort();
    } catch {
      /* */
    }
    recognitionRef.current = null;
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* */
    }
    setTranscript("");
    setErrorMessage(null);
    genRef.current += 1;
    const gen = genRef.current;
    setMode("listening");
    window.setTimeout(() => loopListen(gen), 150);
  }, [clearRestartTimer, enabled, loopListen]);

  useEffect(() => {
    if (!enabled && modeRef.current !== "off") {
      stopConversation();
    }
  }, [enabled, stopConversation]);

  useEffect(() => {
    return () => {
      stopConversation();
    };
  }, [stopConversation]);

  const supported =
    typeof window !== "undefined" &&
    Boolean(pickRecognitionCtor()) &&
    typeof window.speechSynthesis !== "undefined";

  return {
    mode,
    transcript,
    errorMessage,
    startVoice,
    stopConversation,
    supported,
  };
}
