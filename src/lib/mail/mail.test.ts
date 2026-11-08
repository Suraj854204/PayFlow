import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildResetEmail, deliverResetEmail, RESET_LINK_MINUTES } from "./reset-email";
import { sendMail } from "./send";

const URL_ = "https://app.example.com/api/auth/reset-password/tok123?callbackURL=%2Freset-password";

describe("sendMail", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    vi.restoreAllMocks();
  });

  it("does nothing and says why when no provider key is set", async () => {
    delete process.env.RESEND_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await sendMail({ to: ["a@b.in"], subject: "s", text: "t" });
    expect(r).toEqual({ sent: false, reason: expect.stringContaining("RESEND_API_KEY") });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts to Resend with the key, sender and optional html", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM = "PayFlow <no-reply@acme.in>";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const r = await sendMail({ to: ["a@b.in"], subject: "s", text: "t", html: "<p>t</p>" });
    expect(r).toEqual({ sent: true });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer re_test");
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({
      from: "PayFlow <no-reply@acme.in>",
      to: ["a@b.in"],
      html: "<p>t</p>",
    });
  });

  it("throws when the provider rejects the message", async () => {
    process.env.RESEND_API_KEY = "re_test";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("no", { status: 422 }));
    await expect(sendMail({ to: ["a@b.in"], subject: "s", text: "t" })).rejects.toThrow(/422/);
  });
});

describe("buildResetEmail", () => {
  it("contains the link, the expiry and no raw html from the name", () => {
    const m = buildResetEmail({ name: `<img src=x onerror=alert(1)>`, url: URL_ });
    expect(m.text).toContain(URL_);
    expect(m.text).toContain(`${RESET_LINK_MINUTES} minutes`);
    expect(m.html).not.toContain("<img");
    expect(m.html).toContain("&lt;img");
    expect(m.subject).toMatch(/reset/i);
  });

  it("greets generically when the name is blank", () => {
    expect(buildResetEmail({ name: "  ", url: URL_ }).text).toMatch(/^Hi there,/);
  });
});

describe("deliverResetEmail", () => {
  const env = { ...process.env };
  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
  });
  afterEach(() => {
    process.env = { ...env };
    vi.restoreAllMocks();
  });

  it("prints the link in development when email is not configured", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await deliverResetEmail({ email: "asha@acme.in", name: "Asha" }, URL_);
    expect(info.mock.calls[0]![0]).toContain(URL_);
    vi.unstubAllEnvs();
  });

  it("never logs the link in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await deliverResetEmail({ email: "asha@acme.in", name: "Asha" }, URL_);
    expect(info).not.toHaveBeenCalled();
    expect(String(error.mock.calls[0]![0])).not.toContain("tok123");
    vi.unstubAllEnvs();
  });

  it("swallows provider failures so the response cannot reveal the account", async () => {
    process.env.RESEND_API_KEY = "re_test";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { status: 500 }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      deliverResetEmail({ email: "asha@acme.in", name: "Asha" }, URL_),
    ).resolves.toBeUndefined();
    expect(String(error.mock.calls[0]![1])).not.toContain("tok123");
  });
});
