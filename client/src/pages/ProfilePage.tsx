import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, CheckCircle2, LockKeyhole, Save, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

export default function ProfilePage() {
  const auth = useAuth({ redirectOnUnauthenticated: true, redirectPath: "/login" });
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const updateProfile = trpc.auth.updateProfile.useMutation();

  useEffect(() => { if (auth.user?.name) setName(auth.user.name); }, [auth.user?.name]);

  if (auth.loading || !auth.user) return <div className="auth-loading" role="status">Loading your profile…</div>;

  const save = async () => {
    if (name.trim().length < 2) {
      toast.error("Enter your full name.");
      return;
    }
    try {
      const user = await updateProfile.mutateAsync({ name: name.trim() });
      utils.auth.me.setData(undefined, user);
      await utils.auth.me.invalidate();
      toast.success("Profile updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Profile could not be updated.");
    }
  };

  return <main className="account-page"><div className="account-shell"><header className="account-head"><Link href="/"><ArrowLeft size={15} /> Back to workspace</Link><span className="brand"><span className="brand-mark"><UserRound size={16} /></span><span>IntellMeet</span></span></header><section className="account-hero"><span className="section-kicker">Account and identity</span><h1>Your profile</h1><p>Keep the name shown in meetings, Copilot context, and collaboration views up to date.</p></section><div className="account-grid"><section className="account-card"><div className="account-card-title"><UserRound size={18} /><div><h2>Personal details</h2><p>Changes are validated and saved to your authenticated account.</p></div></div><div className="account-form"><label>Display name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} /></label><label>Email address<input value={auth.user.email || ""} disabled /></label><button className="primary-button" onClick={save} disabled={updateProfile.isPending}><Save size={14} /> {updateProfile.isPending ? "Saving…" : "Save profile"}</button></div></section><aside className="account-card account-security"><LockKeyhole size={22} /><h2>Account security</h2><p>Your password is stored as a bcrypt hash. Sessions use a project-scoped, HTTP-only secure cookie in production.</p><span><CheckCircle2 size={14} /> Authenticated profile API</span><span><CheckCircle2 size={14} /> Per-user meetings and insights</span><span><CheckCircle2 size={14} /> Server-only managed secrets</span><Link className="secondary-button" href="/support">Get support</Link></aside></div></div></main>;
}
