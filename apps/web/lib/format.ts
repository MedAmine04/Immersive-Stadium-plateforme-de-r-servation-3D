export const formatPrice = (minor: number, currency = "MAD") =>
  `${(minor / 100).toLocaleString("fr-MA", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${currency}`;

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

export const formatShortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

export const TIER_LABEL: Record<string, string> = { L: "Niveau bas", M: "Niveau 2 (premium)", U: "Niveau haut" };
export const STATUS_LABEL: Record<string, string> = {
  pending: "En attente", confirmed: "Confirmée", cancelled: "Annulée", expired: "Expirée",
  draft: "Brouillon", published: "Publié",
};
