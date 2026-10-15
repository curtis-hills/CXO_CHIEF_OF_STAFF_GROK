export async function sessionToken(password: string): Promise<string> {
  const encoded = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoded.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoded.encode("cxm-dashboard-session-v1"));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a: string, b: string): boolean {
  const encoded = new TextEncoder();
  const left = encoded.encode(a);
  const right = encoded.encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  return value;
}
