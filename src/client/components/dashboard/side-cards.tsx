import type {
  ListingsModel,
  MaintenanceSnapshotModel,
  MessagesModel,
  PortfolioModel,
  RentModel,
} from "./admin-dashboard-model";

/** STUBS — replaced by the right-column agent. Props are the contract. */
type Nav = { onNavigate: (href: string) => void; className?: string };

export function RentCard({ rent }: { rent: RentModel } & Nav) {
  return <div data-stub="rent">{rent.headline}</div>;
}

export function MaintenanceSnapshotCard({
  maintenance,
}: { maintenance: MaintenanceSnapshotModel } & Nav) {
  return <div data-stub="maintenance">{maintenance.summaryLine}</div>;
}

export function MessagesCard({ messages }: { messages: MessagesModel } & Nav) {
  return <div data-stub="messages">{messages.summaryLine}</div>;
}

export function ListingsCard({ listings }: { listings: ListingsModel } & Nav) {
  return <div data-stub="listings">{listings.headline}</div>;
}

export function PortfolioCard({ portfolio }: { portfolio: PortfolioModel; className?: string }) {
  return <div data-stub="portfolio">{portfolio.totalsLine}</div>;
}
