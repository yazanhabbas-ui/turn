import "./globals.css";

/** The <html> element is rendered by [locale]/layout.tsx so `lang` and `dir` follow the active locale. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
