/**
 * A URL laid out for reading: it wraps after the host and at slashes rather than in the middle of a
 * word. Combine with `[overflow-wrap:anywhere]` on the container for a single overlong segment.
 */
export function UrlText({ url }: { url: string }) {
  const m = /^([a-z]+:\/\/[^/]+)(\/.*)?$/i.exec(url);
  if (!m) return <>{url}</>;
  const parts = (m[2] ?? "").split(/(?=\/)/);
  return (
    <>
      {m[1]}
      {parts.map((p, i) => (
        <span key={i}>
          <wbr />
          {p}
        </span>
      ))}
    </>
  );
}
