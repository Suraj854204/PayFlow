import { ImageResponse } from "next/og";

const SIZES: Record<string, { px: number; pad: number }> = {
  "192.png": { px: 192, pad: 0.18 },
  "512.png": { px: 512, pad: 0.18 },
  // Maskable icons need the mark inside the central safe zone.
  "maskable.png": { px: 512, pad: 0.3 },
};

export async function GET(_: Request, { params }: { params: Promise<{ name: string }> }) {
  const spec = SIZES[(await params).name];
  if (!spec) return new Response("Not found", { status: 404 });
  const inner = Math.round(spec.px * (1 - spec.pad * 2));
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#6366f1",
      }}
    >
      <div
        style={{
          width: inner,
          height: inner,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: Math.round(inner * 0.72),
          fontWeight: 800,
        }}
      >
        P
      </div>
    </div>,
    { width: spec.px, height: spec.px },
  );
}
