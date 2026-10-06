import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import AuthPage from "./pages/AuthPage";
import { trpc } from "@/lib/trpc";
import CallPage from "./pages/CallPage";
import ProfilePage from "./pages/ProfilePage";
import SupportPage from "./pages/SupportPage";

function AuthenticatedRoute({ children }: { children: React.ReactNode }) {
  const [, navigate] = useLocation();
  const auth = trpc.auth.me.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });

  useEffect(() => {
    if (!auth.isLoading && !auth.data) navigate("/login");
  }, [auth.data, auth.isLoading, navigate]);

  if (auth.isLoading || !auth.data) {
    return <div className="auth-loading" role="status">Checking your session…</div>;
  }
  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login"><AuthPage mode="login" /></Route>
      <Route path="/register"><AuthPage mode="register" /></Route>
      <Route path="/demo"><Home /></Route>
      <Route path="/support"><SupportPage /></Route>
      <Route path="/profile"><AuthenticatedRoute><ProfilePage /></AuthenticatedRoute></Route>
      <Route path="/call/:roomId"><CallPage /></Route>
      <Route path="/"><AuthenticatedRoute><Home /></AuthenticatedRoute></Route>
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
