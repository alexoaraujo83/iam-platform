This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.


## Auth0 local setup

The application uses the Auth0 Next.js SDK on the server. Configure these values in `apps/web/.env.local` (never commit real values):

- `AUTH0_DOMAIN`: Auth0 tenant domain, without `https://`.
- `AUTH0_CLIENT_ID`: Regular Web Application client ID.
- `AUTH0_CLIENT_SECRET`: confidential client secret, server-side only.
- `AUTH0_SECRET`: 32-byte hex secret for encrypted session cookies (`openssl rand -hex 32`).
- `APP_BASE_URL`: application origin, for example `http://localhost:3000`.

For local development, add exactly `http://localhost:3000/auth/callback` to Allowed Callback URLs, `http://localhost:3000` to Allowed Logout URLs and Allowed Web Origins in the Auth0 application. Add exact production URLs only after deployment domains are confirmed; do not use wildcard URLs.

The SDK handles `/auth/login`, `/auth/logout`, `/auth/callback`, and session cookies through the Next.js 16 `proxy.ts` entry point. A successful Auth0 session proves authentication only; the IAM API must still resolve the principal, active tenant membership, and permissions server-side. Do not infer authorization solely from email or untrusted client state.

The normal CI pipeline does not require Auth0 credentials or contact the external tenant. After configuring a dedicated test tenant, run a separate deployment smoke test for login, callback, session persistence, logout, and denial when configuration is missing.
