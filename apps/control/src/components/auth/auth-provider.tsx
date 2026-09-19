import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";

export interface AuthConfig {
  authRequired: boolean;
  developmentDefaults: boolean;
  localEnabled: boolean;
  mode: "local" | "local-sso";
  providerName: string;
  ssoEnabled: boolean;
}

export interface AuthUser {
  displayName: string;
  email: string;
  id: string;
  hasPassword: boolean;
  systemRole: "user" | "platform_administrator";
  username: string;
}

interface AuthContextValue {
  config: AuthConfig | null;
  error: string;
  loading: boolean;
  logout: () => Promise<void>;
  user: AuthUser | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const payload = (await response.json()) as T & {
    detail?: string;
  };
  if (!response.ok) {
    throw new Error(payload.detail ?? `Request failed (${response.status}).`);
  }
  return payload;
}

async function loadUser(): Promise<AuthUser> {
  const response = await jsonRequest<{ user: AuthUser }>("/api/v1/auth/me");
  return response.user;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let disposed = false;
    const bootstrap = async () => {
      setLoading(true);
      setError("");
      try {
        const nextConfig = await jsonRequest<AuthConfig>("/api/v1/auth/config");
        if (disposed) return;
        setConfig(nextConfig);
        try {
          const nextUser = await loadUser();
          if (!disposed) setUser(nextUser);
        } catch {
          if (!disposed) setUser(null);
        }
      } catch (reason) {
        if (!disposed) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to load authentication configuration.",
          );
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void bootstrap();
    return () => {
      disposed = true;
    };
  }, []);

  const logout = useCallback(async () => {
    let providerLogoutUrl = "";
    try {
      const result = await authClient.signOut({
        callbackURL: "/login",
        // Handle the navigation explicitly so the local fallback and the OIDC
        // redirect cannot race each other in this callback.
        disableRedirect: true,
      });
      providerLogoutUrl = result.data?.url ?? "";
    } catch {
      // Better Auth deletes the Relay session before it attempts to construct
      // the Provider logout URL. Always continue to the local login fallback.
    }
    setUser(null);
    if (providerLogoutUrl) {
      window.location.assign(providerLogoutUrl);
      return;
    }
    await navigate({ to: "/login" });
  }, [navigate]);

  const value = useMemo(
    () => ({ config, error, loading, logout, user }),
    [config, error, loading, logout, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}
