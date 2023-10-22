import withMarkdoc from "@markdoc/next.js";
import pkg from "./package.json" assert { type: "json" };

/** @type {import("next").NextConfig} */
const config = {
  output: "standalone",
  pageExtensions: ["md", "mdoc", "js", "jsx", "ts", "tsx"],
  publicRuntimeConfig: {
    version: pkg.version,
  },
};

export default withMarkdoc({ mode: "static" })(config);
