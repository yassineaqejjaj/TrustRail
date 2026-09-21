import type { Metadata } from "next";
import { AuthProvider } from "@/context/auth-context";
import { ToastProvider } from "@/context/toast-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "TrustRail — Let agents act. Keep control.",
  description:
    "TrustRail controls what AI agents can do on behalf of people and companies, then records verifiable receipts of those actions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg font-sans text-ink antialiased">
        <ToastProvider>
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
