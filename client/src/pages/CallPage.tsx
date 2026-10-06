import { useAuth } from "@/_core/hooks/useAuth";
import LiveCall from "@/components/LiveCall";
import MeetingIntelligence from "@/components/MeetingIntelligence";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Link, useParams } from "wouter";

export default function CallPage() {
  const params = useParams<{ roomId?: string }>();
  const auth = useAuth();
  let roomId = params.roomId || "meeting-room";
  try {
    roomId = decodeURIComponent(roomId);
  } catch {
    roomId = "meeting-room";
  }
  const displayName = auth.user?.name || "";
  const [recordedFile, setRecordedFile] = useState<File | null>(null);
  const [liveTranscript, setLiveTranscript] = useState("");
  const meetingRecords = trpc.meetings.list.useQuery(
    { cacheKey: auth.user?.openId || "anonymous" },
    { enabled: Boolean(auth.user), retry: false }
  );
  const savedMeetingId = /^meeting--([1-9]\d*)$/.exec(roomId)?.[1];
  const savedMeeting = savedMeetingId
    ? meetingRecords.data?.find(
        meeting => meeting.id === Number(savedMeetingId)
      )
    : undefined;
  const joinCheck = trpc.meetings.join.useQuery(
    { meetingId: Number(savedMeetingId || 0) },
    { enabled: Boolean(savedMeetingId), retry: false }
  );

  if (savedMeetingId && joinCheck.isLoading)
    return (
      <main className="call-page">
        <p className="call-status">Checking meeting access…</p>
      </main>
    );
  if (savedMeetingId && joinCheck.isError)
    return (
      <main className="call-page">
        <p className="call-status error">{joinCheck.error.message}</p>
        <Link href="/">← Back to workspace</Link>
      </main>
    );

  return (
    <main className="call-page">
      <header className="call-page-head">
        <Link href="/">← Back to workspace</Link>
        <span className="call-page-eyebrow">Live collaboration room</span>
        <h1>{savedMeeting?.title || "IntellMeet meeting"}</h1>
        <p>
          Share the room link, enter your name, and join. Everyone sees each
          other live — no app or account needed for guests.
        </p>
      </header>
      <LiveCall
        roomId={joinCheck.data?.roomId || roomId}
        displayName={displayName}
        onRecordingReady={setRecordedFile}
        onTranscript={setLiveTranscript}
      />
      <MeetingIntelligence
        meetingId={savedMeeting?.id}
        title={savedMeeting?.title || roomId}
        incomingFile={recordedFile}
        liveTranscript={liveTranscript}
      />
    </main>
  );
}
