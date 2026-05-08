import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

// Configure API base URL from Vite env.
// Empty / unset => same-origin (relative /api paths). Set VITE_API_URL to an
// absolute origin (e.g. https://api.example.com) when deploying the frontend
// separately from the backend.
const apiBaseUrl = (import.meta.env.VITE_API_URL ?? "").trim();
if (apiBaseUrl) {
  setBaseUrl(apiBaseUrl);
}

createRoot(document.getElementById("root")!).render(<App />);
