import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "graphiql/graphiql.css";
import "./index.css";
import "@graphiql/plugin-explorer/dist/style.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
