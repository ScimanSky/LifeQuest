import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Providers from "@/components/Providers";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import "@rainbow-me/rainbowkit/styles.css";
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
  title: "LifeQuest",
  description: "LifeQuest - dashboard gaming per allenamenti on-chain.",
  manifest: "/manifest.json",
  themeColor: "#0f172a",
  icons: {
    icon: [{ url: "/lifequest-icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/lifequest-icon.svg", type: "image/svg+xml" }]
  }
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>
          <ServiceWorkerRegister />
          {children}
        </Providers>
      </body>
    </html>
  );
}
