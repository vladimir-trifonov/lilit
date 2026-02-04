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
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-background text-foreground overflow-hidden selection:bg-brand selection:text-white`}
      >
        {/* Global Background Ambience */}
        <div className="fixed inset-0 pointer-events-none -z-50 overflow-hidden">
          {/* Main gradient mesh */}
          <div className="absolute top-[-20%] left-[-10%] w-[80%] h-[80%] bg-brand-glow blur-[120px] rounded-full opacity-20 animate-pulse-slow" />
          <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-accent-soft blur-[100px] rounded-full opacity-15" />
          
          {/* Noise texture overlay */}
          <div className="absolute inset-0 opacity-[0.03] mix-blend-overlay bg-[url('/noise.svg')] bg-repeat" />
        </div>
        
        {children}
      </body>
    </html>
  );
}
