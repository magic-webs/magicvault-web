import type { Metadata } from "next";
import { AppThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Magic Vault — Chat",
  description: "Real chat application for the Magic Vault WhatsApp document assistant",
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
        </AppThemeProvider>
      </body>
    </html>
  );
}
