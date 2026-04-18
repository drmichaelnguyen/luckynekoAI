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

export function useVoiceChat({ locale, enabled, sendSpokenText }: UseVoiceChatOptions) {
  const [mode, setMode] = useState<VoiceChatMode>("off");
  const modeRef = useRef<VoiceChatMode>("off");
  const genRef = useRef(0);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const sendRef = useRef(sendSpokenText);
  sendRef.current = sendSpokenText;

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

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
        if (!cleaned) {
          resolve();
          return;
        }
        try {
          window.speechSynthesis.cancel();
        } catch {
          /* */
        }
        const u = new SpeechSynthesisUtterance(cleaned);
        u.lang = locale === "vi" ? "vi-VN" : "en-CA";
        u.rate = 1;
        u.onend = () => resolve();
        u.onerror = () => resolve();
        if (gen === genRef.current) {
          setMode("speaking");
        }
        window.speechSynthesis.speak(u);
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
      rec.lang = locale === "vi" ? "vi-VN" : "en-CA";
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;

      let finalTranscript = "";

      rec.onresult = (event: SpeechRecognitionEvent) => {
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          if (event.results[i]?.isFinal) {
            finalTranscript += event.results[i][0]?.transcript ?? "";
          }
        }
      };

      rec.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (gen !== genRef.current) return;
        const code = event.error;
        if (code === "aborted") return;
        if (code === "no-speech" || code === "audio-capture") {
          if (modeRef.current !== "off") {
            restartTimerRef.current = window.setTimeout(() => loopListen(gen), 450);
          }
          return;
        }
        if (code === "not-allowed") {
          stopConversation();
          return;
        }
        if (modeRef.current !== "off") {
          restartTimerRef.current = window.setTimeout(() => loopListen(gen), 600);
        }
      };

      rec.onend = () => {
        if (gen !== genRef.current || modeRef.current === "off") return;
        const t = finalTranscript.trim();
        if (!t) {
          restartTimerRef.current = window.setTimeout(() => loopListen(gen), 350);
          return;
        }

        void (async () => {
          if (gen !== genRef.current) return;
          setMode("processing");
          const result = await sendRef.current(t);
          if (gen !== genRef.current) return;

          if (result.ok) {
            await speak(result.speakText, gen);
          } else {
            await speak(result.error, gen);
          }

          if (gen !== genRef.current || modeRef.current === "off") return;
          setMode("listening");
          restartTimerRef.current = window.setTimeout(() => loopListen(gen), 400);
        })();
      };

      recognitionRef.current = rec;
      try {
        if (gen === genRef.current) {
          setMode("listening");
        }
        rec.start();
      } catch {
        if (gen === genRef.current && modeRef.current !== "off") {
          restartTimerRef.current = window.setTimeout(() => loopListen(gen), 500);
        }
      }
    },
    [clearRestartTimer, enabled, locale, speak],
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
    genRef.current += 1;
    const gen = genRef.current;
    setMode("listening");
    window.setTimeout(() => loopListen(gen), 120);
  }, [clearRestartTimer, enabled, loopListen]);

  useEffect(() => {
    return () => {
      stopConversation();
    };
  }, [stopConversation]);

  const supported = typeof window !== "undefined" && Boolean(pickRecognitionCtor());

  return {
    mode,
    startVoice,
    stopConversation,
    supported,
  };
}
