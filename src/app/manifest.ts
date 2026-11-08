import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PayFlow",
    short_name: "PayFlow",
    description: "Payroll and HR for Indian companies",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#0b0b12",
    theme_color: "#6366f1",
    icons: [
      { src: "/icons/192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [{ name: "Attendance", url: "/attendance" }],
  };
}
