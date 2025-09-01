import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Movie Night Negotiator",
  description: "Pick a movie together—fast.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased
          min-h-screen text-slate-100
          bg-gradient-to-b from-slate-950 via-slate-900 to-black`}
      >
        {/* Optional decorative grid texture */}
        <div
          className="pointer-events-none fixed inset-0 -z-10
            [mask-image:radial-gradient(ellipse_at_center,white,transparent_70%)]
            bg-[linear-gradient(to_right,rgba(255,255,255,.04)_1px,transparent_1px),
                linear-gradient(to_bottom,rgba(255,255,255,.04)_1px,transparent_1px)]
            bg-[size:24px_24px]"
        />
        {children}
      </body>
    </html>
  );
}
