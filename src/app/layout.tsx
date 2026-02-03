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
  title: "Lilit — AI Development Team",
  description: "Chat with your AI dev team",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        {process.env.AUTH_SECRET && (
          <meta name="auth-secret" content={process.env.AUTH_SECRET} />
        )}
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-background text-foreground`}
      >
        <div className="fixed top-[30%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-brand/5 blur-[120px] pointer-events-none -z-10" />
        {children}
      </body>
    </html>
  );
}
