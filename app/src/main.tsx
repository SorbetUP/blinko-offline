import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import { startSyncWorker } from "@/lib/syncWorker";
import { installLocalProxy } from "@/lib/localProxy";

installLocalProxy();
startSyncWorker();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />
);
