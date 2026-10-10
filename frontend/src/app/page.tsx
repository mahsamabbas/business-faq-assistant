"use client";

import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  fetchStatus,
  sendChat,
  uploadFaq,
  type ChatMessage,
  type Status,
} from "@/lib/api";

type UiMessage = ChatMessage & { excerpts?: { text: string }[] };

const UNAVAILABLE_BANNER = "Answer service unavailable";

export default function Home() {
  const [status, setStatus] = useState<Status | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchStatus()
      .then(setStatus)
      .catch((e: unknown) => handleError(e));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    // Last 3 prior messages (role + content only), excluding the new one.
    const history: ChatMessage[] = messages
      .slice(-3)
      .map(({ role, content }) => ({ role, content }));

    clearErrors();
    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setSending(true);
    try {
      const result = await sendChat(text, history);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: result.answer, excerpts: result.excerpts },
      ]);
    } catch (err) {
      handleError(err);
    } finally {
      setSending(false);
    }
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
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      handleError(err);
      // Keep chat as-is; re-sync status with whatever the server reports.
      fetchStatus().then(setStatus).catch(() => {});
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mx-auto flex h-screen w-full max-w-3xl flex-col gap-3 p-4">
      <header className="flex flex-col gap-3 border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <div>
          <h1 className="text-xl font-semibold">Business FAQ Assistant</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Active FAQ:{" "}
            <span className="font-medium text-foreground">
              {status ? status.filename : "…"}
            </span>
            {status && (
              <span className="ml-1 text-zinc-500">({status.source})</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md"
            aria-label="FAQ file"
            className="text-sm file:mr-3 file:rounded-md file:border file:border-zinc-300 file:bg-zinc-50 file:px-3 file:py-1.5 file:text-sm dark:file:border-zinc-700 dark:file:bg-zinc-900"
          />
          <button
            type="button"
            onClick={onUpload}
            disabled={uploading}
            className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className={`rounded-md border px-3 py-2 text-sm ${
            unavailable
              ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
              : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
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

      <main className="flex-1 space-y-3 overflow-y-auto py-2">
        {messages.length === 0 && (
          <p className="text-sm text-zinc-500">
            Ask a question about the active FAQ.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
                m.role === "user"
                  ? "bg-foreground text-background"
                  : "bg-zinc-100 text-foreground dark:bg-zinc-900"
              }`}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.role === "assistant" && m.excerpts && m.excerpts.length > 0 && (
                <div className="mt-2 space-y-1 border-t border-zinc-300 pt-2 text-xs text-zinc-500 dark:border-zinc-700">
                  <p className="font-medium">Excerpts</p>
                  {m.excerpts.map((x, j) => (
                    <blockquote
                      key={j}
                      className="border-l-2 border-zinc-300 pl-2 whitespace-pre-wrap dark:border-zinc-700"
                    >
                      {x.text}
                    </blockquote>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {sending && <p className="text-sm text-zinc-500">Thinking…</p>}
        <div ref={endRef} />
      </main>

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question…"
          aria-label="Message"
          className="flex-1 rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700"
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
