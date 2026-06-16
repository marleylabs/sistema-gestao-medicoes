import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Medições e Pagamentos",
  description: "Acompanhamento financeiro e operacional por ciclo.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
