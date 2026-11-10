import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import {
  canUseVoiceCalls, isCallingReady, readCallingPermissions, requestCallingPermission, setupSeenKey,
  type CallingPermissionName, type CallingPermissions,
} from "../services/callReadiness";
import { t } from "../i18n";

interface Readiness {
  permissions: CallingPermissions | null;
  checked: boolean;
  ready: boolean;
  canCall: boolean;
  needsSetup: boolean;
  busy: CallingPermissionName | null;
  error: string | null;
  refresh: () => Promise<boolean>;
  preflight: () => Promise<boolean>;
  request: (name: CallingPermissionName) => Promise<void>;
  finishSetup: () => Promise<void>;
}
const Context = createContext<Readiness | null>(null);

export function CallReadinessProvider({ children }: React.PropsWithChildren) {
  const [permissions, setPermissions] = useState<CallingPermissions | null>(null);
  const [checked, setChecked] = useState(false);
  const [seen, setSeen] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<CallingPermissionName | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const revision = useRef(0);
  const requesting = useRef(false);

  const refresh = useCallback(async () => {
    const version = ++revision.current;
    try {
      const next = await readCallingPermissions();
      if (alive.current && version === revision.current) {
        setPermissions(next);
        setChecked(true);
        setError(null);
      }
      return canUseVoiceCalls(next);
    } catch {
      if (alive.current && version === revision.current) {
        setPermissions(null);
        setChecked(true);
        setError(t("setupCheckError"));
      }
      return false;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void AsyncStorage.getItem(setupSeenKey)
      .then(value => { if (alive.current) setSeen(value === "yes"); })
      .catch(() => { if (alive.current) setSeen(false); });
    // Initial native reads run asynchronously, just like AppState updates.
    void Promise.resolve().then(refresh);
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") void refresh();
    });
    return () => { alive.current = false; subscription.remove(); };
  }, [refresh]);

  const ready = permissions !== null && isCallingReady(permissions);
  return (
    <Context.Provider value={{
      permissions,
      checked: checked && seen !== null,
      ready,
      canCall: permissions !== null && canUseVoiceCalls(permissions),
      needsSetup: seen === false && !ready,
      busy,
      error,
      refresh,
      preflight: async () => {
        if (AppState.currentState !== "active" || requesting.current) return false;
        return await refresh() && AppState.currentState === "active";
      },
      request: async name => {
        if (requesting.current || AppState.currentState !== "active") return;
        requesting.current = true;
        setBusy(name);
        setError(null);
        try {
          await requestCallingPermission(name);
          await refresh();
        } catch {
          if (alive.current) setError(t("setupRequestError"));
        } finally {
          requesting.current = false;
          if (alive.current) setBusy(null);
        }
      },
      finishSetup: async () => {
        try {
          await AsyncStorage.setItem(setupSeenKey, "yes");
          if (alive.current) setSeen(true);
        } catch {
          if (alive.current) setError(t("setupSaveError"));
          throw new Error("calling-setup-save-failed");
        }
      },
    }}>
      {children}
    </Context.Provider>
  );
}

export function useCallReadiness() {
  const value = useContext(Context);
  if (!value) throw new Error("CallReadinessProvider is missing");
  return value;
}
