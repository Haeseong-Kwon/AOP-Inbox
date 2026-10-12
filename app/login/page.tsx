import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  // Dev convenience only: the seeded account is prefilled in `next dev`. Never in production builds.
  const dev =
    process.env.NODE_ENV === "development" && process.env.DEV_USER_EMAIL && process.env.DEV_USER_PASSWORD
      ? { email: process.env.DEV_USER_EMAIL, password: process.env.DEV_USER_PASSWORD }
      : null;
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <Suspense>
        <LoginForm dev={dev} />
      </Suspense>
    </main>
  );
}
