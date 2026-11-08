"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Bot,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  History,
  Loader2,
  Plus,
  Send,
  Square,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
  Sparkles,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import {
  deleteChatAction,
  feedbackAction,
  listChatsAction,
  loadChatAction,
} from "@/app/actions/paybot";
import { Button } from "@/components/ui/button";
import type { ChatChart, ChatSource } from "@/lib/db/schema";
import type { AgentEvent } from "@/lib/ai/types";
import { cn } from "@/lib/utils";
import { ActionCardView } from "./action-card";
import type { ActionCard } from "@/lib/ai/types";
import { ChartView } from "./chart-view";
import { Markdown } from "./markdown";
import { speak, stopSpeaking, useVoice, type VoiceLang } from "./voice";

export const OPEN_EVENT = "payflow:open-paybot";

interface Msg {
  id?: string;
  role: "user" | "assistant";
  content: string;
  sources: ChatSource[];
  chart: ChatChart | null;
  action?: ActionCard | null;
  feedback: number | null;
  engine: string | null;
  tools: { name: string; label: string; status: string }[];
}
interface ChatRow {
  id: string;
  title: string;
  at: string;
}

export function PayBot({ starters }: { starters: string[] }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [chats, setChats] = useState<ChatRow[]>([]);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sessionRef = useRef<string | null>(null);
  sessionRef.current = sessionId;
  const [lang, setLang] = useState<VoiceLang>("en-IN");
  const [readAloud, setReadAloud] = useState(false);
  const readAloudRef = useRef(false);
  const langRef = useRef<VoiceLang>("en-IN");
  readAloudRef.current = readAloud;
  langRef.current = lang;
  const sendRef = useRef<(t: string) => Promise<void>>(async () => {});
  const voice = useVoice(
    useCallback((text: string, final: boolean) => {
      setInput(text);
      if (final && text) void sendRef.current(text);
    }, []),
    useCallback((m: string) => toast.error(m), []),
  );

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [msgs, view]);
  useEffect(() => {
    if (open && view === "chat") inputRef.current?.focus();
  }, [open, view]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && open && !busy && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy]);

  const patchLast = (fn: (m: Msg) => Msg) =>
    setMsgs((all) => all.map((m, i) => (i === all.length - 1 ? fn(m) : m)));

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      setInput("");
      setSuggestions([]);
      setView("chat");
      setBusy(true);
      setMsgs((m) => [
        ...m,
        {
          role: "user",
          content: message,
          sources: [],
          chart: null,
          feedback: null,
          engine: null,
          tools: [],
        },
        {
          role: "assistant",
          content: "",
          sources: [],
          chart: null,
          feedback: null,
          engine: null,
          tools: [],
        },
      ]);
      let spoken = "";
      const ctl = new AbortController();
      abort.current = ctl;
      try {
        const res = await fetch("/api/paybot", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message, sessionId: sessionRef.current }),
          signal: ctl.signal,
        });
        if (!res.ok || !res.body) {
          const err = (await res.json().catch(() => null)) as { error?: string } | null;
          patchLast((m) => ({ ...m, content: err?.error ?? "PayBot is unavailable right now." }));
          return;
        }
        const sid = res.headers.get("x-session-id");
        if (sid) setSessionId(sid);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            let e: AgentEvent;
            try {
              e = JSON.parse(line) as AgentEvent;
            } catch {
              continue;
            }
            if (e.type === "text") {
              spoken += e.delta;
              patchLast((m) => ({ ...m, content: m.content + e.delta }));
            } else if (e.type === "tool")
              patchLast((m) => ({
                ...m,
                tools: [
                  ...m.tools.filter((t) => t.name !== e.name),
                  { name: e.name, label: e.label, status: e.status },
                ],
              }));
            else if (e.type === "sources") patchLast((m) => ({ ...m, sources: e.sources }));
            else if (e.type === "chart") patchLast((m) => ({ ...m, chart: e.chart }));
            else if (e.type === "action") patchLast((m) => ({ ...m, action: e.card }));
            else if (e.type === "suggestions") setSuggestions(e.items);
            else if (e.type === "done")
              patchLast((m) => ({ ...m, id: e.messageId, engine: e.engine }));
            else if (e.type === "error")
              patchLast((m) => ({ ...m, content: m.content || e.message }));
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError")
          patchLast((m) => ({
            ...m,
            content: m.content || "The connection dropped. Please try again.",
          }));
      } finally {
        setBusy(false);
        abort.current = null;
        if (readAloudRef.current && spoken) speak(spoken, langRef.current);
      }
    },
    [busy],
  );

  sendRef.current = send;
  useEffect(() => {
    const onOpen = (e: Event) => {
      setOpen(true);
      const q = (e as CustomEvent<{ message?: string }>).detail?.message;
      if (q) setTimeout(() => void send(q), 50);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [send]);

  async function showHistory() {
    setView("history");
    const r = await listChatsAction();
    if (r.ok) setChats(r.data);
  }
  async function openChat(id: string) {
    const r = await loadChatAction(id);
    if (!r.ok) return void toast.error(r.error);
    setSessionId(id);
    setSuggestions([]);
    setMsgs(r.data.map((m) => ({ ...m, tools: [] })));
    setView("chat");
  }
  async function removeChat(id: string) {
    const r = await deleteChatAction(id);
    if (!r.ok) return void toast.error(r.error);
    setChats((c) => c.filter((x) => x.id !== id));
    if (id === sessionId) newChat();
  }
  function newChat() {
    abort.current?.abort();
    setSessionId(null);
    setMsgs([]);
    setSuggestions([]);
    setView("chat");
  }
  async function rate(i: number, value: 1 | -1) {
    const m = msgs[i];
    if (!m.id) return;
    const next = m.feedback === value ? 0 : value;
    setMsgs((all) =>
      all.map((x, j) => (j === i ? { ...x, feedback: next === 0 ? null : next } : x)),
    );
    const r = await feedbackAction({ messageId: m.id, value: next });
    if (!r.ok) toast.error(r.error);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close PayBot" : "Open PayBot"}
        aria-expanded={open}
        data-tour="paybot"
        className="bg-primary text-primary-foreground focus-visible:ring-ring fixed right-4 bottom-4 z-40 grid size-14 place-items-center rounded-full shadow-lg transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:outline-none active:scale-95"
      >
        {open ? <X className="size-6" /> : <Bot className="size-6" />}
      </button>

      {open && (
        <section
          role="dialog"
          aria-label="PayBot assistant"
          className="bg-card animate-fade-up fixed inset-x-2 right-2 bottom-20 z-40 flex h-[min(36rem,calc(100dvh-6rem))] flex-col overflow-hidden rounded-2xl border shadow-2xl sm:inset-x-auto sm:w-[26rem]"
        >
          <header className="flex items-center gap-2 border-b px-3 py-2.5">
            <span className="bg-accent text-accent-foreground grid size-8 place-items-center rounded-lg">
              <Sparkles className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">PayBot</p>
              <p className="text-muted-foreground truncate text-[11px]">
                Answers from your own PayFlow data
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Voice language: ${lang === "en-IN" ? "English" : "Hindi"}. Switch`}
              onClick={() => setLang(lang === "en-IN" ? "hi-IN" : "en-IN")}
            >
              {lang === "en-IN" ? "EN" : "हि"}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Read answers aloud"
              aria-pressed={readAloud}
              onClick={() => {
                if (readAloud) stopSpeaking();
                setReadAloud(!readAloud);
              }}
            >
              {readAloud ? <Volume2 /> : <VolumeX />}
            </Button>
            <Button size="icon" variant="ghost" aria-label="New chat" onClick={newChat}>
              <Plus />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Chat history"
              onClick={() => (view === "history" ? setView("chat") : void showHistory())}
            >
              <History />
            </Button>
          </header>

          {view === "history" ? (
            <div className="flex-1 overflow-y-auto p-3">
              {chats.length === 0 ? (
                <p className="text-muted-foreground py-10 text-center text-sm">
                  No earlier conversations.
                </p>
              ) : (
                <ul className="space-y-1">
                  {chats.map((c) => (
                    <li key={c.id} className="hover:bg-muted flex items-center gap-1 rounded-lg">
                      <button
                        type="button"
                        onClick={() => void openChat(c.id)}
                        className="min-w-0 flex-1 px-3 py-2 text-left"
                      >
                        <p className="truncate text-sm">{c.title}</p>
                        <p className="text-muted-foreground text-[11px]">
                          {new Date(c.at).toLocaleString("en-IN", {
                            day: "numeric",
                            month: "short",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </p>
                      </button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete ${c.title}`}
                        onClick={() => void removeChat(c.id)}
                      >
                        <Trash2 />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div
              className="flex-1 space-y-4 overflow-y-auto p-3"
              aria-live="polite"
              aria-busy={busy}
            >
              {msgs.length === 0 && (
                <div className="space-y-3 py-2">
                  <p className="text-sm">
                    Hi! Ask me about your pay, leave and tax
                    {starters.some((s) => /payroll|filings|attrition/.test(s))
                      ? ", or about payroll and reports"
                      : ""}
                    . I can only read, never change anything.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {starters.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => void send(s)}
                        className="hover:bg-muted rounded-full border px-3 py-1.5 text-left text-xs transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {msgs.map((m, i) => (
                <div key={m.id ?? i} className={cn("flex", m.role === "user" && "justify-end")}>
                  <div
                    className={cn(
                      "max-w-[92%] text-sm",
                      m.role === "user"
                        ? "bg-primary text-primary-foreground rounded-2xl rounded-br-md px-3 py-2"
                        : "min-w-0",
                    )}
                  >
                    {m.role === "user" ? (
                      m.content
                    ) : (
                      <>
                        {m.tools.length > 0 && (
                          <ul className="mb-2 flex flex-wrap gap-1.5">
                            {m.tools.map((t) => (
                              <li
                                key={t.name}
                                className="bg-muted text-muted-foreground flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
                              >
                                {t.status === "running" ? (
                                  <Loader2 className="size-3 animate-spin" aria-hidden />
                                ) : t.status === "done" ? (
                                  <Check className="text-success size-3" aria-hidden />
                                ) : (
                                  <X className="text-destructive size-3" aria-hidden />
                                )}
                                {t.status === "denied" ? "Not permitted" : t.label}
                              </li>
                            ))}
                          </ul>
                        )}
                        {m.content ? (
                          <Markdown>{m.content}</Markdown>
                        ) : (
                          busy &&
                          i === msgs.length - 1 && (
                            <span className="text-muted-foreground inline-flex items-center gap-2 text-xs">
                              <Loader2 className="size-3 animate-spin" /> Thinking…
                            </span>
                          )
                        )}
                        {m.chart && <ChartView chart={m.chart} />}
                        {m.action && <ActionCardView key={m.action.id} card={m.action} />}
                        {m.sources.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Sources">
                            {m.sources.map((s) => {
                              const body = (
                                <>
                                  <span className="font-medium">{s.title}</span>
                                  {s.detail && (
                                    <span className="text-muted-foreground"> · {s.detail}</span>
                                  )}
                                </>
                              );
                              return s.href ? (
                                <Link
                                  key={s.title + s.href}
                                  href={s.href}
                                  onClick={() => setOpen(false)}
                                  className="hover:bg-muted rounded-lg border px-2 py-1 text-[11px] transition-colors"
                                >
                                  {body}
                                </Link>
                              ) : (
                                <span
                                  key={s.title}
                                  className="rounded-lg border px-2 py-1 text-[11px]"
                                >
                                  {body}
                                </span>
                              );
                            })}
                          </div>
                        )}
                        {m.id && (
                          <div className="mt-2 flex items-center gap-1">
                            <button
                              type="button"
                              aria-label="Good answer"
                              aria-pressed={m.feedback === 1}
                              onClick={() => void rate(i, 1)}
                              className={cn(
                                "hover:bg-muted rounded-md p-1",
                                m.feedback === 1 && "text-success",
                              )}
                            >
                              <ThumbsUp className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label="Bad answer"
                              aria-pressed={m.feedback === -1}
                              onClick={() => void rate(i, -1)}
                              className={cn(
                                "hover:bg-muted rounded-md p-1",
                                m.feedback === -1 && "text-destructive",
                              )}
                            >
                              <ThumbsDown className="size-3.5" />
                            </button>
                            {m.engine === "fallback" && (
                              <span className="text-muted-foreground ms-1 text-[11px]">
                                Built-in answer engine
                              </span>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
              {!busy && suggestions.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void send(s)}
                      className="hover:bg-muted rounded-full border px-3 py-1.5 text-xs transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
              <div ref={bottom} />
            </div>
          )}

          <form
            className="flex items-end gap-2 border-t p-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <label htmlFor="paybot-input" className="sr-only">
              Message PayBot
            </label>
            <textarea
              id="paybot-input"
              ref={inputRef}
              value={input}
              rows={1}
              maxLength={2000}
              placeholder="Ask about pay, leave, tax…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              className="border-input bg-background max-h-28 min-h-10 flex-1 resize-none rounded-xl border px-3 py-2 text-sm"
            />
            {voice.supported && !busy && (
              <Button
                type="button"
                size="icon"
                variant={voice.listening ? "default" : "outline"}
                aria-label={
                  voice.listening
                    ? "Stop listening"
                    : `Speak in ${lang === "en-IN" ? "English" : "Hindi"}`
                }
                aria-pressed={voice.listening}
                onClick={() => (voice.listening ? voice.stop() : voice.start(lang))}
              >
                {voice.listening ? <MicOff /> : <Mic />}
              </Button>
            )}
            {busy ? (
              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label="Stop"
                onClick={() => abort.current?.abort()}
              >
                <Square />
              </Button>
            ) : (
              <Button type="submit" size="icon" aria-label="Send" disabled={!input.trim()}>
                <Send />
              </Button>
            )}
          </form>
        </section>
      )}
    </>
  );
}
