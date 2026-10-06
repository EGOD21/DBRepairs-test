import { createContext, ReactNode, useContext } from "react";
import { SessionUser } from "./data/api";
import { isServerMode } from "./data/runtime";

type SessionValue = { user: SessionUser | null; isAdmin: boolean; teamFeatures: boolean };

const SessionContext = createContext<SessionValue>({ user: null, isAdmin: true, teamFeatures: false });

/** The desktop app has a single local user who can do everything; the server has accounts. */
export function SessionProvider({ user, children }: { user: SessionUser | null; children: ReactNode }) {
  const value = { user, isAdmin: !isServerMode || user?.role === "admin", teamFeatures: isServerMode };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
