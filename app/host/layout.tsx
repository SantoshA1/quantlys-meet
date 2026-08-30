export const metadata = { robots: { index: false, follow: false } };

export default function HostLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
