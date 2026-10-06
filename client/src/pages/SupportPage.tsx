import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, CheckCircle2, CircleHelp, FileAudio, MessageSquareText, Send } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

type Category = "account" | "meeting" | "transcription" | "copilot" | "billing" | "other";

export default function SupportPage() {
  const auth = useAuth();
  const createTicket = trpc.support.create.useMutation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState<Category>("meeting");
  const [message, setMessage] = useState("");
  const [ticketId, setTicketId] = useState<number | null>(null);

  useEffect(() => {
    if (auth.user?.name) setName(auth.user.name);
    if (auth.user?.email) setEmail(auth.user.email);
  }, [auth.user?.name, auth.user?.email]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const result = await createTicket.mutateAsync({ name, email, category, message });
      setTicketId(result.id);
      setMessage("");
      toast.success("Support request saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Support request could not be saved.");
    }
  };

  return <main className="account-page"><div className="account-shell"><header className="account-head"><Link href={auth.user ? "/" : "/demo"}><ArrowLeft size={15} /> Back to IntellMeet</Link><span className="brand"><span className="brand-mark"><CircleHelp size={16} /></span><span>IntellMeet Support</span></span></header><section className="account-hero"><span className="section-kicker">Support center</span><h1>How can we help?</h1><p>Find quick answers or send a validated request that is saved for the project team.</p></section><div className="support-layout"><section className="support-faq"><article><FileAudio size={18} /><div><h2>Transcription</h2><p>Open a meeting, upload WebM, MP3, WAV, OGG, or M4A audio under 15 MB, then choose Generate insights.</p></div></article><article><MessageSquareText size={18} /><div><h2>Meeting intelligence</h2><p>Generated summaries, decisions, and action items are saved for signed-in meetings and can be added to Tasks.</p></div></article><article><CircleHelp size={18} /><div><h2>Accounts and meetings</h2><p>Use Profile to update your display name. Meetings and saved intelligence are isolated to the signed-in account.</p></div></article></section><section className="account-card"><div className="account-card-title"><Send size={18} /><div><h2>Send a support request</h2><p>All fields are validated by the backend.</p></div></div>{ticketId ? <div className="support-success"><CheckCircle2 size={24} /><h3>Request #{ticketId} saved</h3><p>The request is open and available to the project support workflow.</p><button className="secondary-button" onClick={() => setTicketId(null)}>Send another request</button></div> : <form className="account-form" onSubmit={submit}><div className="support-form-row"><label>Your name<input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={100} required /></label><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={320} required /></label></div><label>Category<select value={category} onChange={(event) => setCategory(event.target.value as Category)}><option value="account">Account</option><option value="meeting">Meeting</option><option value="transcription">Transcription</option><option value="copilot">Copilot</option><option value="billing">Billing</option><option value="other">Other</option></select></label><label>How can we help?<textarea value={message} onChange={(event) => setMessage(event.target.value)} minLength={20} maxLength={5000} placeholder="Describe the issue, what you expected, and what happened…" required /></label><button className="primary-button" type="submit" disabled={createTicket.isPending}><Send size={14} /> {createTicket.isPending ? "Saving…" : "Submit support request"}</button></form>}</section></div></div></main>;
}
