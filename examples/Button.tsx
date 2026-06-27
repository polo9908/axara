// Intentionally contains design drift for the audit demo.
export function Button({ label }: { label: string }) {
  return (
    <button
      style={{
        color: '#ffffff',          // exact token → color.surface.default (auto-fixable)
        backgroundColor: '#3c83f7', // near-miss   → color.brand.primary (suggested)
        padding: 8,                 // exact token → space.sm
        marginTop: 12,              // no exact token; nearest is space.md (16px)
        borderRadius: 6,            // ignored: not a spacing property
      }}
    >
      {label}
    </button>
  );
}
