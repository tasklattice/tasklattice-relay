import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Building2, Eye, EyeOff, LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useAuth } from "@/components/auth/auth-provider";
import { BrandMark } from "@/components/brand/brand-logo";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { Button } from "@/components/ui/button";
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
    if (submitting) return;
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
    <main className="login-page grid min-h-dvh bg-background text-foreground lg:grid-cols-[minmax(340px,0.85fr)_minmax(540px,1.15fr)]">
      <section className="login-visual relative hidden overflow-hidden border-r border-border bg-primary px-10 py-12 text-primary-foreground lg:flex lg:flex-col lg:justify-between xl:px-14">
        <Link to="/" className="relative flex min-h-11 items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4">
          <span className="flex size-10 items-center justify-center rounded-xl border border-white/20 bg-white/10">
            <BrandMark className="size-6" />
          </span>
          <span className="text-base font-semibold tracking-[-0.02em]">TaskLattice <span className="font-normal text-white/80">Relay</span></span>
        </Link>
        <div className="relative max-w-lg py-12">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/80">{t("hero.kicker")}</p>
          <h2 className="login-heading mt-4 text-4xl font-semibold leading-tight tracking-[-0.02em] xl:text-5xl">
            {t("hero.titleFirst")}<br />{t("hero.titleSecond")}
          </h2>
          <div className="mt-8 flex items-start gap-3 text-sm leading-6 text-white/80">
            <Building2 aria-hidden="true" className="mt-1 size-4 shrink-0" />
            <p>{t("hero.description")}</p>
          </div>
        </div>
        <p className="relative text-xs leading-5 text-white/80">{t("hero.sessionProtected")}</p>
      </section>

      <section className="flex min-h-dvh min-w-0 flex-col px-5 py-5 sm:px-8 lg:px-12 lg:py-8">
        <div className="flex justify-end">
          <LanguageSwitcher className="w-40 bg-card shadow-xs" />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-md">
            <Link to="/" className="mb-8 flex min-h-11 items-center gap-2 rounded-md font-semibold focus-visible:outline-2 focus-visible:outline-ring lg:hidden">
              <BrandMark className="size-6 text-primary" />
              <span>TaskLattice Relay</span>
            </Link>
            <span className="inline-flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <LockKeyhole aria-hidden="true" className="size-5" />
            </span>
            <p className="mt-6 text-sm font-medium text-primary">{t("panel.kicker")}</p>
            <h1 className="login-heading mt-2 text-3xl font-semibold tracking-[-0.015em]">{t("panel.title")}</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("panel.description")}</p>

            <form onSubmit={submit} aria-busy={submitting} className="mt-8 grid gap-5">
              <label htmlFor="login-username" className="grid gap-2 text-sm font-medium">
                {t("form.username")}
                <input id="login-username" name="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus className="login-input min-h-11 w-full rounded-md border border-input bg-card px-3 text-sm shadow-xs" placeholder={t("form.usernamePlaceholder")} required />
              </label>
              <div className="grid gap-2">
                <label htmlFor="login-password" className="text-sm font-medium">{t("form.password")}</label>
                <div className="login-input flex min-h-11 items-center rounded-md border border-input bg-card shadow-xs">
                  <input id="login-password" name="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" className="h-11 min-w-0 flex-1 rounded-md bg-transparent pl-3 text-sm outline-none" placeholder={t("form.passwordPlaceholder")} required type={showPassword ? "text" : "password"} />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" aria-label={showPassword ? t("form.hidePassword") : t("form.showPassword")} aria-pressed={showPassword}>
                    {showPassword ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
                  </button>
                </div>
              </div>
              <label className="-my-2 flex min-h-11 cursor-pointer items-center gap-3 text-sm text-muted-foreground">
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="size-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
                {t("form.keepSignedIn")}
              </label>
              {error || configError ? (
                <div role="alert" className="rounded-md border border-destructive-border bg-destructive-surface px-4 py-3 text-sm text-destructive">
                  <strong className="block font-semibold">{t("errorTitle")}</strong>
                  <span className="mt-1 block">{error || configError}</span>
                </div>
              ) : null}
              <Button disabled={submitting || loading} type="submit" size="lg" className="w-full">
                {submitting ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : null}
                {submitting ? t("form.signingIn") : t("form.signIn")}
              </Button>
            </form>

            {config?.ssoEnabled ? (
              <div className="mt-8">
                <div className="flex items-center gap-4 text-xs uppercase text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />{t("separator")}<span className="h-px flex-1 bg-border" />
                </div>
                <a href={`/api/auth/sso?callbackURL=${encodeURIComponent(redirect)}`} aria-describedby="sso-login-description" className="mt-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-input bg-card px-6 text-sm font-medium shadow-xs transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  <LockKeyhole aria-hidden="true" className="size-4" />{t("sso.login")}
                </a>
                <p id="sso-login-description" className="mt-3 text-center text-xs leading-5 text-muted-foreground">{t("sso.continue", { providerName: config.providerName })}</p>
              </div>
            ) : null}
            <div className="mt-8 flex gap-3 rounded-xl border border-border bg-muted/35 p-4">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium">{config?.developmentDefaults ? t("developmentAccount.title") : t("access.title")}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {config?.developmentDefaults ? <>{t("developmentAccount.before")} <strong>admin / password</strong>. {t("developmentAccount.after")}</> : t("footer")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
