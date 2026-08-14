import "@livekit/components-styles"; import "./globals.css"; import Image from "next/image";
export const metadata = { title: "Quantlys Meeting" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>
    <div style={{display:"flex",flexDirection:"column",height:"100vh"}}>
      <header className="brandbar" style={{borderBottom:"1px solid var(--border)"}}>
        <Image src="/logo.svg" alt="Quantlys" width={26} height={26} className="logo" />
        <b>Quantlys Meeting</b>
      </header>
      <main style={{flex:1,overflow:"auto"}}>{children}</main>
    </div>
  </body></html>);
}
