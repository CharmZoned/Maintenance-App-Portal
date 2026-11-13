import { Button } from "@/components/ui/button";

interface Props {
  title: string;
  message: string;
  onLogout: () => void;
}

export function BlockedPage({ title, message, onLogout }: Props) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" onClick={onLogout}>
        Sign out
      </Button>
    </div>
  );
}
