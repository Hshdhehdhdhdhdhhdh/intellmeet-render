export function appOrigin() {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

export function meetingShareUrl(roomId: string) {
  return `${appOrigin()}/call/${encodeURIComponent(roomId)}`;
}
