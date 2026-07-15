// app/(auth)/layout.tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
      <>
        <main className="bms-auth-main" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
          {children}
        </main>
      </>
  );
}
