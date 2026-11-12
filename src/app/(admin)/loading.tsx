/** Shown instantly while a section's data loads, so clicking in the sidebar feels immediate. */
export default function Loading() {
  return (
    <div className="skeleton-page" aria-busy="true" aria-label="Loading">
      <div className="page-head">
        <div>
          <div className="skel skel-title" />
          <div className="skel skel-line" style={{ width: 360 }} />
        </div>
        <div className="skel skel-btn" />
      </div>
      <div className="card">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skel-row">
            <div className="skel skel-line" style={{ width: "28%" }} />
            <div className="skel skel-line" style={{ width: "22%" }} />
            <div className="skel skel-line" style={{ width: "10%" }} />
            <div className="skel skel-line" style={{ width: "14%" }} />
          </div>
        ))}
      </div>
    </div>
  );
}
