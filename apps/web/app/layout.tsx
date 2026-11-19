import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "Immersive Stadium — voyez votre place avant de l'acheter",
  description: "Explorez le stade en 3D, visualisez la vue depuis chaque siège et réservez en toute fiabilité.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#060a14" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <Providers>
          <Nav />
          <main>{children}</main>
        </Providers>
      </body>
    </html>
  );
}
