import type { Metadata, Viewport } from "next";
import { AppThemeProvider } from "@/components/theme-provider";
import { PWARegister } from "@/components/pwa-register";
import "./globals.css";

export const metadata: Metadata = {
  title: "Magic Vault — Chat",
  description: "Real chat application for the Magic Vault WhatsApp document assistant",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Magic Vault",
  },
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#10b981",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

import { Toaster } from "@/components/ui/sonner";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">
        <AppThemeProvider>
          {children}
          <Toaster />
          <PWARegister />
        </AppThemeProvider>
      </body>
    </html>
  );
}
