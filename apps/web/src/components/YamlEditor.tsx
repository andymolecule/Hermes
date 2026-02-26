"use client";

export function YamlEditor({
  value,
  onChange,
}: { value: string; onChange: (v: string) => void }) {
  return (
    <textarea
      className="textarea"
      style={{
        minHeight: 420,
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 13,
      }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
