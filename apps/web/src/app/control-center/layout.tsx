import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Control Center | IAM Platform",
  description: "Visão operacional unificada para identidade, segurança, entregas e evidências da IAM Platform.",
};

export default function ControlCenterLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
