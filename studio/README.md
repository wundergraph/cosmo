# Studio

The studio is the web interface for the cosmo platform. It is used to manage the platform and to collaborate on GraphQL Federation. It is in connection with the control plane through the admin API to manage the platform.

## Getting Started

Run the command below and replace all values in `.env` with the correct values.

```bash
mv .env.local.example .env.local
```

# Development

Run the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

This project uses [`next/font`](https://nextjs.org/docs/basic-features/font-optimization) to automatically optimize and load Inter, a custom Google Font.

## Stack

- [Next.js- Frontend React Framework](https://nextjs.org/)
- [Tailwind CSS - Styling library](https://tailwindcss.com/)
- [Tremor - The React library to build dashboards fast](https://www.tremor.so/)
- [T3 - Type-safe environment variables](https://env.t3.gg/)

## Controlplane communication

We use [Connect](https://connect.build/) to unify the communication between all components of the cosmo platform. Connect is a framework build on top of [gRPC](https://grpc.io/) and simplify code-generation and reuse between `Studio` -> `Controlplane`.

## Docker Info

We want runtime envs for docker for each on prem customer. Therefore we have two files to achieve this. One is .env.docker that uses a placeholder env name and an entrypoint.sh script that replaces all placeholder env name with the correct one at runtime in the .next folder. This also requires us to SSR the studio.