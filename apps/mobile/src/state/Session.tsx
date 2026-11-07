import React, { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "@react-native-firebase/auth";
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
  error: string | null;
  refresh: () => void;
}
const Context = createContext<Session>({
  ready: false,
  user: null,
  people: [],
  history: [],
  blocked: [],
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
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    initializeFirebase()
      .then(() => {
        if (!alive) return;
        unsubscribe = onAuthStateChanged(auth, (next) => {
          setPeople([]);
          setHistory([]);
          setBlocked([]);
          setUser(next);
          setReady(true);
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
    const fail = (e: unknown) => {
      if (active) setError(errorMessage(e));
    };
    api("registerProfile")
      .then(() => {
        if (active) setError(null);
      })
      .catch(fail);
    const unsubscribers = [
      onSnapshot(
        collection(database, "users", user.uid, "contacts"),
        (snap) =>
          setPeople(
            snap.docs
              .map((d) => d.data() as Person)
              .sort((a, b) => a.name.localeCompare(b.name)),
          ),
        fail,
      ),
      onSnapshot(
        query(
          collection(database, "calls"),
          where("participants", "array-contains", user.uid),
          orderBy("createdAtMs", "desc"),
          limit(100),
        ),
        (snap) => setHistory(snap.docs.map((d) => d.data() as CallRecord)),
        fail,
      ),
      onSnapshot(
        collection(database, "users", user.uid, "blocked"),
        (snap) => setBlocked(snap.docs.map((d) => d.id)),
        fail,
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
        error,
        refresh: () => setAttempt((v) => v + 1),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useSession = () => useContext(Context);
