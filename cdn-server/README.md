# Cdn

The Cosmo CDN Server functions as a configuration delivery mechanism for the Cosmo Router.

It decouples the configuration delivery from the Control Plane and ensures high availability in case of a Control Plane failure.

## Getting Started

Run the command below and replace all values in `.env` with the correct values.

```bash
mv .env.example .env
```

## Scripts

To work on the CDN server, you can use the following npm scripts:

- **dev**: Runs the application in development mode with hot reloading.

```bash
npm run dev
```

- **build**: Compiles the TypeScript files and cleans the `dist` directory.

```bash
npm run build
```

- **start**: Starts the application in production mode.

```bash
npm run start
```

## Configuration

The following environment variables are available:

- **PORT**: The port on which the CDN server will run. Default is `11000`.

- **AUTH_JWT_SECRET**: A secret key used for signing JSON Web Tokens (JWT) for authentication. Replace with a secure value.

- **AUTH_ADMISSION_JWT_SECRET**: A secret key for admission control, also used for signing JWTs. Ensure this is a secure value.

- **S3_STORAGE_URL**: The URL for your S3 storage. This should point to your S3-compatible storage service. The default is set to a local MinIO instance.

- **S3_REGION**: The region for your S3 storage. Default is set to `'auto'`.

- **S3_ENDPOINT**: The endpoint for your S3 storage service.

- **S3_ACCESS_KEY_ID**: Your access key ID for S3 storage. This may be left empty when using `https://username:password@minio/bucket`.

- **S3_SECRET_ACCESS_KEY**: Your secret access key for S3 storage. This may be left empty when using `https://username:password@minio/bucket`.

- **S3_FORCE_PATH_STYLE**: Whether to force path style URLs for S3 storage. Set to `false` when using AWS S3.
