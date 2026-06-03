import LoginGate from "@/components/LoginGate";
import AppShell from "@/components/AppShell";

export default function AuthedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <LoginGate>
      <AppShell>{children}</AppShell>
    </LoginGate>
  );
}
