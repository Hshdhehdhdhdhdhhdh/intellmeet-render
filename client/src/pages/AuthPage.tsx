import { useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, Check, LockKeyhole, Mail, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return "Something went wrong. Please try again.";
}

export default function AuthPage({ mode }: { mode: "login" | "register" }) {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState("");
  const isRegister = mode === "register";

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: async (user) => {
      utils.auth.me.setData(undefined, user);
      toast.success("Welcome back.");
      navigate("/");
    },
    onError: (error) => setFormError(errorMessage(error)),
  });
  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: async (user) => {
      utils.auth.me.setData(undefined, user);
      toast.success("Your IntellMeet account is ready.");
      navigate("/");
    },
    onError: (error) => setFormError(errorMessage(error)),
  });
  const busy = loginMutation.isPending || registerMutation.isPending;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    if (isRegister) {
      registerMutation.mutate({ name, email, password });
    } else {
      loginMutation.mutate({ email, password });
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-showcase" aria-label="About IntellMeet">
        <Link href="/login" className="auth-brand">
          <span className="brand-mark"><Sparkles size={17} /></span>
          <span>IntellMeet</span>
        </Link>
        <div className="auth-showcase-copy">
          <span className="auth-eyebrow"><i /> TEAMWORK, WITH CLARITY</span>
          <h1>Turn every meeting into <em>momentum.</em></h1>
          <p>Plan the conversation, capture what matters, and keep the whole team moving forward.</p>
          <div className="auth-proof-list">
            <span><Check size={15} /> Meeting workspace in one place</span>
            <span><Check size={15} /> Clear actions after every discussion</span>
            <span><Check size={15} /> Built for focused, collaborative teams</span>
          </div>
        </div>
        <div className="auth-showcase-foot">A calmer way to collaborate.</div>
      </section>

      <section className="auth-panel-wrap">
        <div className="auth-panel">
          <div className="auth-mobile-brand"><span className="brand-mark"><Sparkles size={17} /></span> IntellMeet</div>
          <div className="auth-kicker">{isRegister ? "GET STARTED" : "WELCOME BACK"}</div>
          <h2>{isRegister ? "Create your account" : "Sign in to your workspace"}</h2>
          <p className="auth-subtitle">
            {isRegister
              ? "Set up your account and bring your team together."
              : "Pick up where your team left off."}
          </p>

          <form className="auth-form" onSubmit={submit}>
            {isRegister && (
              <label className="auth-field">
                <span>Full name</span>
                <input autoComplete="name" required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" />
              </label>
            )}
            <label className="auth-field">
              <span>Email address</span>
              <span className="auth-input-wrap"><Mail size={16} /><input type="email" autoComplete="email" required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" /></span>
            </label>
            <label className="auth-field">
              <span>Password</span>
              <span className="auth-input-wrap"><LockKeyhole size={16} /><input type="password" autoComplete={isRegister ? "new-password" : "current-password"} required minLength={isRegister ? 8 : 1} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={isRegister ? "At least 8 characters" : "Your password"} /></span>
              {isRegister && <small>Use at least 8 characters.</small>}
            </label>
            {formError && <div className="auth-error" role="alert">{formError}</div>}
            <button className="auth-submit" type="submit" disabled={busy}>
              {busy ? "Please wait…" : isRegister ? "Create account" : "Sign in"}
              {!busy && <ArrowRight size={17} />}
            </button>
          </form>

          <p className="auth-switch">
            {isRegister ? "Already have an account?" : "New to IntellMeet?"}{" "}
            <Link href={isRegister ? "/login" : "/register"}>{isRegister ? "Sign in" : "Create an account"}</Link>
          </p>
          <p className="auth-switch">Reviewer access: <Link href="/demo">Continue to live demo</Link> (no account required)</p>
          <p className="auth-privacy">Your credentials are protected with bcrypt password hashing and a secure session cookie.</p>
        </div>
        <div className="auth-copyright">© {new Date().getFullYear()} IntellMeet · Team collaboration</div>
      </section>
    </main>
  );
}
