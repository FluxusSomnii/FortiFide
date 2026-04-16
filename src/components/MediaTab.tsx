export function MediaTab() {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 48,
      }}
    >
      <div
        style={{
          border: "2px dashed #2a2a2a",
          borderRadius: 12,
          padding: "64px 48px",
          textAlign: "center",
          maxWidth: 480,
          width: "100%",
        }}
      >
        <div style={{ color: "#555", fontSize: 14, lineHeight: 1.6 }}>
          Drop audio or video file to transcribe and analyse.
        </div>
        <div style={{ color: "#444", fontSize: 12, marginTop: 12 }}>
          Coming soon.
        </div>
      </div>
    </div>
  );
}
