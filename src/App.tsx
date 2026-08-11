import { useEffect, useState, createContext, useContext, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { get, post, ENV_STORAGE_KEY, type User, type Org } from "./lib/api";
import { Spinner } from "./components/ui";
import Login from "./pages/Login";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import ObjectPage from "./pages/ObjectPage";
import DealsPage from "./pages/DealsPage";
import ActivitiesPage from "./pages/ActivitiesPage";
import EventsPage from "./pages/EventsPage";
import SettingsPage from "./pages/SettingsPage";
import ImportPage from "./pages/ImportPage";
import SegmentsPage from "./pages/SegmentsPage";
import AccountHierarchyPage from "./pages/AccountHierarchyPage";
import FormPage from "./pages/FormPage";
import EmailPage from "./pages/EmailPage";
import EmailTemplatesPage from "./pages/EmailTemplatesPage";
import CallsPage from "./pages/CallsPage";
import MeetingsPage from "./pages/MeetingsPage";
import BookingPagesPage from "./pages/BookingPagesPage";
import PublicBookingPage from "./pages/PublicBookingPage";

export type FeatureState = {
  enabled: boolean;
  label: string;
  description: string;
  plans: string[];
  source: "settings" | "featureFlag" | "default";
};

export type Session = {
  user: User | null;
  org: Org | null;
  loading: boolean;
  refresh: () => void;
  environment: string;
  environments: string[];
  features: Record<string, FeatureState>;
  setEnvironment: (env: string) => void;
};

export default function App() {
  const [session, setSession] = useState<Session>({
    user: null,
    org: null,
    loading: true,
    refresh: () => {},
    environment: "production",
    environments: [],
    features: {},
    setEnvironment: () => {},
  });

  const refresh = async () => {
    try {
      const [me, env, feats] = await Promise.all([
        get<{ user: User | null; org: Org | null }>("/api/auth/me"),
        get<{ environment: string; environments: string[] }>("/api/env").catch(() => ({ environment: "production", environments: [] })),
        get<{ features: Record<string, FeatureState> }>("/api/features").catch(() => ({ features: {} })),
      ]);
      setSession({
        user: me.user,
        org: me.org,
        loading: false,
        refresh,
        environment: env.environment,
        environments: env.environments,
        features: feats.features,
        setEnvironment: (e: string) => setEnvironment(e, refresh),
      });
    } catch {
      setSession({
        user: null,
        org: null,
        loading: false,
        refresh,
        environment: "production",
        environments: [],
        features: {},
        setEnvironment: (e: string) => setEnvironment(e, refresh),
      });
    }
  };

  const setEnvironment = async (env: string, reload: () => void) => {
    try {
      await post("/api/env/switch", { environment: env });
    } catch {
      /* invalid env — fall through to reload which will surface the server's list */
    }
    localStorage.setItem(ENV_STORAGE_KEY, env);
    await reload();
  };

  useEffect(() => {
    void refresh();
  }, []);

  if (session.loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  return (
    <SessionCtx.Provider value={session}>
      <Routes>
        <Route path="/login" element={session.user ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/forms/:slug" element={<FormPage />} />
        <Route path="/b/:slug" element={<PublicBookingPage />} />
        <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<Dashboard />} />
          <Route path="contacts" element={<ObjectPage type="contact" />} />
          <Route path="accounts" element={<ObjectPage type="account" />} />
          <Route path="accounts/hierarchy" element={<AccountHierarchyPage />} />
          <Route path="segments" element={<SegmentsPage />} />
          <Route path="leads" element={<ObjectPage type="lead" />} />
          <Route path="deals" element={<DealsPage />} />
          <Route path="activities" element={<ActivitiesPage />} />
          <Route path="emails" element={<EmailPage />} />
          <Route path="emails/templates" element={<EmailTemplatesPage />} />
          <Route path="calls" element={<CallsPage />} />
          <Route path="meetings" element={<MeetingsPage />} />
          <Route path="booking" element={<BookingPagesPage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionCtx.Provider>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const session = useSession();
  const location = useLocation();
  if (!session.user) return <Navigate to={{ pathname: "/login", search: location.search }} state={{ from: location }} replace />;
  return <>{children}</>;
}

export const SessionCtx = createContext<Session>({
  user: null,
  org: null,
  loading: false,
  refresh: () => {},
  environment: "production",
  environments: [],
  features: {},
  setEnvironment: () => {},
});
export const useSession = () => useContext(SessionCtx);

/** Gate UI on a feature flag (the API remains the real gate via requireFeature). */
export const useFeature = (key: string): boolean => useSession().features[key]?.enabled ?? false;
