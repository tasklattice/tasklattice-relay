import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { classifyAccessContextError, type AccessContextErrorKind } from "@/lib/access-context-error";
import {
  getAccessContext,
  selectAccessContext,
  type AccessContextOption,
  type AccessContextState,
} from "@/services/access-context";

interface AccessContextValue extends AccessContextState {
  error: string;
  errorKind: AccessContextErrorKind | null;
  loading: boolean;
  reload: () => Promise<void>;
  select: (option: AccessContextOption) => Promise<AccessContextOption>;
}

const AccessContext = createContext<AccessContextValue | null>(null);

export function AccessContextProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation("access");
  const [state, setState] = useState<AccessContextState>({
    active: null,
    options: [],
  });
  const [failure, setFailure] = useState<unknown>(null);
  const errorKind = failure === null ? null : classifyAccessContextError(failure);
  const error = errorKind ? t(`error.messages.${errorKind}`) : "";
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    try {
      setState(await getAccessContext());
    } catch (reason) {
      setFailure(reason ?? new Error("Unable to load Account access."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const select = useCallback(async (option: AccessContextOption) => {
    setFailure(null);
    const next = await selectAccessContext({
      level: option.level,
      resourceId: option.resourceId,
      roleId: option.roleId,
    });
    setState(next);
    return next.active ?? option;
  }, []);

  const value = useMemo(() => ({
    ...state,
    error,
    errorKind,
    loading,
    reload,
    select,
  }), [error, errorKind, loading, reload, select, state]);

  return (
    <AccessContext.Provider value={value}>
      {children}
    </AccessContext.Provider>
  );
}

export function useAccessContext(): AccessContextValue {
  const value = useContext(AccessContext);
  if (!value) {
    throw new Error("useAccessContext must be used inside AccessContextProvider.");
  }
  return value;
}
