import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailDomain } from "@/lib/enterprise/sso";
import { deliverResetEmail, RESET_LINK_MINUTES } from "@/lib/mail/reset-email";
import { passwordStrengthError } from "@/lib/validation/auth";
import { accounts, rateLimits, sessions, twoFactors, users, verifications } from "@/lib/db/schema";

const googleId = process.env.GOOGLE_CLIENT_ID;
const googleSecret = process.env.GOOGLE_CLIENT_SECRET;
const msId = process.env.MICROSOFT_CLIENT_ID;
const msSecret = process.env.MICROSOFT_CLIENT_SECRET;

export const auth = betterAuth({
  appName: "PayFlow",
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
      twoFactor: twoFactors,
      rateLimit: rateLimits,
    },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    autoSignIn: true,
    resetPasswordTokenExpiresIn: RESET_LINK_MINUTES * 60,
    // A reset signs the person out everywhere, in case the old password was the thing that leaked.
    revokeSessionsOnPasswordReset: true,
    // Not awaited: the response must look the same whether or not the account exists.
    sendResetPassword: async ({ user, url }) => {
      void deliverResetEmail({ email: user.email, name: user.name }, url);
    },
  },
  socialProviders: {
    ...(googleId && googleSecret
      ? { google: { clientId: googleId, clientSecret: googleSecret } }
      : {}),
    ...(msId && msSecret
      ? { microsoft: { clientId: msId, clientSecret: msSecret, tenantId: "common" } }
      : {}),
  },
  user: {
    additionalFields: {
      locale: { type: "string", required: false, defaultValue: "en" },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  // Stored in Postgres so the limit holds across server instances (memory is per instance).
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 10, max: 3 },
      "/sign-up/email": { window: 60, max: 5 },
      "/two-factor/verify-totp": { window: 60, max: 5 },
      "/request-password-reset": { window: 60, max: 3 },
      "/reset-password": { window: 60, max: 5 },
    },
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
    defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
  },
  hooks: {
    // A company can require Google or Microsoft sign-in for its email domains. Password sign-in,
    // sign-up and password reset are refused for those domains (SAML is not implemented). The
    // reset endpoint also enforces the password rules, which the form alone cannot guarantee.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/reset-password") {
        const pw = (ctx.body as { newPassword?: unknown } | undefined)?.newPassword;
        const problem = typeof pw === "string" ? passwordStrengthError(pw) : null;
        if (problem) throw new APIError("BAD_REQUEST", { message: problem });
        return;
      }
      if (
        ctx.path !== "/sign-in/email" &&
        ctx.path !== "/sign-up/email" &&
        ctx.path !== "/request-password-reset"
      )
        return;
      const email = (ctx.body as { email?: unknown } | undefined)?.email;
      if (typeof email !== "string") return;
      const res = await db.execute(
        sql`select sso_domain_enforced(${emailDomain(email)}) as enforced`,
      );
      if ((res.rows[0] as { enforced?: boolean } | undefined)?.enforced)
        throw new APIError("FORBIDDEN", {
          message: "Your company requires single sign-on. Use Continue with Google or Microsoft.",
        });
    }),
  },
  plugins: [twoFactor({ issuer: "PayFlow" }), nextCookies()],
});

export type Auth = typeof auth;
