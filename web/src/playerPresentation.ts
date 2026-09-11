export function playerTitle(
  params: Pick<URLSearchParams, "get">,
  embeddedTitle: string | undefined,
  mediaPath: string,
) {
  return (
    params.get("title")?.trim() ||
    embeddedTitle?.trim() ||
    mediaPath.split("/").pop() ||
    ""
  );
}

export function declaredLanguageLabel(language?: string) {
  const declared = language?.trim();
  return !declared || declared.toLowerCase() === "und"
    ? "Not declared"
    : declared.toUpperCase();
}

export function formatMediaTime(value: number) {
  if (!Number.isFinite(value)) return "0:00";
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = Math.floor(value % 60);
  return (
    (hours ? `${hours}:` : "") +
    `${hours ? String(minutes).padStart(2, "0") : minutes}:${String(seconds).padStart(2, "0")}`
  );
}
