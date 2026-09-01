import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useAuth } from "@/components/auth/auth-provider";
import { BrandLogo } from "@/components/brand/brand-logo";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  validateSearch: z.object({
    error: z.string().optional(),
    redirect: z.string().optional(),
  }),
});

function LoginPage() {
  const { t } = useTranslation("login");
  const search = Route.useSearch();
  const { config, error: configError, loading } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(search.error ?? "");
  const redirect = "/access";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const result = await authClient.signIn.username({
        password,
        rememberMe: remember,
        username,
      });
      if (result.error) throw new Error(result.error.message ?? t("errorTitle"));
      window.location.assign(redirect);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("errorTitle"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="grid min-h-svh bg-background text-foreground lg:grid-cols-[0.9fr_1.1fr]">
      <section className="login-visual relative hidden overflow-hidden border-r border-border p-12 lg:flex lg:flex-col lg:justify-between">
        <Link to="/" className="relative z-10 flex min-h-11 items-center gap-3 text-sm font-semibold">
          <BrandLogo />
        </Link>
        <div className="relative z-10 max-w-xl pb-8">
          <p className="font-mono text-xs uppercase tracking-[0.08em] text-primary">{t("hero.kicker")}</p>
          <h1 className="mt-7 font-display text-6xl font-light leading-[0.98] tracking-[-0.01em]">{t("hero.titleFirst")}<br />{t("hero.titleSecond")}</h1>
          <p className="mt-7 max-w-md text-base leading-7 text-muted-foreground">{t("hero.description")}</p>
        </div>
        <div className="relative z-10 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground"><LockKeyhole className="size-4" />{t("hero.sessionProtected")}</div>
      </section>

      <section className="relative flex min-h-svh items-center justify-center px-5 py-12 sm:px-8 lg:px-16">
        <div className="absolute right-5 top-5 sm:right-8 sm:top-8">
          <LanguageSwitcher />
        </div>
        <div className="w-full max-w-md">
          <Link to="/" className="mb-14 flex min-h-11 items-center gap-3 text-sm font-semibold lg:hidden">
            <BrandLogo />
          </Link>
          <p className="font-mono text-xs uppercase tracking-[0.08em] text-primary">{t("panel.kicker")}</p>
          <h2 className="mt-4 font-display text-4xl font-medium tracking-[-0.025em]">{t("panel.title")}</h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("panel.description")}</p>

          {error || configError ? (
            <div role="alert" className="mt-7 rounded-md border border-destructive-border bg-destructive-surface px-4 py-3 text-sm text-destructive">
              <strong className="block font-semibold">{t("errorTitle")}</strong>
              <span className="mt-1 block">{error || configError}</span>
            </div>
          ) : null}
          {config?.developmentDefaults ? (
            <div className="mt-7 rounded-md border border-info-border bg-info-surface px-4 py-3 text-sm text-foreground">
              {t("developmentAccount.before")} <strong>admin / password</strong>.{" "}
              {t("developmentAccount.after")}
            </div>
          ) : null}

          <form onSubmit={submit} className="mt-8 space-y-5">
            <label className="block text-sm font-medium">
              {t("form.username")}
              <span className="mt-2 flex min-h-12 items-center gap-3 rounded-md border border-input bg-background px-4 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
                <UserRound className="size-4 text-muted-foreground" />
                <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder={t("form.usernamePlaceholder")} required />
              </span>
            </label>
            <label className="block text-sm font-medium">
              {t("form.password")}
              <span className="mt-2 flex min-h-12 items-center gap-3 rounded-md border border-input bg-background px-4 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
                <KeyRound className="size-4 text-muted-foreground" />
                <input value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder={t("form.passwordPlaceholder")} required type={showPassword ? "text" : "password"} />
                <button type="button" onClick={() => setShowPassword((value) => !value)} className="grid size-11 place-items-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2" aria-label={showPassword ? t("form.hidePassword") : t("form.showPassword")}>
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </span>
            </label>
            <label className="flex min-h-11 items-center gap-3 text-sm text-muted-foreground">
              <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="size-4 accent-link" />
              {t("form.keepSignedIn")}
            </label>
            <button disabled={submitting || loading} type="submit" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60">
              {submitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {submitting ? t("form.signingIn") : t("form.signIn")}
            </button>
          </form>

          <div className="mt-8">
            <div className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              {t("separator")}
              <span className="h-px flex-1 bg-border" />
            </div>
            {config?.ssoEnabled ? (
              <a
                href={`/api/auth/sso?callbackURL=${encodeURIComponent(redirect)}`}
                aria-describedby="sso-login-description"
                className="mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-input bg-background px-6 text-sm font-medium transition-colors hover:border-foreground/25 hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <LockKeyhole className="size-4" />
                {t("sso.login")}
              </a>
            ) : (
              <button
                type="button"
                aria-describedby="sso-login-description"
                disabled
                className="mt-6 flex min-h-12 w-full cursor-not-allowed items-center justify-center gap-2 rounded-md border border-input bg-muted/50 px-6 text-sm font-medium text-muted-foreground"
              >
                <LockKeyhole className="size-4" />
                {t("sso.login")}
              </button>
            )}
            <p
              id="sso-login-description"
              className="mt-3 text-center text-xs leading-5 text-muted-foreground"
            >
              {config?.ssoEnabled
                ? t("sso.continue", { providerName: config.providerName })
                : t("sso.unavailable")}
            </p>
          </div>
          <p className="mt-10 text-center text-xs leading-5 text-muted-foreground">{t("footer")}</p>
        </div>
      </section>
    </main>
  );
}
