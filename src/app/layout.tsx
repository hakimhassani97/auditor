import type { Metadata } from "next";
import "./globals.css";
import "./jobs.css";
import "./review.css";
import "./pdf.css";
import "./workspace-feedback.css";
export const metadata:Metadata={title:"Atelier Énergie — Building audit workspace",description:"A traceable, image-first workspace for building energy audit preparation.",icons:{icon:"/favicon.svg"}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
