import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { LOCALE_COOKIE, isLocale, type Locale } from "./locales";

/**
 * Locale order: the person's own choice (cookie), then the company default, then English.
 * There is no locale in the URL, so every link keeps working in both languages.
 */
export default getRequestConfig(async () => {
  let locale: Locale = "en";
  const c = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(c)) locale = c;
  else {
    try {
      const { getContext } = await import("@/lib/auth/context");
      const ctx = await getContext();
      const d = ctx?.companies.find((x) => x.id === ctx.organizationId)?.defaultLocale;
      if (isLocale(d)) locale = d;
    } catch {
      /* not signed in, or no database: English */
    }
  }
  return { locale, messages: (await import(`../../messages/${locale}.json`)).default };
});
