"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  ApiError,
  fetchDocument,
  fetchStatus,
  sendChat,
  uploadFaq,
  type ChatMessage,
  type FaqDocument,
  type Status,
} from "@/lib/api";

const UNAVAILABLE_BANNER = "Answer service unavailable";

const SUGGESTIONS = [
  "What is the return window?",
  "How long does shipping take?",
  "When is support available?",
];

export default function Home() {
  const [status, setStatus] = useState<Status | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [faqDoc, setFaqDoc] = useState<FaqDocument | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    fetchStatus()
      .then(setStatus)
      .catch((e: unknown) => handleError(e));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => {
    if (!viewerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewerOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [viewerOpen]);

  function handleError(e: unknown) {
    if (e instanceof ApiError && e.status === 503) {
      setUnavailable(true);
      setError(e.message);
    } else {
      setUnavailable(false);
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  }

  function clearErrors() {
    setError(null);
    setUnavailable(false);
  }

  async function openViewer() {
    clearErrors();
    setViewerOpen(true);
    setViewerLoading(true);
    try {
      const doc = await fetchDocument();
      setFaqDoc(doc);
    } catch (err) {
      setViewerOpen(false);
      handleError(err);
    } finally {
      setViewerLoading(false);
    }
  }

  async function ask(text: string) {
    const cleaned = text.trim();
    if (!cleaned || sending) return;

    const history: ChatMessage[] = messages
      .slice(-3)
      .map(({ role, content }) => ({ role, content }));

    clearErrors();
    setMessages((m) => [...m, { role: "user", content: cleaned }]);
    setInput("");
    setSending(true);
    try {
      const result = await sendChat(cleaned, history);
      setMessages((m) => [...m, { role: "assistant", content: result.answer }]);
    } catch (err) {
      handleError(err);
    } finally {
      setSending(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await ask(input);
  }

  async function onUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file || uploading) return;
    clearErrors();
    setUploading(true);
    try {
      const next = await uploadFaq(file);
      setMessages([]);
      setStatus(next);
      setFaqDoc(null);
      setFileName(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      handleError(err);
      fetchStatus()
        .then(setStatus)
        .catch(() => {});
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-5 sm:px-6 sm:py-8">
      <header className="animate-rise mb-5 grid gap-5 lg:grid-cols-[1.4fr_1fr] lg:items-end">
        <div>
          <p className="mb-2 text-xs font-semibold tracking-[0.22em] text-teal uppercase">
            FAQ Copilot
          </p>
          <h1 className="font-[family-name:var(--font-display)] text-4xl leading-[0.95] font-extrabold tracking-tight sm:text-5xl">
            <span className="brand-sheen">Business FAQ</span>
            <br />
            <span className="text-ink">Assistant</span>
          </h1>
          <p className="mt-3 max-w-md text-base leading-relaxed text-ink-soft">
            Ask anything in the loaded FAQ. Answers stay grounded — if it is not
            in the file, you will hear that straight.
          </p>
        </div>

        <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/70 p-4 shadow-[var(--shadow)] backdrop-blur-md">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-wide text-teal uppercase">
                Active source
              </p>
              <p className="mt-1 truncate font-[family-name:var(--font-display)] text-lg font-bold text-ink">
                {status?.filename ?? "Loading…"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {status && (
                <span
                  className={`rounded-md px-2.5 py-1 text-xs font-bold tracking-wide uppercase ${
                    status.source === "sample"
                      ? "bg-mint/40 text-teal-deep"
                      : "bg-sun/35 text-ink"
                  }`}
                >
                  {status.source}
                </span>
              )}
              <button
                type="button"
                onClick={openViewer}
                disabled={!status}
                className="rounded-md border border-teal/25 bg-white px-2.5 py-1 text-xs font-bold tracking-wide text-teal-deep uppercase transition hover:border-coral/40 hover:text-coral-deep disabled:cursor-not-allowed disabled:opacity-40"
              >
                View
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-teal/35 bg-paper/80 px-3 py-2.5 text-sm text-ink-soft transition hover:border-coral/50 hover:bg-white">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal text-sm font-bold text-white">
                +
              </span>
              <span className="truncate">
                {fileName ?? "Choose .txt or .md FAQ"}
              </span>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.md"
                aria-label="FAQ file"
                className="sr-only"
                onChange={(e) =>
                  setFileName(e.target.files?.[0]?.name ?? null)
                }
              />
            </label>
            <button
              type="button"
              onClick={onUpload}
              disabled={uploading || !fileName}
              className="rounded-xl bg-coral px-4 py-2.5 text-sm font-bold text-white shadow-[0_10px_24px_rgba(232,93,76,0.35)] transition hover:bg-coral-deep disabled:cursor-not-allowed disabled:opacity-45"
            >
              {uploading ? "Uploading…" : "Upload"}
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className={`animate-rise mb-4 rounded-2xl border px-4 py-3 text-sm ${
            unavailable
              ? "border-coral/40 bg-coral/10 text-coral-deep"
              : "border-sun/50 bg-sun/20 text-ink"
          }`}
        >
          {unavailable ? (
            <>
              <strong>{UNAVAILABLE_BANNER}.</strong>
              {error.replace(/\.$/, "").toLowerCase() !==
                UNAVAILABLE_BANNER.toLowerCase() && <> {error}</>}
            </>
          ) : (
            error
          )}
        </div>
      )}

      <main className="animate-rise relative flex min-h-[52vh] flex-1 flex-col overflow-hidden rounded-[1.75rem] border border-[var(--line)] bg-white/65 shadow-[var(--shadow)] backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-mint/25 to-transparent" />

        <div className="relative flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
          {messages.length === 0 && (
            <div className="mx-auto flex max-w-lg flex-col items-start gap-4 pt-6">
              <p className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">
                Start with a clear question
              </p>
              <p className="text-sm leading-relaxed text-ink-soft">
                Try one of these, or type your own. Replies come only from the
                active FAQ file.
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => ask(s)}
                    className="rounded-xl border border-teal/20 bg-paper px-3 py-2 text-left text-sm font-medium text-teal-deep transition hover:-translate-y-0.5 hover:border-coral/40 hover:bg-white hover:shadow-md"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => {
            const isUser = m.role === "user";
            const refused =
              !isUser &&
              m.content === "I couldn't find that in the current FAQ file.";
            return (
              <div
                key={`${i}-${m.role}`}
                className={`animate-rise flex ${isUser ? "justify-end" : "justify-start"}`}
                style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}
              >
                <div
                  className={`max-w-[min(100%,34rem)] px-4 py-3 text-[0.95rem] leading-relaxed shadow-sm ${
                    isUser
                      ? "rounded-[1.25rem_1.25rem_0.35rem_1.25rem] bg-teal-deep text-white"
                      : refused
                        ? "rounded-[1.25rem_1.25rem_1.25rem_0.35rem] border border-sun/50 bg-sun/25 text-ink"
                        : "rounded-[1.25rem_1.25rem_1.25rem_0.35rem] border border-teal/10 bg-paper text-ink"
                  }`}
                >
                  {!isUser && (
                    <p
                      className={`mb-1 text-[0.68rem] font-bold tracking-[0.16em] uppercase ${
                        refused ? "text-ink-soft" : "text-teal"
                      }`}
                    >
                      {refused ? "Not in FAQ" : "From FAQ"}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </div>
              </div>
            );
          })}

          {sending && (
            <div className="flex justify-start">
              <div className="flex items-center gap-1.5 rounded-[1.25rem] border border-teal/10 bg-paper px-4 py-3">
                <span className="typing-dot h-2 w-2 rounded-full bg-teal" />
                <span className="typing-dot h-2 w-2 rounded-full bg-coral" />
                <span className="typing-dot h-2 w-2 rounded-full bg-sun" />
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form
          onSubmit={onSubmit}
          className="relative border-t border-[var(--line)] bg-white/80 p-3 sm:p-4"
        >
          <div className="flex items-end gap-2 rounded-2xl border border-teal/15 bg-foam px-2 py-2 shadow-inner sm:gap-3 sm:px-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about returns, shipping, hours…"
              aria-label="Message"
              className="min-h-11 flex-1 bg-transparent px-2 py-2 text-base text-ink outline-none placeholder:text-ink-soft/70"
            />
            <button
              type="submit"
              disabled={!input.trim() || sending}
              className="rounded-xl bg-gradient-to-br from-coral to-coral-deep px-5 py-2.5 text-sm font-bold text-white shadow-[0_10px_22px_rgba(232,93,76,0.35)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </form>
      </main>

      {viewerOpen && (
        <div
          className="modal-backdrop fixed inset-0 z-50 flex items-end justify-center bg-[#102a2d]/55 p-3 backdrop-blur-sm sm:items-center sm:p-6"
          role="presentation"
          onClick={() => setViewerOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="modal-panel flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-[1.6rem] border border-white/40 bg-[linear-gradient(165deg,#f7fbf9_0%,#ffffff_45%,#fff6f1_100%)] shadow-[0_30px_80px_rgba(16,42,45,0.35)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative border-b border-[var(--line)] px-5 py-4 sm:px-6">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-teal via-mint to-coral" />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold tracking-[0.18em] text-teal uppercase">
                    FAQ preview
                  </p>
                  <h2
                    id={titleId}
                    className="mt-1 truncate font-[family-name:var(--font-display)] text-2xl font-extrabold text-ink"
                  >
                    {faqDoc?.filename ?? status?.filename ?? "FAQ file"}
                  </h2>
                  {faqDoc && (
                    <p className="mt-1 text-sm text-ink-soft">
                      Source:{" "}
                      <span className="font-semibold text-teal-deep">
                        {faqDoc.source}
                      </span>
                      {" · "}
                      {faqDoc.text.length.toLocaleString()} characters
                    </p>
                  )}
                </div>
                <button
                  ref={closeRef}
                  type="button"
                  onClick={() => setViewerOpen(false)}
                  aria-label="Close FAQ preview"
                  className="rounded-xl border border-teal/20 bg-white px-3 py-2 text-sm font-bold text-ink transition hover:border-coral/40 hover:text-coral-deep"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
              {viewerLoading && (
                <p className="text-sm text-ink-soft">Loading FAQ…</p>
              )}
              {!viewerLoading && faqDoc && (
                <pre className="whitespace-pre-wrap rounded-2xl border border-teal/10 bg-paper/90 p-4 font-[family-name:var(--font-body)] text-[0.95rem] leading-7 text-ink shadow-inner">
                  {faqDoc.text}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
