# Cosmo CDN Hono Module

## Example for Cloudflare Workers

```ts
import { cors } from "hono/cors";
import { Context, Hono } from "hono";
// Your bindings
import { Bindings } from "./bindings";
import { cdn } from "@wundergraph/cosmo-cdn";

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", cors());

cdn(app, {
    authJwtSecret,
    blobStorage, // Your BlobStorage implementation
});

export default app;
```