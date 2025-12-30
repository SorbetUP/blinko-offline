import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import { initializeDatabase } from "./lib/db/migrate";

// Initialize database and run migrations
initializeDatabase().then(() => {
  console.log('Database ready');
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />
);
