import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { onAuthStateChanged, reload, signOut, type User } from "@react-native-firebase/auth";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  limit,
} from "@react-native-firebase/firestore";
import type { CallRecord } from "@famcall/core";
import { api, auth, database, initializeFirebase } from "../services/firebase";
import { errorMessage } from "../services/errors";
import { SessionValidation } from "../services/SessionValidation";

export interface Person {
  phone: string;
  name: string;
}
interface Session {
  ready: boolean;
  user: User | null;
  people: Person[];
  history: CallRecord[];
  blocked: string[];
  peopleLoaded: boolean;
  historyLoaded: boolean;
  blockedLoaded: boolean;
  peopleError: string | null;
  historyError: string | null;
  blockedError: string | null;
  error: string | null;
  refresh: () => void;
}
const Context = createContext<Session>({
  ready: false,
  user: null,
  people: [],
  history: [],
  blocked: [],
  peopleLoaded: false,
  historyLoaded: false,
  blockedLoaded: false,
  peopleError: null,
  historyError: null,
  blockedError: null,
  error: null,
  refresh() {},
});
export function SessionProvider({ children }: React.PropsWithChildren) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [history, setHistory] = useState<CallRecord[]>([]);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [peopleLoaded, setPeopleLoaded] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [blockedLoaded, setBlockedLoaded] = useState(false);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [blockedError, setBlockedError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const identity = useRef<string | null | undefined>(undefined);
  const validation = useRef<SessionValidation<User> | null>(null);
  useEffect(() => {
    const validator = new SessionValidation({
      current: () => auth.currentUser,
      reload,
      signOut: () => signOut(auth),
    });
    validation.current = validator;
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") void validator.validate();
    });
    return () => {
      validator.dispose();
      subscription.remove();
      validation.current = null;
    };
  }, []);
  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    initializeFirebase()
      .then(() => {
        if (!alive) return;
        unsubscribe = onAuthStateChanged(auth, (next) => {
          if (!alive) return;
          // A retry can reattach Auth after cached snapshots have arrived.
          // Keep those lists unless the signed-in identity actually changes.
          const nextIdentity = next?.uid ?? null;
          if (identity.current !== nextIdentity) {
            identity.current = nextIdentity;
            setPeople([]);
            setHistory([]);
            setBlocked([]);
            setPeopleLoaded(false);
            setHistoryLoaded(false);
            setBlockedLoaded(false);
            setPeopleError(null);
            setHistoryError(null);
            setBlockedError(null);
            setError(null);
          }
          setUser(next);
          setReady(true);
          // Auth restores cached users before it learns about server-side
          // deletion. Recheck in the background on attach (including Retry).
          void validation.current?.validate();
        });
      })
      .catch((e) => {
        if (alive) {
          setError(errorMessage(e));
          setReady(true);
        }
      });
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [attempt]);
  useEffect(() => {
    if (!user) return;
    let active = true;
    const isCurrent = () => active && identity.current === user.uid;
    const fail = (e: unknown) => {
      if (isCurrent()) setError(errorMessage(e));
    };
    api("registerProfile")
      .then(() => {
        if (isCurrent()) setError(null);
      })
      .catch(fail);
    const unsubscribers = [
      onSnapshot(
        collection(database, "users", user.uid, "contacts"),
        { includeMetadataChanges: true },
        (snap) => {
          if (!isCurrent()) return;
          setPeople(
            snap.docs
              .map((d) => d.data() as Person)
              .sort((a, b) => a.name.localeCompare(b.name)),
          );
          // An empty first cache is not evidence of an empty account. Wait for
          // the server before showing the empty state; cached people stay usable.
          setPeopleLoaded((loaded) => loaded || !snap.metadata.fromCache || snap.size > 0);
          setPeopleError(null);
        },
        (e) => {
          if (isCurrent()) setPeopleError(errorMessage(e));
        },
      ),
      onSnapshot(
        query(
          collection(database, "calls"),
          where("participants", "array-contains", user.uid),
          orderBy("createdAtMs", "desc"),
          limit(100),
        ),
        { includeMetadataChanges: true },
        (snap) => {
          if (!isCurrent()) return;
          setHistory(snap.docs.map((d) => d.data() as CallRecord));
          setHistoryLoaded((loaded) => loaded || !snap.metadata.fromCache || snap.size > 0);
          setHistoryError(null);
        },
        (e) => {
          if (isCurrent()) setHistoryError(errorMessage(e));
        },
      ),
      onSnapshot(
        collection(database, "users", user.uid, "blocked"),
        { includeMetadataChanges: true },
        (snap) => {
          if (!isCurrent()) return;
          setBlocked(snap.docs.map((d) => d.id));
          setBlockedLoaded((loaded) => loaded || !snap.metadata.fromCache || snap.size > 0);
          setBlockedError(null);
        },
        (e) => {
          if (isCurrent()) setBlockedError(errorMessage(e));
        },
      ),
    ];
    return () => {
      active = false;
      unsubscribers.forEach((u) => u());
    };
  }, [user, attempt]);
  return (
    <Context.Provider
      value={{
        ready,
        user,
        people,
        history,
        blocked,
        peopleLoaded,
        historyLoaded,
        blockedLoaded,
        peopleError,
        historyError,
        blockedError,
        error,
        refresh: () => {
          setPeopleError(null);
          setHistoryError(null);
          setBlockedError(null);
          setAttempt((v) => v + 1);
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useSession = () => useContext(Context);
