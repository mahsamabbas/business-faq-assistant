const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Status = { filename: string; source: "sample" | "upload" };
export type FaqDocument = Status & { text: string };
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ChatResult = {
  answer: string;
  refused: boolean;
  excerpts: { text: string }[];
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function readDetail(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data?.detail === "string") return data.detail;
    if (Array.isArray(data?.detail) && data.detail[0]?.msg) {
      return String(data.detail[0].msg);
    }
  } catch {
    // non-JSON error body
  }
  return fallback;
}

async function request(url: string, init: RequestInit | undefined, fallback: string) {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError("Could not reach the API server.", 0);
  }
  if (!res.ok) {
    throw new ApiError(await readDetail(res, fallback), res.status);
  }
  return res.json();
}

export function fetchStatus(): Promise<Status> {
  return request(`${API_URL}/status`, undefined, "Failed to load status");
}

export function fetchDocument(): Promise<FaqDocument> {
  return request(`${API_URL}/document`, undefined, "Failed to load FAQ document");
}

export function uploadFaq(file: File): Promise<Status> {
  const body = new FormData();
  body.append("file", file);
  return request(`${API_URL}/upload`, { method: "POST", body }, "Upload failed");
}

export function sendChat(
  message: string,
  history: ChatMessage[],
): Promise<ChatResult> {
  return request(
    `${API_URL}/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history }),
    },
    "Chat failed",
  );
}
