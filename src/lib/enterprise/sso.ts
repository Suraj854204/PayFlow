/** Normalises what an admin typed ("@Acme.com, acme.in") to unique lowercase bare domains. */
export function parseDomains(input: string): { domains: string[]; invalid: string[] } {
  const parts = input
    .split(/[\s,;]+/)
    .map((p) => p.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean);
  const re = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
  const domains: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    if (!re.test(p)) invalid.push(p);
    else if (!domains.includes(p)) domains.push(p);
  }
  return { domains, invalid };
}

export const emailDomain = (email: string) => email.trim().toLowerCase().split("@").pop() ?? "";
