import type { Metadata, Viewport } from "next";
import ThemeToggle from "@/components/ThemeToggle";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Cricup TV Admin", template: "%s | Cricup TV Admin" },
  description: "Content management for Cricup TV.",
  // Tab icon follows the browser theme: dark-detail logo on light tabs, white-detail logo on dark tabs.
  icons: {
    icon: [
      { url: "/tab-light-16.png?v=8", type: "image/png", sizes: "16x16", media: "(prefers-color-scheme: light)" },
      { url: "/tab-light-32.png?v=8", type: "image/png", sizes: "32x32", media: "(prefers-color-scheme: light)" },
      { url: "/tab-light-48.png?v=8", type: "image/png", sizes: "48x48", media: "(prefers-color-scheme: light)" },
      { url: "/tab-light-192.png?v=8", type: "image/png", sizes: "192x192", media: "(prefers-color-scheme: light)" },
      { url: "/tab-dark-16.png?v=8", type: "image/png", sizes: "16x16", media: "(prefers-color-scheme: dark)" },
      { url: "/tab-dark-32.png?v=8", type: "image/png", sizes: "32x32", media: "(prefers-color-scheme: dark)" },
      { url: "/tab-dark-48.png?v=8", type: "image/png", sizes: "48x48", media: "(prefers-color-scheme: dark)" },
      { url: "/tab-dark-192.png?v=8", type: "image/png", sizes: "192x192", media: "(prefers-color-scheme: dark)" },
    ],
    apple: [{ url: "/tab-apple-touch.png?v=8", sizes: "180x180", type: "image/png" }],
  },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e6e9ee" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

// Same convention as the public site: light is the default theme.
const themeScript = `try{var t=localStorage.getItem('youno-theme');document.documentElement.setAttribute('data-theme',t==='dark'?'dark':'light')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <header className="top">
          {/* eslint-disable @next/next/no-img-element */}
          <img className="logo-light" src="/cricup-logo-light.png" alt="Cricup TV" width={700} height={644} />
          <img className="logo-dark" src="/cricup-logo-dark.png" alt="" aria-hidden="true" width={700} height={646} />
          {/* eslint-enable @next/next/no-img-element */}
          <span className="top-label">Admin</span>
          <div className="top-actions"><ThemeToggle /></div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
